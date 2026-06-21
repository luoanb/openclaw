关于循环# OpenClaw 用户输入到回复完整链路（User Input → Agent Reply Lifecycle）

> 范围：从用户通过渠道发送一条消息开始，到 Agent 回复送达用户结束。
> 覆盖入站、会话、提示词组装、模型调用、工具执行、出站投递全流程。

---

## 目录

1. [链路总览](#1-链路总览)
2. [Phase 1 — 渠道入站](#2-phase-1--渠道入站channel-inbound)
3. [Phase 2 — 入站处理](#3-phase-2--入站处理inbound-processing)
4. [Phase 3 — 指令检测](#4-phase-3--指令检测command-detection)
5. [Phase 4 — 自动回复调度](#5-phase-4--自动回复调度auto-reply-dispatch)
6. [Phase 5 — 会话上下文构建](#6-phase-5--会话上下文构建session-context)
7. [Phase 6 — 提示词组装](#7-phase-6--提示词组装prompt-assembly)
8. [Phase 7 — 模型调用](#8-phase-7--模型调用model-call)
9. [Phase 8 — 工具执行循环](#9-phase-8--工具执行循环tool-execution-loop)
10. [Phase 9 — 回复后处理](#10-phase-9--回复后处理post-reply-processing)
11. [Phase 10 — 出站投递](#11-phase-10--出站投递outbound-delivery)
12. [Phase 11 — Transcript 持久化](#11-phase-11--transcript-持久化)
13. [Phase 12 — 上下文引擎维护](#12-phase-12--上下文引擎维护context-engine-maintenance)
14. [并发与排队控制](#14-并发与排队控制concurrency-and-queueing)

---

## 各阶段摘要

### Phase 1 — 渠道入站

|          |                                                                   |
| -------- | ----------------------------------------------------------------- |
| **输入** | 用户在渠道（Telegram/Signal/WebChat/飞书等）发送的消息            |
| **输出** | 标准化渠道上下文对象（Body、Media、Sender、ChatType、SessionKey） |

### Phase 2 — 入站处理

|          |                                                                         |
| -------- | ----------------------------------------------------------------------- |
| **输入** | 原始渠道上下文（含 Body、Quote、Forward、Thread 元数据）                |
| **输出** | 清理后的入站上下文（Body/CommandBody 已分离，标签已清除，Media 已解析） |

### Phase 3 — 指令检测

|          |                                                            |
| -------- | ---------------------------------------------------------- |
| **输入** | 标准化后的用户消息文本                                     |
| **输出** | 检测到的指令类型：普通消息 / Bang 命令 / 斜杠命令 / 无操作 |

### Phase 4 — 自动回复调度

|          |                                                                    |
| -------- | ------------------------------------------------------------------ |
| **输入** | 入站上下文 + Agent 配置 + 会话绑定信息                             |
| **输出** | 选中的 Agent 和 Harness（OpenAI/Codex/ACP）+ 启动的 Agent 执行回合 |

### Phase 5 — 会话上下文构建

|          |                                                          |
| -------- | -------------------------------------------------------- |
| **输入** | 历史会话记录（session JSONL）+ 系统事件队列 + 群组上下文 |
| **输出** | 压缩/折叠后的消息数组 + 格式化系统事件文本               |

### Phase 6 — 提示词组装

|          |                                                        |
| -------- | ------------------------------------------------------ |
| **输入** | 引导文件 + 工具列表 + 技能声明 + 会话消息 + 运行时信息 |
| **输出** | 完整的系统提示词 + 当前用户消息（含运行时代码块）      |

### Phase 7 — 模型调用

|          |                                               |
| -------- | --------------------------------------------- |
| **输入** | System Prompt + Messages + Tools Schema       |
| **输出** | 模型回复（文本 + 工具调用请求）+ 令牌用量统计 |

### Phase 8 — 工具执行循环

|          |                                                              |
| -------- | ------------------------------------------------------------ |
| **输入** | 模型的工具调用请求（read/write/exec/web_search 等）          |
| **输出** | 工具执行结果 → 装配成新的 assistant/tool 消息 → 继续模型调用 |

### Phase 9 — 回复后处理

|          |                                                |
| -------- | ---------------------------------------------- |
| **输入** | 模型最终文本回复                               |
| **输出** | 清理后的回复文本（去掉令牌标记/心跳标记/指令） |

### Phase 10 — 出站投递

|          |                               |
| -------- | ----------------------------- |
| **输入** | 清理后的回复文本 + Media 附件 |
| **输出** | 通过渠道插件发送给用户的消息  |

### Phase 11 — Transcript 持久化

|          |                                                   |
| -------- | ------------------------------------------------- |
| **输入** | 当前回合的 User 消息 + Assistant 消息 + Tool 消息 |
| **输出** | 追加写入 session JSONL 文件                       |

### Phase 12 — 上下文引擎维护

|          |                                             |
| -------- | ------------------------------------------- |
| **输入** | 持久化后的完整会话消息数组                  |
| **输出** | 压缩/摘要/重写后的会话记录，释放 Token 预算 |

---

## 1. 链路总览

```
用户: "请帮我查一下今天的天气"
  │
  ▼
┌──────────────────────────────────────────────────┐
│              渠道层（Channel Layer）               │
│                                                    │
│  Telegram / Signal / WebChat / 飞书 / Discord ...  │
│    ↓                                                │
│  Gateway HTTP/WebSocket Endpoint                   │
│    ↓                                                │
│  gateway → channel plugin → rewrite ctx            │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────┐
│            入站处理（Inbound Processing）          │
│                                                    │
│  finalizeInboundContext(ctx)                       │
│    ├─ 提取 Quote/Forward/Thread 元数据              │
│    ├─ 清理 Body（移除系统标签、统一换行）            │
│    ├─ 分离 CommandBody / BodyForAgent               │
│    ├─ 解析 Media（图片/音频/文件）                  │
│    └─ 标准化 ChatType（direct/group/channel/thread）│
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────┐
│            指令检测（Command Detection）           │
│                                                    │
│  resolveCommandTurnContext(ctx)                    │
│    ├─ / 前缀 → 斜杠命令（/help, /reset, ...）     │
│    ├─ bang 前缀 → Bang 命令（!search, ...）       │
│    └─ 普通文本 → 正常 Agent 回复                  │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────┐
│          自动回复调度（Auto-Reply Dispatch）       │
│                                                    │
│  getReply(cfg, ctx)                                │
│    ├─ resolveAgentConfig() → 确定 Agent           │
│    ├─ resolveInboundMessageHookContext() → 钩子    │
│    ├─ dispatchReplyFromConfig()                    │
│    │   ├─ 插件钩子（before_prompt, message_received）│
│    │   ├─ 排队策略检查                             │
│    │   ├─ 会话绑定/创建                           │
│    │   ├─ 选择 Harness（OpenAI/Codex/ACP）        │
│    │   └─ 启动 Agent 回合                         │
│    └─ runPreparedReply() → 进入执行阶段           │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────┐
│             执行阶段（Agent Execution）            │
│                                                    │
│  runPreparedReply(ctx, session, agentConfig)       │
│    │                                                │
│    ├─ Phase 5: 会话上下文构建                      │
│    │   ├─ drainFormattedSystemEvents()              │
│    │   ├─ buildSessionContext() → 压缩历史          │
│    │   ├─ buildGroupChatContext()（群聊）           │
│    │   └─ buildInboundMetaSystemPrompt()            │
│    │                                                │
│    ├─ Phase 6: 提示词组装                          │
│    │   ├─ buildAgentSystemPrompt() → system prompt  │
│    │   ├─ buildRuntimeContextSystemContext()        │
│    │   └─ 上下文引擎 assemble() → messages         │
│    │                                                │
│    ├─ Phase 7: 模型调用                            │
│    │   ├─ OpenAI transport → HTTP API               │
│    │   ├─ Codex app-server → WebSocket/SSE          │
│    │   ├─ CLI runner → subprocess                   │
│    │   └─ ACP runner → remote ACP server            │
│    │                                                │
│    ├─ Phase 8: 工具执行循环 ← 反复执行            │
│    │   ├─ 模型返回 tool_call                        │
│    │   ├─ 执行工具（read/write/exec/search…）      │
│    │   ├─ 结果作为 tool 消息追加                    │
│    │   └─ 继续模型调用 → 直到模型返回文本          │
│    │                                                │
│    └─ Phase 9: 回复后处理                          │
│        ├─ stripHeartbeatToken()                     │
│        ├─ strip SILENT_REPLY_TOKEN                  │
│        └─ 格式化回复内容                            │
│                                                    │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────┐
│             出站阶段（Outbound）                   │
│                                                    │
│  Phase 10: 出站投递                                │
│    ├─ dispatchReplyFromConfig() → dispatcher       │
│    ├─ 复制回复 Payload 元数据                      │
│    ├─ 创建 ReplyDispatcher                         │
│    ├─ 渠道插件发送（sendDurableMessageBatch）      │
│    └─ Webhook 通知（如配置）                       │
│                                                    │
│  Phase 11: Transcript 持久化                       │
│    ├─ appendUserTurnTranscriptMessage()             │
│    ├─ appendAssistantMessageToSessionTranscript()   │
│    ├─ appendToolResult...                          │
│    └─ 写入 session JSONL 文件                      │
│                                                    │
│  Phase 12: 上下文引擎维护                           │
│    ├─ afterTurn/ingest → 接收回合消息               │
│    └─ maintain()（延迟执行）→ 压缩/摘要/重写       │
│                                                    │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
             用户看到回复："北京今天晴，20-28°C"
```

---

## 2. Phase 1 — 渠道入站（Channel Inbound）

### 渠道类型

| 渠道     | 传输方式       | 消息形态                               |
| -------- | -------------- | -------------------------------------- |
| WebChat  | HTTP/WebSocket | JSON 消息体（Body, Media, SessionKey） |
| Telegram | Webhook POST   | Update 对象（message, callback_query） |
| Signal   | WebSocket      | Envelope（dataMessage, syncMessage）   |
| 飞书     | Webhook POST   | Event（message, action）               |
| Discord  | Gateway WS     | Message Create 事件                    |
| CLI      | stdin/stdout   | 原始文本                               |

### 入站流程

```
渠道 Webhook/WS Endpoint
    │
    ├─ Gateway HTTP Server
    │   ├─ 验证签名 / Token
    │   ├─ 解析为渠道插件上下文
    │   └─ 调用 channel plugin inbound handler
    │
    ├─ Channel Plugin
    │   ├─ 标准化为 MsgContext
    │   │   ├─ Body: 消息文本
    │   │   ├─ RawBody: 原始消息
    │   │   ├─ MediaPaths: 媒体文件路径
    │   │   ├─ From/To: 发送者/接收者
    │   │   ├─ ChatType: direct|group|channel|thread
    │   │   ├─ Quote/Forward/Thread 元数据
    │   │   └─ SessionKey: 会话标识
    │   └─ 触发 message_received 钩子
    │
    └─ 进入 auto-reply 调度
```

### 关键配置

| 配置                        | 影响               |
| --------------------------- | ------------------ |
| `channels.telegram.enabled` | Telegram 渠道启用  |
| `channels.telegram.token`   | Bot Token          |
| `channels.webchat.enabled`  | WebChat 渠道启用   |
| `gateway.allowedOrigins`    | WebSocket 来源限制 |

---

## 3. Phase 2 — 入站处理（Inbound Processing）

**文件：** `auto-reply/reply/inbound-context.ts`

### 处理流程

```
finalizeInboundContext(ctx, opts)
│
├─ applySupplementalContext(ctx)
│   ├─ Quote → ReplyToId, ReplyToBody
│   ├─ Forward → ForwardedFrom
│   ├─ Thread → ThreadStarterBody, ThreadHistoryBody
│   └─ Group → GroupSystemPrompt
│
├─ Body 清理
│   ├─ sanitizeInboundSystemTags() — 移除 <script> 等注入标签
│   └─ normalizeInboundTextNewlines() — 统一换行
│
├─ BodyForAgent / BodyForCommands 分辨率
│   ├─ BodyForAgent > Body > CommandBody > RawBody
│   └─ BodyForCommands > CommandBody > RawBody > Body
│
├─ ChatType 标准化
│   └─ → "direct" | "group" | "channel" | "thread"
│
├─ Media 处理
│   ├─ 收集 MediaPaths、MediaUrls、MediaTypes
│   └─ → normalized MediaTypes array
│
└─ 输出：标准化 ctx 对象
```

### 安全过滤

```typescript
sanitizeInboundSystemTags(); // 移除 <script> 等危险系统标签
normalizeTextField(); // 清理 + 统一换行
```

---

## 4. Phase 3 — 指令检测（Command Detection）

**文件：** `auto-reply/command-turn-detection.ts`

### 检测规则

```
resolveCommandTurnContext(ctx)
│
├─ 检测 / 前缀（斜杠命令）
│   ├─ /help → 显示帮助
│   ├─ /reset → 重置会话
│   ├─ /new → 新对话
│   └─ 自定义 → 插件注册的命令
│
├─ 检测 ! 前缀（Bang 命令）
│   └─ !search, !weather 等
│
└─ 普通文本 → 进入正常 Agent 处理
```

### 命令注册

**文件：** `auto-reply/commands-registry.ts`

```typescript
CommandsRegistry
  ├─ 内置命令：help, reset, new, status, verbose
  ├─ 插件注册命令：自定义 handler
  └─ 命令路由：匹配 → 执行 → 返回结果
```

---

## 5. Phase 4 — 自动回复调度（Auto-Reply Dispatch）

**文件：** `auto-reply/reply/dispatch-from-config.ts`
**入口函数：** `dispatchReplyFromConfig()`

### 调度流程

```
dispatchReplyFromConfig({ ctx, cfg, dispatcher })
│
├─ 1. 插件 Hook 阶段
│   ├─ message_received → 插件可以修改/拦截消息
│   ├─ before_reply → 插件可以替换回复逻辑
│   └─ reply_dispatch → 插件可以添加元数据
│
├─ 2. Agent 解析
│   ├─ resolveAgentConfig(cfg, ctx) → 确定哪个 Agent
│   ├─ resolveChannelModelOverride() → 渠道模型覆盖
│   └─ resolveSessionAgentId() → 会话绑定的 Agent
│
├─ 3. 会话绑定
│   ├─ 新会话 → createSession()
│   ├─ 已有会话 → loadSession()
│   └─ 群组 → resolveGroupSessionKey()
│
├─ 4. Harness 选择
│   ├─ resolveAgentHarnessPolicy()
│   │   ├─ OpenAI transport → 标准 Chat Completion API
│   │   ├─ Codex app-server → WebSocket/SSE 连接
│   │   ├─ CLI runner → 子进程 CLI
│   │   └─ ACP runner → 远程 ACP 协议
│   └─ selectAgentHarness()
│
├─ 5. 排队策略
│   ├─ resolveQueueSettings() → 检查是否排队
│   ├─ 同一会话已有活跃回合 → 加入队列
│   └─ 不同会话 → 并行执行
│
└─ 6. 执行启动
    ├─ runPreparedReply() → 进入执行管道
    └─ 返回 ReplyPayload 给 Dispatcher
```

### 调度决策树

```
用户消息
    │
    ├─ 插件拦截 → 插件处理，返回结果
    ├─ 命令匹配 → 命令执行，返回结果
    └─ Agent 回复
        ├─ 有活跃回合 → 排队等待
        ├─ 新会话 → 创建会话 + 构建上下文
        └─ 已有会话 → 加载历史 + 构建上下文
              │
              ▼
        选择 Harness → 启动执行
```

---

## 6. Phase 5 — 会话上下文构建（Session Context）

**文件：** `auto-reply/reply/get-reply-run.ts`

### 构建流程

```
runPreparedReply(ctx, session, agentConfig)
│
├─ drainFormattedSystemEvents(sessionKey)
│   ├─ 清空系统事件队列
│   ├─ 格式化时间戳
│   └─ 过滤非关键事件
│
├─ buildSessionContext(sessionKey)
│   ├─ parseSessionEntries() → 解析 JSONL
│   ├─ 折叠/压缩历史消息
│   │   ├─ 连续相同角色的消息 → 合并
│   │   ├─ 过长的工具结果 → 截断
│   │   └─ 超过 Token 预算 → 丢弃最旧
│   └─ 输出 messages[]
│
├─ buildGroupChatContext()（群聊时）
│   ├─ 群组系统提示
│   └─ 群组对话历史
│
├─ buildInboundMetaSystemPrompt()
│   ├─ 渠道元信息
│   ├─ 发送者身份
│   └─ 引用/转发上下文
│
└─ 输出：组装好的消息数组 + 额外系统提示
```

### 历史压缩策略

| 条件                 | 处理                         |
| -------------------- | ---------------------------- |
| 消息数 > budget      | 丢弃最旧的 user/assistant 对 |
| 相邻同角色           | 折叠为一条                   |
| Tool 结果 > maxChars | 截断                         |
| 系统事件             | 格式化后插入                 |

---

## 7. Phase 6 — 提示词组装（Prompt Assembly）

> 详见 `docs/prompt-integration-pipeline.md`

### 组装结构

```
buildAgentSystemPrompt(params)
│
├─ 稳定部分（缓存）
│   ├─ Tool 列表
│   ├─ 执行指令（Interaction Style、Execution Bias、Safety）
│   ├─ 技能声明 <available_skills>
│   ├─ 模型别名
│   ├─ Project Context（SOUL.md, MEMORY.md, TOOLS.md...）
│   └─ 文档路径
│
├─ <!-- OPENCLAW_CACHE_BOUNDARY -->
│
├─ 动态部分
│   ├─ HEARTBEAT.md（心跳配置）
│   ├─ 消息传递指令
│   ├─ 群组/子 Agent 上下文
│   ├─ 运行时行（agent/session/model/reasoning...）
│   └─ Control UI 嵌入说明
│
└─ 输出：系统提示词文本
```

### 运行时上下文注入

```
<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>
[运行时事件、子 Agent 回传、内部完成事件]
<<<END_OPENCLAW_INTERNAL_CONTEXT>>>
```

---

## 8. Phase 7 — 模型调用（Model Call）

### 调用路由

```
┌─────────────────────────────────────────────────────────────┐
│                   selectAgentHarness()                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  runtime: "openclaw"                                        │
│    → OpenAI 兼容 HTTP API                                   │
│    → POST /v1/chat/completions                              │
│    → { model, messages, tools, stream: true }               │
│    → streaming SSE response                                 │
│                                                             │
│  runtime: "codex"                                           │
│    → 连接 Codex app-server WebSocket                        │
│    → developerInstructions = system prompt                  │
│    → collaborationInstructions = extra context              │
│    → SSE + thread management                                │
│                                                             │
│  runtime: "cli"                                             │
│    → 启动子进程（claude-cli 等）                             │
│    → stdin = prompt                                         │
│    → stdout = response                                      │
│                                                             │
│  runtime: "acp"                                             │
│    → ACP 协议远程执行                                       │
│    → POST /acp/v1/runs                                      │
│    → 等待远端执行完成                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 模型调用参数

| 参数          | 来源                             | 作用     |
| ------------- | -------------------------------- | -------- |
| `model`       | Agent 配置 / 渠道覆盖 / 用户指定 | 模型选择 |
| `messages`    | 系统提示 + 历史 + 当前消息       | 对话输入 |
| `tools`       | Agent 可用工具架构               | 工具定义 |
| `stream`      | 根据渠道支持                     | 是否流式 |
| `max_tokens`  | Agent 配置                       | 输出上限 |
| `temperature` | Agent 配置                       | 随机性   |

### 流式处理

```
model stream chunks
    │
    ├─ 逐 chunk 解析 delta
    ├─ 累积文本内容
    ├─ 累积 tool_call 增量
    ├─ 转发给 dispatcher（实时进度）
    └─ 最终 → 完整的 assistant message
```

---

## 9. Phase 8 — 工具执行循环（Tool Execution Loop）

### 循环模型

```
模型返回
    │
    ├─ 文本回复 → 进入 Phase 9
    │
    └─ tool_calls[]
        │
        ├─ 逐工具执行（并行或串行）
        │   ├─ read(path)       → 文件内容
        │   ├─ write(path,content) → 写入结果
        │   ├─ edit(path,edits) → 编辑结果
        │   ├─ exec(cmd)        → 命令输出
        │   ├─ web_search(query) → 搜索结果
        │   ├─ web_fetch(url)   → 页面内容
        │   └─ 其他自定义工具    → 插件结果
        │
        ├─ 每个结果作为 tool 消息追加
        │
        └─ 继续模型调用
            ├─ 模型继续调用工具 → 循环
            └─ 模型返回文本     → 跳出
```

### 执行策略

| 条件               | 策略                       |
| ------------------ | -------------------------- |
| 多个独立 tool_call | 并行执行                   |
| 依赖链             | 串行执行                   |
| 超时               | 工具级别超时               |
| 失败               | 错误信息作为 tool 结果回传 |

### 重试与错误处理

```
工具执行失败
    ├─ 超出超时 → 返回超时错误
    ├─ 权限拒绝 → 返回权限错误
    ├─ 网络错误 → 自动重试（最多 N 次）
    └─ 不可恢复 → 返回错误信息，由模型决定下一步
```

---

## 10. Phase 9 — 回复后处理（Post-Reply Processing）

### 处理流程

```
模型最终文本回复
    │
    ├─ 清理指令标记
    │   ├─ stripHeartbeatToken() → 移除心跳令牌
    │   ├─ SILENT_REPLY_TOKEN → 静默回复标记
    │   └─ TTS 指令清理
    │
    ├─ 格式化输出
    │   ├─ 文本分段
    │   └─ Media 附件关联
    │
    ├─ 生成 ReplyPayload
    │   ├─ text: 回复文本
    │   ├─ mediaUrls: 媒体附件
    │   └─ presentation: 展示格式
    │
    └─ 输出：ReplyPayload
```

### 静默回复

```typescript
SILENT_REPLY_TOKEN; // 回复内容仅为 token → 不投递
HEARTBEAT_TOKEN; // 心跳确认 → 根据策略决定是否投递
```

---

## 11. Phase 10 — 出站投递（Outbound Delivery）

### 投递流程

```
ReplyPayload
    │
    ├─ dispatchFromConfig() → dispatcher
    │
    ├─ copyReplyPayloadMetadata()
    │   ├─ 复制元数据
    │   └─ 合并渠道信息
    │
    ├─ createReplyDispatcher()
    │
    ├─ 投递前 Hook
    │   ├─ runReplyPayloadSendingHook()
    │   └─ 插件可修改/拦截投递
    │
    ├─ 渠道发送
    │   ├─ sendDurableMessageBatch()
    │   │   ├─ Telegram → bot.sendMessage()
    │   │   ├─ WebChat → WS push
    │   │   ├─ 飞书 → send message API
    │   │   └─ Signal → sendMessage()
    │   └─ 流式发送（如渠道支持）
    │
    ├─ 投递确认
    │   ├─ 成功 → deliveryStatus = "delivered"
    │   └─ 失败 → deliveryStatus = "not-delivered" + 错误
    │
    └─ 投递后回调
        ├─ mirrorDeliveredReplyToTranscript()
        └─ clearPendingFinalDelivery()
```

### 投递模式

| 模式       | 说明                     |
| ---------- | ------------------------ |
| `直接发送` | 同步等待渠道发送完成     |
| `流式推送` | WebSocket 逐 chunk 推送  |
| `消息队列` | 发送到消息队列，异步投递 |
| `Webhook`  | POST 到指定 URL          |

### 投递重试

```typescript
sendDurableMessageBatch()
    ├─ 渠道不可用 → 排队等待重试
    ├─ 暂时失败 → 指数退避重试
    └─ 永久失败 → 返回错误
```

---

## 12. Phase 11 — Transcript 持久化

### 写入内容

| 消息类型         | 写入时机         | 存储格式 |
| ---------------- | ---------------- | -------- |
| User 消息        | 入站处理完成后   | JSONL 行 |
| Assistant 消息流 | 流式完成 + 最终  | JSONL 行 |
| Tool 调用/结果   | 每个工具执行完成 | JSONL 行 |
| 系统事件         | 回合边界         | JSONL 行 |

### 文件结构

```
sessions/<sessionKey>.jsonl
    │
    ├─ {"role": "user", "content": "..."}
    ├─ {"role": "assistant", "content": "...", "tool_calls": [...]}
    ├─ {"role": "tool", "content": "...", "tool_call_id": "..."}
    └─ ...
```

### 写入策略

```typescript
persistTextTurnTranscript(params)
    ├─ 获取文件锁（allowReentrant）
    ├─ appendUserTurnTranscriptMessage()
    ├─ appendSessionTranscriptMessage()
    ├─ 嵌入式助理间隙填充
    └─ 去重尾部相同 assistant 回复
```

---

## 13. Phase 12 — 上下文引擎维护（Context Engine Maintenance）

### 维护流程

```
回合持久化后
    │
    ├─ afterTurn() / ingest()
    │   ├─ 接收本回合所有消息
    │   └─ 可选：立即压缩
    │
    └─ maintain()（延迟执行）
        ├─ 时机：会话通道空闲后执行
        ├─ 模式：
        │   ├─ 即时维护（foreground，小会话）
        │   └─ 延迟维护（background，大会话）
        └─ 输出：{ changed, rewrittenEntries, bytesFreed }
```

### 维护操作

| 操作       | 说明                      |
| ---------- | ------------------------- |
| 压缩       | 合并相邻用户消息          |
| 摘要       | 将旧对话生成为摘要        |
| 重写       | 清理无效/重复条目         |
| Token 释放 | 减少上下文引擎 Token 占用 |

---

## 14. 并发与排队控制（Concurrency and Queueing）

### 会话级别排队

```
同一 SessionKey
    │
    ├─ 用户 A 发送消息 1 → 开始执行
    ├─ 用户 A 发送消息 2 → 排队等待
    ├─ 用户 B 发送消息 3 → 不同 session → 并行执行
    └─ 消息 1 完成 → 消息 2 开始执行
```

### ACP Session Actor Queue

```
SessionActorQueue.run(actorKey, op)
    ├─ 同一 actorKey → FIFO 串行
    └─ 不同 actorKey → 并行

actorKey = sessionKey（每会话一个队列）
```

### 渠道顺序保证

```
同一渠道的消息
    ├─ 同会话 → 按接收顺序串行处理
    └─ 不同会话 → 并行处理
```

---

## 附录：关键文件索引

| 阶段 | 核心文件                                    | 作用               |
| ---- | ------------------------------------------- | ------------------ |
| 1    | `gateway/server*.ts`                        | HTTP/WS 服务端     |
| 1    | `channels/plugins/*`                        | 渠道插件           |
| 2    | `auto-reply/reply/inbound-context.ts`       | 入站规范化         |
| 3    | `auto-reply/command-turn-detection.ts`      | 指令检测           |
| 3    | `auto-reply/commands-registry.ts`           | 命令注册           |
| 4    | `auto-reply/reply/dispatch-from-config.ts`  | 调度主流程         |
| 4    | `auto-reply/reply/get-reply.ts`             | 回复入口           |
| 4    | `auto-reply/reply/get-reply-run.ts`         | 回复执行           |
| 5    | `auto-reply/reply/session-system-events.ts` | 系统事件格式化     |
| 5    | `sessions/*`                                | 会话管理           |
| 6    | `agents/system-prompt.ts`                   | 系统提示组装       |
| 6    | `agents/bootstrap-files.ts`                 | 引导文件加载       |
| 6    | `auto-reply/reply/inbound-meta.ts`          | 入站元提示         |
| 7    | `agents/harness/*`                          | Harness 选择与执行 |
| 7    | `auto-reply/model.ts`                       | 模型调用           |
| 8    | `agents/embedded-agent-runner/*`            | Agent 执行器       |
| 8    | 各 Tool 实现                                | read/write/exec 等 |
| 9    | `auto-reply/heartbeat.ts`                   | 心跳标记清理       |
| 9    | `auto-reply/tokens.ts`                      | 静默回复标记       |
| 10   | `channels/message/runtime.ts`               | 消息发送           |
| 10   | `auto-reply/reply/reply-dispatcher.ts`      | 回复调度器         |
| 11   | `sessions/*`                                | Transcript 持久化  |
| 11   | `auto-reply/reply/get-reply-run.ts`         | 回合写入           |
| 12   | `agents/context-engine-lifecycle.ts`        | 上下文引擎维护     |
