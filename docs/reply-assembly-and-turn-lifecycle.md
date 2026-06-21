# 工具调度后的回复拼接与会话终止

> 范围：模型返回 tool_calls → 工具执行 → 结果回传 → 模型继续 → 最终回复拼接 → 会话/对话结束标志。

---

## 目录

1. [链路定位](#1-链路定位)
2. [Phase 1 — 模型流式返回](#2-phase-1--模型流式返回)
3. [Phase 2 — 文本累积](#3-phase-2--文本累积)
4. [Phase 3 — 工具调用调度](#4-phase-3--工具调用调度)
5. [Phase 4 — 工具结果回传与循环](#5-phase-4--工具结果回传与循环)
6. [Phase 5 — 最终回复拼接](#6-phase-5--最终回复拼接)
7. [Phase 6 — 投递 Payload 生成](#6-phase-6--投递-payload-生成)
8. [对话结束标志](#8-对话结束标志)
9. [完整流程图](#9-完整流程图)

---

## 各阶段摘要

### Phase 1 — 模型流式返回

|          |                                                |
| -------- | ---------------------------------------------- |
| **输入** | 模型 Chat Completions API SSE 流               |
| **输出** | 按内容块（text/toolCall/thinking）分发的流事件 |

### Phase 2 — 文本累积

|          |                                                                     |
| -------- | ------------------------------------------------------------------- |
| **输入** | 流的 text_delta 事件                                                |
| **输出** | 累积在 assistantTexts[] 中的文本块 + 当前 Partial Assistant Message |

### Phase 3 — 工具调用调度

|          |                                                              |
| -------- | ------------------------------------------------------------ |
| **输入** | 流结束时 stop_reason === "tool_calls" 且包含 toolCall 内容块 |
| **输出** | 各 Tool 的执行结果（并行或串行）→ 格式化为 tool 角色消息     |

### Phase 4 — 工具结果回传与循环

|          |                                                             |
| -------- | ----------------------------------------------------------- |
| **输入** | Tool 执行结果消息数组                                       |
| **输出** | 追加到 messages 数组 → 调用 model.continue() → 回到 Phase 1 |

### Phase 5 — 最终回复拼接

|          |                                                                       |
| -------- | --------------------------------------------------------------------- |
| **输入** | 循环结束时 stop_reason 为 "stop"/"end_turn" 时的最终 AssistantMessage |
| **输出** | assistantTexts[] + toolMetas[] + lastAssistant → 统一的文本回复       |

### Phase 6 — 投递 Payload 生成

|          |                                                                      |
| -------- | -------------------------------------------------------------------- |
| **输入** | buildEmbeddedRunPayloads 的完整参数（文本/工具元数据/错误/渠道信息） |
| **输出** | ReplyPayload[]（text + media + metadata）→ 渠道发送                  |

### 对话结束标志

|          |                                            |
| -------- | ------------------------------------------ |
| **输入** | 模型 stop_reason + payload 状态 + 错误状态 |
| **输出** | turn 级完成 / 会话级空闲 / 渠道级投递      |

---

## 1. 链路定位

在完整用户输入→回复链路中，本阶段的位置：

```
入站 → 会话构建 → 提示词组装 → 模型调用
                                   │
                                   ├─ [返回文本] → (无工具调用) → 回复拼接 → 投递
                                   │
                                   └─ [返回 tool_calls] → 工具执行
                                                            │
                                                            ├─ 结果回传 → 继续模型调用
                                                            ├─ 结果回传 → 继续模型调用
                                                            └─ [返回文本] → 回复拼接 → 投递
```

---

## 2. Phase 1 — 模型流式返回

### 流事件序列

以 OpenAI Chat Completions API 为例：

```
SSE Chunk 1: { choices: [{ delta: { role: "assistant" } }] }
SSE Chunk 2: { choices: [{ delta: { content: "我来帮你查" } }] }
SSE Chunk 3: { choices: [{ delta: { content: "天气，" } }] }
SSE Chunk 4: { choices: [{ delta: { tool_calls: [{ id: "call_xxx", function: { name: "web_search", arguments: "{\"query\":\"北京天气\"}" } }] } }] }
SSE Chunk 5: { choices: [{ finish_reason: "tool_calls" }] }
```

### 内容块类型

| 类型       | 含义               | 处理器                               |
| ---------- | ------------------ | ------------------------------------ |
| `text`     | 模型输出的文本内容 | `handleMessageUpdate` → 累积为字符串 |
| `toolCall` | 模型调用的工具请求 | 序列化为 ToolCall 对象               |
| `thinking` | 模型推理过程       | 分离为 thinking 块                   |
| `refusal`  | 模型拒绝回答       | 标记为拒绝，不投递                   |

### 流处理架构

```
openai-transport-stream.ts
    │
    ├─ SSE 逐 chunk 解析
    ├─ delta.content → text_delta 事件
    ├─ delta.tool_calls → toolcall_delta 事件
    ├─ finish_reason → stop_reason 事件
    └─ 输出 AssistantMessageEvent 流
```

### Stop Reason 映射

```typescript
mapStopReason(choice.finish_reason)
    ├─ "stop"       → "stop"
    ├─ "tool_calls" → "tool_calls"
    ├─ "length"     → "length"        // max_tokens 到达
    └─ null/其他    → "error"          // 异常
```

Anthropic 对应关系：

```typescript
mapStopReason(delta.stop_reason)
    ├─ "end_turn"   → "end_turn"
    ├─ "tool_use"   → "tool_calls"
    ├─ "max_tokens" → "length"
    └─ "stop_sequence" → "stop"
```

---

## 3. Phase 2 — 文本累积

### 累积机制

**文件：** `embedded-agent-subscribe.handlers.messages.ts`

```
handleMessageUpdate(ctx, event)
    │
    ├─ event.type === "text_delta"
    │   ├─ 追加到 ctx.state.currentText.text
    │   └─ 实时 appendRawStream(delta)
    │
    ├─ event.type === "text_end"
    │   └─ 标记文本块完成
    │
    ├─ event.type === "thinking_delta"
    │   └─ 追加到 ctx.state.currentThinking.text
    │
    └─ event.type === "toolcall_start"
        └─ 记录当前文本 → push 到 assistantTexts[]
```

### assistantTexts 结构

```typescript
ctx.state.assistantTexts: string[]
    ├─ 每次 tool_call 前的文本 → 推入一个元素
    ├─ 模型最终文本 → 推入最后一个元素
    └─ 空回复 → 空数组
```

### Partial Assistant 构建

流式事件 `start / text_delta / text_end / toolcall_start / done` 累积为完整的 `AssistantMessage`：

```
AssistantMessage {
  role: "assistant",
  content: [
    { type: "text", text: "我来帮你查天气，" },
    { type: "toolCall", id: "call_xxx", name: "web_search", arguments: { "query": "北京天气" } },
    { type: "text", text: "这是结果" },
  ],
  stopReason: "tool_calls",   // 或 "stop"
  usage: { input, output, ... }
}
```

---

## 4. Phase 3 — 工具调用调度

### 调度决策

流结束时的 stop_reason 决定后续动作：

```
handleMessageEnd(ctx, lastAssistant)
    │
    ├─ stop_reason === "stop" / "end_turn"
    │   └─ 无工具调用 → 进入 Phase 5（回复拼接）
    │
    ├─ stop_reason === "tool_calls" / "tool_use"
    │   ├─ 检查 content 中的 toolCall 内容块
    │   ├─ 验证工具名称/参数
    │   └─ 进入工具执行阶段
    │
    ├─ stop_reason === "length"
    │   └─ max_tokens 到达 → 截断文本 → 进入 Phase 5
    │
    ├─ stop_reason === "error"
    │   ├─ 重试（如可重试）
    │   └─ 或 返回错误消息
    │
    └─ 其他
        └─ 按 incomplete_turn 处理
```

### 工具执行调度

**核心文件：** `packages/agent-core/src/agent-loop.ts`（executeToolCalls）

#### 串行/并行判断依据

判断分两级：**全局配置级** 和 **单个工具级**。

```
executeToolCalls(currentContext, assistantMessage, config, signal, emit)
    │
    ├─ Step 1: 检查全局配置
    │   ├─ config.toolExecution === "sequential"
    │   │   └─ 全局配置强制串行 → 直接走串行路径，不再检查单个工具
    │   │
    │   └─ config.toolExecution === "parallel"（默认值）
    │       └─ 进入 Step 2 检查单个工具
    │
    ├─ Step 2: 逐个解析工具，检查是否有工具声明了执行模式
    │   │
    │   ├─ 遍历所有 tool_call.content
    │   │   ├─ 在 currentContext.tools[] 中查找同名工具
    │   │   ├─ 检查 resolution.tool?.executionMode
    │   │   │
    │   │   ├─ executionMode === "sequential"（单个工具要求串行）
    │   │   │   ├─ hasSequentialToolCall = true
    │   │   │   └─ 中断遍历 → 全部改为串行执行
    │   │   │
    │   │   └─ 无 executionMode / executionMode === "parallel"
    │   │       └─ 继续检查下一个
    │   │
    │   └─ 全部检查完毕后
    │       ├─ hasSequentialToolCall === true → 串行
    │       └─ hasSequentialToolCall === false → 并行
    │
    └─ Step 3: 执行
        ├─ config.toolExecution === "sequential" → executeToolCallsSequential()
        ├─ hasSequentialToolCall === true       → executeToolCallsSequential()
        └─ 否则                                → executeToolCallsParallel()
```

**代码核心逻辑：**

```typescript
// agent-loop.ts // executeToolCalls

// 1. 全局配置决定
if (config.toolExecution !== "sequential") {
  // 2. 逐个检查工具级声明
  for (const toolCall of toolCalls) {
    const resolution = await resolveToolCallTool(
      currentContext, assistantMessage, toolCall, config, signal, resolvedToolCalls
    );
    if (resolution.kind === "resolved" && resolution.tool?.executionMode === "sequential") {
      hasSequentialToolCall = true;
      break;  // 发现一个，全部改为串行
    }
  }
}

// 3. 路由到实际执行路径
if (config.toolExecution === "sequential" || hasSequentialToolCall) {
  return executeToolCallsSequential(...)
}
return executeToolCallsParallel(...)
```

#### 三级判断优先级

| 优先级 | 级别                       | 设置位置                                                       | 说明                                                       |
| ------ | -------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| 最高   | **单个工具 executionMode** | `AgentTool.executionMode`                                      | 单个工具声明必须串行（例如某个有副作用的工具）             |
| 中     | **全局配置 toolExecution** | `AgentOptions.toolExecution` / `AgentLoopConfig.toolExecution` | 默认 `"parallel"`，可设为 `"sequential"` 强制所有工具串行  |
| 最低   | **默认值**                 | `agent.ts#L265`                                                | `this.toolExecution = options.toolExecution ?? "parallel"` |

#### 典型声明了串行的工具

以下工具通常在实现时声明 `executionMode: "sequential"`：

| 工具              | 原因                               |
| ----------------- | ---------------------------------- |
| `edit`            | 编辑操作依赖文件状态，并发可能冲突 |
| `write`           | 写文件需要序列化防止数据竞争       |
| `apply_patch`     | 补丁应用有副作用                   |
| `cron.add/remove` | 定时任务操作需要全局一致性         |
| `sessions_spawn`  | 子 Agent 创建有全局状态影响        |
| 自定义授权工具    | 需要用户依次确认                   |

#### 执行模式差异

| 特性          | 串行 executeToolCallsSequential        | 并行 executeToolCallsParallel  |
| ------------- | -------------------------------------- | ------------------------------ |
| 执行顺序      | 严格按 tool_calls[] 数组顺序依次执行   | 所有工具同时启动               |
| 等待策略      | 每个工具执行完毕再开始下一个           | Promise.all 完成所有启动的执行 |
| 中断条件      | 遇到 abort → 立即停止后续              | 部分工具可提前返回结果         |
| tool 结果消息 | 每个工具完成后立即 emit + push         | 全部完成后统一 emit + push     |
| 终止语义      | 所有工具返回 terminate === true → 终止 | 同上                           |

```
// 串行流程：
for toolCall in toolCalls:
    emit(tool_execution_start)
    toolResult = await execute(tool)
    emit(tool_execution_end)
    emit(toolResult message)
    messages.push(toolResult)

// 并行流程：
for toolCall in toolCalls:
    emit(tool_execution_start)
    preparations.push(prepareTool() → deferred execution)

orderedFinalized = await Promise.all(preparations)
for finalized in orderedFinalized:
    emit(toolResult message)
    messages.push(toolResult)
```

#### 执行引擎

```
├─ embedded-agent-subscribe.handlers.tools.ts
│   ├─ handleToolExecutionStart  → 通知 UI/渠道
│   ├─ handleToolExecutionUpdate  → 进度事件（exec 实时输出等）
│   └─ handleToolExecutionEnd    → 结果
│
├─ 工具结果格式化为 tool 角色消息
│   { role: "tool", tool_call_id: "...", content: "..." }
│
└─ 记录 toolMetas[]
    ├─ toolName: 工具名称
    ├─ meta: 元数据
    └─ lastToolError: 失败标记
```

### Tool 结果截断

| 条件            | 处理                   |
| --------------- | ---------------------- |
| 结果 > maxChars | 截断并标记 truncated   |
| Tool 执行异常   | 错误信息作为 tool 结果 |

---

## 5. Phase 4 — 工具结果回传与循环

### 循环模型

```
V1 (agent-session.ts):
    agent.prompt(messages)
    while handlePostAgentRun():
        agent.continue()

V2 (run.ts embedded-agent-runner):
    while (true):
        attempt = new Attempt(provider, model, messages)
        attempt.execute()   // 包含完整的一次 LLM 调用 + 工具执行
        if 无需继续 → break
```

在 V2 中，工具结果回传和继续调用的逻辑：

```
尝试块内：
    │
    ├─ 发送 prompt → 模型流式返回
    │
    ├─ stop_reason === "tool_calls"
    │   ├─ 工具执行 (handleToolExecution)
    │   ├─ 工具结果作为新消息追加
    │   │   messages.push(assistantMsg_with_toolcalls)
    │   │   messages.push(tool_result_msg)
    │   └─ continue = true → 同一次 attempt 内发送新请求
    │
    ├─ stop_reason === "stop" / "end_turn"
    │   ├─ 累积文本 → 无工具调用
    │   └─ continue = false → 跳出循环
    │
    └─ stop_reason === "error"
        ├─ 可重试 → sleep + retry
        └─ 不可重试 → fail
```

### 循环退出条件

```text
┌─────────────────────────────────────────────────┐
│                  while (true)                    │
│                                                   │
│  1. 模型返回 stop / end_turn → 有文本 → break     │
│  2. 模型返回 tool_calls → 执行工具 → continue     │
│  3. 模型返回 error → 重试或 break                  │
│  4. 模型返回 length → 截断文本 → break             │
│  5. 超过重试次数 → break (error)                  │
│  6. 用户 abort → break (aborted)                  │
│  7. 超时 → break (timeout)                        │
│                                                   │
│  每次 continue 都是新的 LLM API 调用                │
│  每次调用包含：历史消息 + 最新 tool_result           │
└─────────────────────────────────────────────────┘
```

---

## 6. Phase 5 — 最终回复拼接

### 拼接流程

```
buildEmbeddedRunPayloads({
    assistantTexts,      // Phase 2 累积的文本块数组
    assistantMessageIndex,     // 最后一条文本消息的索引
    toolMetas,           // Phase 3 记录的工具元数据
    lastAssistant,       // 最终的 AssistantMessage
    lastToolError,       // 最后一次工具调用错误（如果有）
    ...
})
    │
    ├─ Step 1: 心跳回复检查
    │   ├─ heartbeatToolResponse → 直接生成心跳回复 payload
    │   └─ 否则继续
    │
    ├─ Step 2: 源回复载荷检查
    │   ├─ messagingToolSourceReplyPayloads → 消息工具已发送的回复
    │   └─ 镜像到 Transcript，渠道端去重
    │
    ├─ Step 3: 从 assistantTexts[] 构建主回复文本
    │   │
    │   ├─ 遍历 assistantTexts[] 的每个文本块
    │   │   ├─ 跳过空文本
    │   │   ├─ 检查是否是静默回复令牌
    │   │   ├─ 检查是否是消息工具调用后的文本
    │   │   └─ 追加到 replyItems[]
    │   │
    │   ├─ 处理工具错误摘要
    │   │   ├─ 有 lastToolError → 生成工具错误摘要文本
    │   │   └─ 无 lastToolError → 跳过
    │   │
    │   └─ 处理行内工具结果
    │       ├─ inlineToolResultsAllowed → 工具结果文本内联
    │       └─ 否则 → 工具结果仅写入 Transcript
    │
    ├─ Step 4: 最终 Assistant 文本提取
    │   │
    │   ├─ resolveFinalAssistantVisibleText(lastAssistant)
    │   │   ├─ 从 content.text 中提取 visible text
    │   │   └─ 去掉 reasoning/thinking 块
    │   │
    │   └─ resolveFinalAssistantRawText(lastAssistant)
    │       └─ 原始 content.text（含 thinking）
    │
    ├─ Step 5: 拼接为 ReplyPayload[]
    │   ├─ text: string          // 最终可见文本
    │   ├─ mediaUrl: string      // 媒体附件
    │   ├─ isError: boolean      // 是否为错误消息
    │   ├─ isReasoning: boolean   // 是否为推理消息
    │   └─ meta: EmbeddedAgentRunMeta  // 运行元数据
    │
    └─ 输出: ReplyPayload[]
```

### 多文本块拼接规则

```text
assistantTexts = [
  "我来帮你查天气，",
  "北京今天晴，20-28°C",
]

在 tool_calls 场景下：
  text[0] = 第一次模型调用（含 tool_call 之前的文本）
  text[1] = 第二次模型调用（工具结果回传后的最终回复）

拼接后： "我来帮你查天气，北京今天晴，20-28°C"
```

### 工具错误摘要拼接

当工具执行失败时，在回复末尾追加错误摘要：

```text
文本: "我尝试查询天气，但遇到了一些问题。"
错误追加:
  "\n\n---\n"
  "⚠️ web_search 执行失败（3 次尝试）: API 返回 429"
```

---

## 7. Phase 6 — 投递 Payload 生成

### ReplyPayload 结构

```typescript
type ReplyPayload = {
  text?: string; // 最终回复文本
  mediaUrl?: string; // 附件 URL
  mediaUrls?: string[]; // 多个附件
  isError?: boolean; // 是否错误
  isReasoning?: boolean; // 是否推理信息
  audioAsVoice?: boolean; // 语音消息
  replyToId?: string; // 回复目标 ID
  replyToCurrent?: boolean; // 回复当前消息
  presentation?: unknown; // 展示格式
  interactive?: unknown; // 交互式内容
  channelData?: Record<string, unknown>;
};
```

### 传递路径

```
buildEmbeddedRunPayloads()
    │
    ├─ payloads: ReplyPayload[]  ← 本阶段产出
    │
    ├─ 传递到 run.ts 的 return 值
    │   {
    │     payloads,
    │     meta: { agentMeta, finalAssistantVisibleText, ... },
    │     didSendViaMessagingTool,
    │     ...
    │   }
    │
    ├─ 回到 dispatchFromConfig() 的调用链
    │
    └─ → ReplyDispatcher → sendDurableMessageBatch() → 渠道发送
```

### 投递前清理

```typescript
// Phase 9 (完整链路中的后处理)
stripHeartbeatToken(text)     // 移除心跳令牌
SILENT_REPLY_TOKEN            // 静默回复标记 → 不投递
TTS 指令清理                  // 移除 TTS 控制指令
```

---

## 8. 对话结束标志

### 分层结束标志

对话（Conversation）的结束有多个层次：

```
┌─────────────────────────────────────────────────────────────────┐
│                  对话结束标志（结束层次）                          │
│                                                                   │
│  Turn 级结束  ← 当前轮次模型回复完成                             │
│     │                                                             │
│     ├─ stop_reason === "stop" / "end_turn"                        │
│     │   └─ 模型决定不再调用工具，给出最终文本回复                  │
│     │                                                             │
│     ├─ stop_reason === "length"                                   │
│     │   └─ max_tokens 到达，文本被截断，turn 仍算完成             │
│     │                                                             │
│     └─ stop_reason === "error"                                    │
│         ├─ 可重试 → 等待重试                                      │
│         └─ 不可重试 → turn 终止，返回错误                          │
│                                                                   │
│  Agent 级结束 ← EmbeddedAgentRun 返回 result                      │
│     │                                                             │
│     ├─ while(true) 循环退出                                      │
│     ├─ 返回 { payloads, meta } 到调度层                          │
│     └─ meta 中包含 stopReason / terminalReplyKind                │
│                                                                   │
│  Session 级结束 ← 对话轮次写入 Transcript 但会话保持开放          │
│     │                                                             │
│     ├─ 回合写入 session JSONL                                     │
│     ├─ 会话保持打开，等待下一条用户消息                            │
│     └─ 没有显式的"会话关闭"标志                                   │
│                                                                   │
│  渠道级投递 ← 消息发送到用户                                      │
│     │                                                             │
│     └─ sendDurableMessageBatch() → 用户看到回复                   │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Turn 级结束详细条件

```
handleAgentEnd(ctx, lastAssistant)
    │
    ├─ 常规完成
    │   ├─ payloads.length > 0
    │   ├─ stopReason: "stop" | "end_turn"
    │   └─ terminalLifecyclePhase: "finishing"
    │
    ├─ 静默完成
    │   ├─ payloads.length === 0（或仅有 SILENT_REPLY_TOKEN）
    │   ├─ terminalReplyKind: "silent-empty"
    │   └─ 不投递消息到用户
    │
    ├─ 错误完成
    │   ├─ isError: true
    │   ├─ stop_reason === "error"
    │   └─ 返回错误文本给用户
    │
    ├─ 中断完成
    │   ├─ aborted: true
    │   └─ 用户中断 → 不投递
    │
    └─ 不完整完成
        ├─ stop_reason missing 或不识别
        ├─ incomplete_turn error
        └─ "⚠️ Agent couldn't generate a response."
```

### 特定场景的结束标志

| 场景           | 结束标志                                             | 行为                                |
| -------------- | ---------------------------------------------------- | ----------------------------------- |
| 正常对话       | `stop_reason: "stop"`                                | 回复文本发送给用户                  |
| 工具调用完成   | `stop_reason: "tool_calls"` → 执行后循环             | 多轮 LLM 调用的最后文本             |
| 超时           | `timedOut: true`                                     | 返回超时错误消息                    |
| 用户中断       | `aborted: true`                                      | 不回复，或返回中断消息              |
| 空回复         | `terminalReplyKind: "silent-empty"`                  | 静默，不投递                        |
| 推理-only 回复 | `agentHarnessResultClassification: "reasoning-only"` | 重新提示模型生成可见回复            |
| 只调用消息工具 | `didSendViaMessagingTool: true`                      | 消息工具已发送，抑制 Agent 确认文本 |
| 心跳           | `heartbeatToolResponse`                              | 生成心跳 tick 状态，不投递文本      |
| 上下文溢出     | `error: "context_overflow"`                          | 触发自动 compaction，压缩后继续     |
| 权限拒绝       | `failureSignal: { kind: "execution_denied" }`        | 工具权限拒绝，Cron 任务标记为 fatal |

### 关键代码中的结束检查

```typescript
// V1: agent-session.ts 的结束循环
while (await this.handlePostAgentRun()) {
    await this.agent.continue();
}

handlePostAgentRun():
    msg = lastAssistantMessage
    msg.stopReason === "error" + retryable → prepareRetry → return true (继续)
    msg.stopReason === "error" + !retryable → emit error → return false (结束)
    其他 → checkCompaction(msg)
        compaction 需要 → compact → return true (继续)
        不需要 → return false (结束)
```

```typescript
// V2: run.ts 的 while(true) 循环退出条件
// 正常路径：
//   stop_reason === "stop" | "end_turn" → 有 payload → break
// 错误恢复路径：
//   各种 retry check → continue
//   超过 retry limit → break (error)
//   超时 → break (timeout)
```

---

## 9. 完整流程图

```
用户输入 "帮我查北京天气"
    │
    ▼
[提示词组装 → 模型调用]
    │
    ▼
[模型流式返回]
    │
    ├─ text_delta: "我来帮你查"
    ├─ text_delta: "北京天气"
    ├─ toolcall_start: web_search("北京天气")
    └─ finish_reason: "tool_calls"
          │
          ▼
    [message_end → handleAgentEnd]
          │
          ├─ stop_reason === "tool_calls"
          ├─ assistantTexts = ["我来帮你查北京天气"]
          └─ handleAgentEnd → continue = true
                │
                ▼
          [工具执行调度]
                │
                ├─ 并行: none
                ├─ 串行: web_search → "北京晴 20-28°C"
                └─ tool result → 追加为 tool 消息
                      │
                      ▼
          [模型继续调用 (continue)]
                │
                ▼
          [模型流式返回]
                │
                ├─ text_delta: "北京今天晴，20-28°C"
                ├─ (无 tool_calls)
                └─ finish_reason: "stop"
                      │
                      ▼
          [message_end → handleAgentEnd]
                │
                ├─ stop_reason === "stop"
                ├─ assistantTexts = ["我来帮你查北京天气", "北京今天晴，20-28°C"]
                └─ handleAgentEnd → continue = false → break
                      │
                      ▼
          [buildEmbeddedRunPayloads]
                │
                ├─ assistantTexts → 拼接文本
                ├─ 无 tool error → 跳过错误摘要
                └─ payloads = [{ text: "我来帮你查北京天气" + "北京今天晴，20-28°C" }]
                      │
                      ▼
          [run.ts 返回 payloads]
                │
                ├─ meta = { finalAssistantVisibleText: "北京今天晴，20-28°C", ... }
                └─ 回到 dispatchFromConfig → ReplyDispatcher → 渠道发送
                      │
                      ▼
          用户看到: "我来帮你查北京天气，北京今天晴，20-28°C"
```

---

## 附录：关键文件索引

| 模块         | 文件                                             | 作用                                  |
| ------------ | ------------------------------------------------ | ------------------------------------- |
| 流处理       | `openai-transport-stream.ts`                     | SSE 解析 + stop_reason 映射           |
| 流处理       | `anthropic-transport-stream.ts`                  | Anthropic MBX 流解析                  |
| 事件分发     | `embedded-agent-subscribe.handlers.ts`           | 流事件→处理器路由                     |
| 文本累积     | `embedded-agent-subscribe.handlers.messages.ts`  | text_delta 累积 + 消息结束处理        |
| 工具执行     | `embedded-agent-subscribe.handlers.tools.ts`     | 工具执行启动/更新/结束                |
| 生命周期     | `embedded-agent-subscribe.handlers.lifecycle.ts` | handleAgentEnd + assistantTexts 传递  |
| 主循环       | `embedded-agent-runner/run.ts`                   | while(true) + payload 组装 + 错误恢复 |
| Payload 构造 | `embedded-agent-runner/run/payloads.ts`          | buildEmbeddedRunPayloads              |
| 状态类型     | `embedded-agent-subscribe.handlers.types.ts`     | assistantTexts 状态定义               |
| 返回类型     | `embedded-agent-runner/types.ts`                 | EmbeddedAgentRunResult + meta         |
| V1 循环      | `sessions/agent-session.ts`                      | prompt + handlePostAgentRun 循环      |
