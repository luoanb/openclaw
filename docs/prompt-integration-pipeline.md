# OpenClaw 提示词整合管道（Prompt Integration Pipeline）

> 范围：从用户输入的原始文本开始，到最终交付给模型的内容结束。
> 系统级、全面分析，记录了所有中间阶段、参与模块和数据流。

---

## 目录

1. [管道总览](#1-管道总览)
2. [Phase 1 — 入站处理](#2-phase-1--入站处理inbound-processing)
3. [Phase 2 — 会话上下文构建](#3-phase-2--会话上下文构建session-context)
4. [Phase 3 — 引导文件加载](#4-phase-3--引导文件加载bootstrap-files)
5. [Phase 4 — 系统提示词组装](#5-phase-4--系统提示词组装system-prompt)
6. [Phase 5 — 运行时代码注入](#6-phase-5--运行时代码注入runtime-context)
7. [Phase 6 — 插件/钩子系统处理](#7-phase-6--插件钩子系统处理hooks)
8. [Phase 7 — 上下文引擎处理](#8-phase-7--上下文引擎处理context-engine)
9. [Phase 8 — 最终模型调用](#9-phase-8--最终模型调用model-call)
10. [Phase 9 — 回合后处理](#10-phase-9--回合后处理post-turn)
11. [缓存机制](#11-缓存机制)
12. [文件索引与导入关系](#12-文件索引与导入关系)

---

## 各阶段摘要

### Phase 1 — 入站处理

|          |                                                                                  |
| -------- | -------------------------------------------------------------------------------- |
| **输入** | 渠道原始消息（Body、RawBody、MediaPaths、ChatType、Quote/Forward/Thread 元数据） |
| **输出** | 标准化后的入站上下文对象（清理过的 Body、规范化 ChatType、解析后的 MediaTypes）  |

### Phase 2 — 会话上下文构建

|          |                                                                   |
| -------- | ----------------------------------------------------------------- |
| **输入** | 系统事件队列（Cron/心跳/节点事件）+ 历史会话记录（session JSONL） |
| **输出** | 格式化的系统事件文本块 + 当前会话消息数组（已折叠/压缩）          |

### Phase 3 — 引导文件加载

|          |                                                                                                             |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| **输入** | 工作区引导文件（SOUL.md、MEMORY.md、TOOLS.md、AGENTS.md、IDENTITY.md、USER.md、BOOTSTRAP.md、HEARTBEAT.md） |
| **输出** | 加载并截断后的文件内容列表（File[]），含缺失标记                                                            |

### Phase 4 — 系统提示词组装

|          |                                                                                       |
| -------- | ------------------------------------------------------------------------------------- |
| **输入** | 工具架构列表 + 引导文件内容 + 技能声明 + 模型别名 + 运行时信息（时间/时区/Agent身份） |
| **输出** | 完整的系统提示词文本（含缓存边界标记，分隔稳定部分与动态部分）                        |

### Phase 5 — 运行时代码注入

|          |                                                                     |
| -------- | ------------------------------------------------------------------- |
| **输入** | 运行时事件（系统事件、子 Agent 回传、内部完成事件）                 |
| **输出** | 包裹在 `<<<BEGIN/END_OPENCLAW_INTERNAL_CONTEXT>>>` 中的运行时代码块 |

### Phase 6 — 插件/钩子系统处理

|          |                                                                               |
| -------- | ----------------------------------------------------------------------------- |
| **输入** | 插件注册的钩子回调（agent_turn_prepare、before_prompt_build）+ 回合间注入队列 |
| **输出** | 注入到系统提示词前后、用户消息前后的上下文块                                  |

### Phase 7 — 上下文引擎处理

|          |                                                             |
| -------- | ----------------------------------------------------------- |
| **输入** | 全部消息数组 + Token 预算 + 可用工具                        |
| **输出** | 压缩/选择/投影后的消息数组（assemble 输出）+ 回合后维护结果 |

### Phase 8 — 最终模型调用

|          |                                       |
| -------- | ------------------------------------- |
| **输入** | System Prompt + Messages + Tools 架构 |
| **输出** | 模型回复（文本内容 + 工具调用请求）   |

### Phase 9 — 回合后处理

|          |                                                           |
| -------- | --------------------------------------------------------- |
| **输入** | 模型回复结果                                              |
| **输出** | 持久化的 transcript（JSONL 写入）+ 上下文引擎延迟维护状态 |

### 缓存机制

|          |                                                                                   |
| -------- | --------------------------------------------------------------------------------- |
| **输入** | 稳定输入因子（workspaceDir、toolLines、skillsPrompt、stableContextFiles hash 等） |
| **输出** | 缓存命中 → 跳过渲染；缓存未命中 → 构建并存入 LRU 缓存（最大 64 项）               |

---

## 1. 管道总览

```
用户输入文本
    │
    ▼
[1] 入站处理 (inbound-context.ts)
    │  系统标签清理、Body/Command 规范化、媒体解析
    ▼
[2] 系统事件队列 (system-events.ts)
    │  Cron/会话事件入队，回合边界清空
    ▼
[3] 会话上下文 (session-manager)
    │  构建 sessionContext（messages + metadata）
    ▼
[4] 引导文件加载 (bootstrap-files.ts → workspace.ts)
    │  加载 SOUL.md, IDENTITY.md, MEMORY.md, TOOLS.md, AGENTS.md, BOOTSTRAP.md, HEARTBEAT.md
    │  应用 maxChars / totalMaxChars 截断
    ▼
[5] 系统提示词组装 (system-prompt.ts)
    │  → Tool 列表描述
    │  → 指令（Interaction Style、Execution Bias、Safety、Messaging...）
    │  → 技能声明（<available_skills>）
    │  → 内存声明（MEMORY.md）
    │  → Project Context（工作区文件渲染）
    │  → Cache Boundary 分割稳定/动态部分
    ▼
[6] 运行时代码注入 (runtime-context-prompt.ts)
    │  → <<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>
    │  → 会话/事件运行时上下文（System events, inbound metadata, etc.）
    │  → <<<END_OPENCLAW_INTERNAL_CONTEXT>>>
    ▼
[7] 插件/钩子系统处理 (attempt.prompt-helpers.ts)
    │  → agent_turn_prepare 钩子
    │  → before_prompt_build 钩子
    │  → 回合间注入（next-turn injection）
    ▼
[8] 上下文引擎处理 (context-engine-lifecycle.ts)
    │  → assemble()：修改消息数组（压缩/选择/投影）
    ▼
[9] 模型调用 (Codex / OpenAI / CLI / ACP)
    │  → 发送 system + messages → 模型
    ▼
[10] 回合后处理
     → contextEngine.afterTurn() / ingest()
     → 持久化 transcript
     → contextEngine.maintain()（延迟压缩）
```

---

## 2. Phase 1 — 入站处理（Inbound Processing）

**文件：** `inbound-context.ts`（dist: `inbound-context-CZx-NgvC.js`）

### 输入

- 渠道原始上下文对象（`ctx`），包含：`Body`, `RawBody`, `MediaPaths`, `MediaUrls`, `ChatType`, `CommandBody`, `Transcript`, `GroupSystemPrompt`, `SupplementalContext` 等

### 处理流程

```
finalizeInboundContext(ctx, opts)
│
├─ applySupplementalContext(ctx)
│   │  提取引用/转发/线程/群组信息
│   │  Quote → ReplyToId, ReplyToBody
│   │  Forward → ForwardedFrom 等
│   │  Thread → ThreadStarterBody, ThreadHistoryBody
│   │  Group → GroupSystemPrompt
│   │  Untrusted → UntrustedStructuredContext
│
├─ Body 清理
│   │  sanitizeInboundSystemTags() — 移除 `<script>` 等危险标签
│   │  normalizeInboundTextNewlines() — 统一换行
│
├─ BodyForAgent / BodyForCommands 分辨率
│   │  优先级：BodyForAgent > Body > CommandBody > RawBody
│   │  BodyForCommands > CommandBody > RawBody > Body
│
├─ ChatType 标准化
│   │  → "direct" | "group" | "channel" | "thread"
│
├─ ConversationLabel 分辨率
│   │  resolveConversationLabel() — 渠道/群组/话题标签
│
├─ CommandTurn 检测
│   │  resolveCommandTurnContext()
│   │  → 检测 / 前缀 bang 命令，标注 authorized
│
├─ Media 处理
│   │  收集 MediaPaths、MediaUrls、MediaTypes
│   │  → normalizes to MediaTypes array
│
└─ 输出：标准化 ctx 对象（Body, RawBody, ChatType, MediaPaths, MediaTypes...）
```

### 关键函数

| 函数                          | 作用                    |
| ----------------------------- | ----------------------- |
| `finalizeInboundContext()`    | 所有入站规范化的入口    |
| `normalizeTextField()`        | 清理系统标签 + 统一换行 |
| `sanitizeInboundSystemTags()` | 移除注入的系统标签      |
| `resolveCommandTurnContext()` | 检测命令式请求          |

---

## 3. Phase 2 — 会话上下文构建

### 系统事件队列

**文件：** `system-events.ts`（dist: `system-events--U8AE18s.js`）

- 系统事件（Cron 唤醒、心跳、节点事件、会话通知）通过 `enqueueSystemEventEntry()` 入队
- 每会话最多保留 20 条
- 去重：连续重复事件自动丢弃
- `consumeSelectedSystemEventEntries()` / `drainSystemEventEntries()` 在回合边界清空

**系统事件格式化：** `session-system-events.ts`（dist: `session-system-events-DalXCNcz.js`）

```
drainFormattedSystemEvents(params)
│
├─ 选择非 exec-completion 事件
├─ 压缩/过滤：
│   │  过滤 "reason periodic"、"Read HEARTBEAT.md"、心跳轮询事件
│   │  压缩 Node 事件中的 "last input" 部分
│
├─ 时区格式化：
│   │  resolveSystemEventTimezone(cfg)
│   │  → utc / local / iana 模式
│
├─ 信道摘要（主会话 + 新会话时）
│   │  buildChannelSummary() — 显示当前活跃渠道信息
│
└─ 输出：格式化字符串块 "System: [timestamp] ..."
```

### 会话消息构建

**文件：** `session-manager-g-7X6v2O.js`, `user-turn-transcript-A1c264HL.js`, `transcript-NdJkeRhp.js`

- `parseSessionEntries()` — 从 session 文件中解析 JSON 行记录
- `buildSessionContext()` — 折叠/压缩历史消息
- `appendUserTurnTranscriptMessage()` — 追加用户回合消息
- `appendSessionTranscriptMessage()` — 追加助手回合消息

---

## 4. Phase 3 — 引导文件加载（Bootstrap Files）

**文件：** `bootstrap-files.ts` → `workspace-C9ULOsP_.js`

### 加载过程

```
resolveBootstrapFilesForRun(params)
│
├─ applyContextModeFilter()
│   │  contextMode="lightweight" → 仅保留 HEARTBEAT.md
│
├─ filterCompletedWorkspaceBootstrapFile()
│   │  BOOTSTRAP.md 已完成 → 从加载列表移除
│
├─ shouldExcludeHeartbeatBootstrapFile()
│   │  非默认 Agent / 无心跳配置 → 排除 HEARTBEAT.md
│
├─ applyBootstrapHookOverrides()
│   │  插件可以修改文件列表
│
├─ sanitizeBootstrapFiles()
│   │  路径解析 & 去重
│
└─ 输出：File[]（含 path, name, content, missing 标志）
```

### 文件列表与载荷

```
┌─────────────┬──────────────┬──────────────────────────────────────┐
│ 文件名       │ 加载条件      │ 最终用途                             │
├─────────────┼──────────────┼──────────────────────────────────────┤
│ AGENTS.md   │ 始终          │ Project Context (stable)             │
│ SOUL.md     │ 始终          │ Project Context (stable)             │
│ IDENTITY.md │ 始终          │ Project Context (stable)             │
│ USER.md     │ 始终          │ Project Context (stable)             │
│ TOOLS.md    │ 始终          │ Project Context (stable)             │
│ MEMORY.md   │ 始终          │ Project Context (stable)             │
│ BOOTSTRAP.md│ 未完成时       │ Bootstrap 指令块                     │
│ HEARTBEAT.md│ 心跳启用时     │ Dynamic Project Context              │
└─────────────┴──────────────┴──────────────────────────────────────┘
```

### 文件顺序（渲染顺序）

```
CONTEXT_FILE_ORDER = [
  "agents.md"     → 10
  "soul.md"       → 20
  "identity.md"   → 30
  "user.md"       → 40
  "tools.md"      → 50
  "bootstrap.md"  → 60
  "memory.md"     → 70
]
```

### 大小限制

| 参数                     | 默认   | 作用                 |
| ------------------------ | ------ | -------------------- |
| `bootstrapMaxChars`      | config | 单个文件最大字符数   |
| `bootstrapTotalMaxChars` | config | 所有引导文件总字符数 |

---

## 5. Phase 4 — 系统提示词组装

**文件：** `system-prompt.ts`（dist: `system-prompt-config-Bg4kQKen.js`）
**入口：** `buildConfiguredAgentSystemPrompt(params)` → `buildAgentSystemPrompt(params)`

这是整个管道中最核心的阶段。组装后的 system prompt 包含以下**区块**，按渲染顺序排列：

### 区块清单

```
You are a personal assistant running inside OpenClaw.
                                  ←
## Tooling                        ← 工具列表（按 toolOrder 排序）
  Available tools are policy-filtered.
  - read: Read file contents
  - write: Create or overwrite files
  - exec: Run shell commands ...
  ...
  TOOLS.md is usage guidance, not availability.
                                  ←
## Sub-Agent Delegation           ← 子 Agent 委派指南（prefer/suggest 模式）
                                  ←
## Tool Call Style                ← 工具调用风格指令
  - Routine low-risk calls: no narration.
  - /approve 处理规则
                                  ←
## Execution Bias                 ← 执行倾向指令
  - Actionable request: act in this turn.
  - Continue until done or genuinely blocked.
                                  ←
## Safety                         ← 安全约束
  - No independent goals.
  - Do not copy yourself.
                                  ←
## OpenClaw Control               ← OpenClaw 自身控制指令
  - Config/restart: prefer `gateway` tool.
                                  ←
## Skills                         ← 技能声明
  Scan <available_skills>...
  [技能列表渲染]
                                  ←
## Memory                         ← 内存工具指令
  MEMORY.md: durable user preferences...
                                  ←
## OpenClaw Self-Update           ← 仅在可用时
                                  ←
## Model Aliases                  ← 模型别名（仅在可用时）
                                  ←
## Workspace                      ← 工作区说明
  Your working directory is: ...
  Treat this directory as...      ←
## Documentation                  ← 文档路径/源
                                  ←
## Sandbox                        ← 沙箱运行时说明（仅在启用时）
                                  ←
## Authorized Senders             ← 授权发送者列表
                                  ←
## Current Date & Time            ← 当前时间/时区
                                  ←
## Bootstrap Pending              ← 仅在 BOOTSTRAP.md 未完成时
                                  ←
## Workspace Files (injected)     ← 项目上下文文件
  [SOUL.md 内容...]
  [MEMORY.md 内容...]
  [其他文件内容...]
                                  ←
<!-- OPENCLAW_CACHE_BOUNDARY -->  ← 缓存边界（分隔稳定/动态部分）
                                  ←
## Dynamic Project Context        ← 动态文件（HEARTBEAT.md 等，在边界之后）
                                  ←
## Control UI Embed               ← WebChat Canvas 使用说明
                                  ←
## Messaging                      ← 消息传递指令
  - Reply in current session...
  - Sub-agent orchestration...
                                  ←
## Voice                          ← TTS 提示
                                  ←
## Group Chat Context             或 ## Subagent Context（如果 extraSystemPrompt）
                                  ←
## Reactions                      ← 如果启用
                                  ←
## Heartbeats                     ← 心跳指令
                                  ←
## Runtime                        ← 运行时信息
  Runtime: agent=jarvis | session=... | os=Linux | model=...
  Current model identity: ...
  Reasoning: high (hidden unless on/stream).
```

### 缓存机制

`buildAgentSystemPrompt` 使用**稳定前缀缓存**：

```
cacheStablePromptPrefix(hashStablePromptInput({...}), () => { ... })
```

- 稳定部分（工具列表、指令、Project Context 的稳定文件）通过 SHA-256 缓存
- 缓存 Key 包含：workspaceDir, promptMode, promptSurface, toolLines, capabilities, sandboxInfo, stableContextFiles hash 等
- 最大缓存 64 个条目
- 动态部分（HEARTBEAT.md、消息指导、额外系统提示）在边界**之后**渲染

### `<!-- OPENCLAW_CACHE_BOUNDARY -->`

**文件：** `system-prompt-cache-boundary.ts`

- 模型提供商可在此标记前后分别缓存
- `prependSystemPromptAdditionAfterCacheBoundary()` — 插件新增的系统提示注入在边界之后

### 系统提示词参数

**文件：** `system-prompt-params.ts`

```
buildSystemPromptParams(params) → {
  runtimeInfo: {
    agentId, sessionKey, sessionId,
    host, os, arch, node, model,
    defaultModel, shell, repoRoot
  },
  userTimezone,
  userTime,
  userTimeFormat
}
```

- `repoRoot` 解析：config `repoRoot` → Git root → 无
- `userTimezone` 解析：来自 config `agents.defaults.userTimezone`

---

## 6. Phase 5 — 运行时代码注入（Runtime Context）

**文件：** `runtime-context-prompt.ts`（dist: `runtime-context-prompt-Q7uCpeK8.js`）

### 注入结构

```
<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>
This context is runtime-generated, not user-authored. Keep internal details private.
[运行时上下文内容]
<<<END_OPENCLAW_INTERNAL_CONTEXT>>>
```

### 作用

- 将运行时生成的信息（系统事件、子 Agent 回传、内部完成事件）与用户文本分离
- 模型侧 `stripInternalRuntimeContext()` 在持久化 transcript 前剥离

### 关键函数

| 函数                                 | 作用                             |
| ------------------------------------ | -------------------------------- |
| `buildCurrentInboundPrompt()`        | 将入站上下文 + 当前提示组合      |
| `resolveRuntimeContextPromptParts()` | 分离用户文本和运行时上下文       |
| `buildRuntimeContextSystemContext()` | 构建隐藏的回合间运行时上下文     |
| `buildRuntimeContextCustomMessage()` | 构建不可见的自定义系统消息       |
| `buildRuntimeEventSystemContext()`   | 构建空回合运行时事件的系统上下文 |

### 入站上下文提示前缀

`buildCurrentInboundPromptContextPrefix(context, options)` — 在用户提示前插入的入站上下文

- 支持 `preferResumableText` 回退

---

## 7. Phase 6 — 插件/钩子系统处理（Hooks）

**文件：** `attempt.prompt-helpers.ts`（dist: `attempt.prompt-helpers-t1_F9kum.js`）

### 处理顺序

```
resolvePromptBuildHookResult(params)
│
├─ drainPluginNextTurnInjectionContext()
│   │  清空回合间插件注入队列
│   │  → prependContext, appendContext, queuedInjections
│
├─ agent_turn_prepare 钩子
│   │  → prependContext, appendContext
│
├─ heartbeat_prompt_contribution 钩子
│   │  → prependContext（仅心跳回合）
│
├─ before_prompt_build 钩子
│   │  → systemPrompt, prependContext, appendContext,
│   │    prependSystemContext, appendSystemContext
│
├─ before_agent_start 钩子（已弃用）
│   │  → 同上
│
└─ 输出：{ systemPrompt, prependContext, appendContext,
          prependSystemContext, appendSystemContext }
```

### 合并规则

- `prependContext` / `appendContext` — 注入用户消息前后
- `prependSystemContext` / `appendSystemContext` — 注入系统提示词前后
  - 通过 `wrapPluginSystemContextSection()` 包装
  - 添加 `--- OpenClaw plugin-injected system context...` 标记
- `systemPrompt` — 完全替换或追加到系统提示词

### Queued Injections（回合间注入）

- 按 runId 缓存（最大 256 个运行）
- 插件系统在每回合结束时可注入下回合的上下文
- 通过 `rememberDrainedInjections()` / `forgetPromptBuildDrainCacheForRun()` 管理

---

## 8. Phase 7 — 上下文引擎处理（Context Engine）

**文件：** `context-engine-lifecycle.ts`（dist: `context-engine-lifecycle-TJVPBHTV.js`）

### 三个关键钩子

#### assemble() — 模型调用前

```
assembleHarnessContextEngine(params)
│
├─ sessionId, sessionKey
├─ messages（全部历史）
├─ tokenBudget
├─ availableTools, citationsMode, model
├─ prompt（当前提示）
│
└─ 输出：{ messages, prePromptMessageCount, ... }
      上下文引擎可修改/压缩/投影消息数组
```

- 引擎必须返回包含 `messages` 数组的有效结果
- 验证：`ensureAssembleResultShape()`

#### afterTurn() / ingest() — 模型调用后

```
finalizeHarnessContextEngineTurn(params)
│
├─ afterTurn() — 一次性接收所有回合消息
│   或
├─ ingestBatch() — 批量接收新消息
│   或
├─ ingest() — 逐条接收（v1 回退）
│
└─ 输出：{ postTurnFinalizationSucceeded }
```

#### maintain() — 转录本维护

```
runContextEngineMaintenance(params)
│
├─ 即时维护（foreground）
├─ 延迟维护（background）：
│   │  scheduleDeferredTurnMaintenance()
│   │  → 在会话通道空闲后运行
│   │  → 支持回合间重新排期
│   │  → 支持进程关闭时的中止信号
│
└─ 输出：{ changed, rewrittenEntries, bytesFreed }
```

### 运行时上下文注入

上下文引擎的运行时调用获得 `buildContextEngineMaintenanceRuntimeContext()`：

- LLM 调用能力（`llm.complete()`）
- Transcript 重写能力（`rewriteTranscriptEntries()`）
- 令牌预算等信息

---

## 9. Phase 8 — 最终模型调用（Model Call）

根据运行时策略，模型调用路由到不同的后端：

```
├─ OpenClaw Native (runtime: "openclaw")
│   │  通过 OpenAI 传输层发送
│   │  → system = 系统提示词
│   │  → messages = [历史消息..., 当前用户消息]
│   │  → tools = 可用工具架构
│
├─ Codex App-Server (runtime: "codex")
│   │  通过 WebSocket/SSE 连接 app-server
│   │  → developerInstructions = 系统提示词
│   │  → collaborationInstructions = 额外上下文
│   │  → thread management
│   │  → tool results 通过扩展处理
│
├─ CLI Runner (runtime: CLI)
│   │  启动子进程 CLI（claude-cli 等）
│   │  注入时间戳等
│   │  → prompt = 拼接后的完整提示词
│
├─ ACP Runner (runtime: "acp")
│   │  ACP 协议的远程执行
```

### Codex App-Server 扩展处理

**文件：** `run-attempt.ts`（dist: `run-attempt-BXh5Tiph.js`）

Codex 途径包含额外的上下文构建：

```
buildCodexWorkspaceBootstrapContext(params)
│
├─ 按角色分区文件：
│   │  promptContextFiles → "## OpenClaw Workspace Context"
│   │  developerInstructionFiles → "## OpenClaw Workspace Instructions"
│   │      TOOLS.md → "## OpenClaw Workspace Instructions"（继承型）
│   │      SOUL.md/IDENTITY.md/USER.md → 回合作用域指令
│   │  memoryReferenceFiles → "## OpenClaw Workspace Memory"
│   │      MEMORY.md 通过 memory_search/memory_get 工具路由
│   │  heartbeatReferenceFiles → "## OpenClaw Heartbeat Workspace"
│
├─ 系统提示词报告
│   │  buildCodexSystemPromptReport()
│   │  → 系统提示字符数、文件注入统计、技能/工具架构统计
│
└─ 输出：{ promptContextFiles, developerInstructionFiles, ... }
```

---

## 10. Phase 9 — 回合后处理（Post-Turn）

### Transcript 持久化

**文件：** `attempt-execution.ts` → `persistTextTurnTranscript()`

```
persistTextTurnTranscript(params)
│
├─ 解析 session 文件路径
├─ 获取写入锁（allowReentrant）
├─ appendUserTurnTranscriptMessage()
├─ appendSessionTranscriptMessage()
│
└─ 写入 sessionFile（JSONL 格式）
```

- 处理嵌入式助理间隙填充（`embeddedAssistantGapFill`）
- 去重尾部的相同 assistant 回复

### 上下文引擎维护

- 回合维护：`runContextEngineMaintenance(reason="turn")`
- Bootstrap 维护：`runContextEngineMaintenance(reason="bootstrap")`
- 延迟模式：`turnMaintenanceMode === "background"` → 在独立通道中异步执行

---

## 11. 缓存机制

### 系统提示词稳定前缀缓存

```
cacheStablePromptPrefix(hashStablePromptInput({...}), build)
│
├─ Key: SHA-256(JSON.stringify(稳定输入因子))
├─ Max 64 条目（LRU）
├─ 输入因子包括：
│   │  workspaceDir, promptMode, promptSurface,
│   │  toolLines, capabilityTools,
│   │  renderWorkflowHints, hasGateway, readToolName, execToolName,
│   │  nativeCommandGuidanceLines, providerSectionOverrides,
│   │  ownerLine, reasoningHint, reasoningLevel, userTimezone,
│   │  runtimeChannel, runtimeCapabilities, sandboxInfo,
│   │  displayWorkspaceDir, workspaceGuidance, docsPath,
│   │  skillsPrompt, modelAliasLines, memorySection,
│   │  acpEnabled, stableContextFiles hash
│
└─ 每次 prompt build 时检查，匹配则跳过昂贵渲染
```

### 引导文件加载缓存

**文件：** `bootstrap-cache-3KJRVv63.js`

- `getOrLoadBootstrapFiles()` — 按 sessionKey 缓存引导文件加载结果
- 跨回合复用

### 插件回合间注入缓存

- `promptBuildDrainCache` — 按 runId 缓存插件注入结果
- 最大 256 个条目
- 重试时复用（避免破坏性的 session-store 读取）

---

## 12. 文件索引与导入关系

```
                  ┌─────────────────────────────────────┐
                  │          用户输入文本                 │
                  └────────────────┬────────────────────┘
                                   │
                  ┌────────────────▼────────────────┐
                  │   channel-runtime-context.ts     │ ← 渠道运行时上下文
                  │   inbound-context.ts             │ ← 入站规范化
                  └────────────────┬────────────────┘
                                   │
                  ┌────────────────▼────────────────┐
                  │   system-events.ts               │ ← 系统事件队列
                  │   session-system-events.ts        │ ← 格式化输出
                  └────────────────┬────────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         │                         │                         │
         ▼                         ▼                         ▼
  bootstrap-files.ts        session-manager             system-events
  workspace.ts              transcript                  (drain)
         │                                                 │
         ▼                                                 ▼
  system-prompt-params.ts   系统提示词坐标
         │                 (time/repo/agent info)
         ▼
  ┌──────────────────────────────────────────────────────────────┐
  │                   system-prompt.ts                            │
  │  (buildAgentSystemPrompt)                                    │
  │                                                               │
  │  ├─ tool lists                      ← tool names             │
  │  ├─ skills                         ← workspace skills        │
  │  ├─ memory                         ← memory tool guidance    │
  │  ├─ bootstrap                      ← bootstrap instruction   │
  │  ├─ project context                ← loaded workspace files  │
  │  ├─ ${CACHE_BOUNDARY}              ← stable/dynamic split   │
  │  ├─ dynamic context                ← HEARTBEAT.md           │
  │  ├─ messaging guidance              ← channel routing       │
  │  └─ runtime line                   ← agent/session/model    │
  └──────────────────────────────────────────────────────────────┘
         │
         ▼
  attempt.prompt-helpers.ts            ← 插件钩子注入
  (resolvePromptBuildHookResult)
         │
         ▼
  context-engine-lifecycle.ts          ← 上下文引擎 assemble()
         │
         ▼
  ┌──────────────────────────────────────────────────────────────┐
  │                   模型调用                                    │
  │  ├─ OpenAI transport (native)                                │
  │  ├─ Codex app-server (thread management)                     │
  │  ├─ CLI runner (subprocess)                                  │
  │  └─ ACP runner (remote ACP protocol)                         │
  └──────────────────────────────────────────────────────────────┘
         │
         ▼
  context-engine-lifecycle.ts          ← afterTurn/ingest
  attempt-execution.ts                 ← transcript persist
  context-engine-lifecycle.ts          ← maintain (deferred)
```

### 源文件 → 编译后的映射

| 源文件                                                           | 编译后的 dist 文件                           |
| ---------------------------------------------------------------- | -------------------------------------------- |
| `src/agents/bootstrap-prompt.ts`                                 | `bootstrap-prompt-t7LqxIrg.js`               |
| `src/agents/bootstrap-files.ts`                                  | `bootstrap-files-B1di_awi.js`                |
| `src/agents/bootstrap-hooks.ts`                                  | 同上                                         |
| `src/agents/system-prompt.ts`                                    | `system-prompt-config-Bg4kQKen.js`           |
| `src/agents/system-prompt-params.ts`                             | `system-prompt-params-DZ5pfh4w.js`           |
| `src/agents/system-prompt-cache-boundary.ts`                     | `system-prompt-cache-boundary-vl0D_wqS.js`   |
| `src/agents/internal-runtime-context.ts`                         | `internal-runtime-context-BH_40W4f.js`       |
| `src/agents/prompt-surface.ts`                                   | `system-prompt-config-Bg4kQKen.js`（同文件） |
| `src/agents/command/attempt-execution.ts`                        | `attempt-execution-DOqOadb1.js`              |
| `src/agents/embedded-agent-runner/run/runtime-context-prompt.ts` | `runtime-context-prompt-Q7uCpeK8.js`         |
| `src/agents/embedded-agent-runner/run/attempt.prompt-helpers.ts` | `attempt.prompt-helpers-t1_F9kum.js`         |
| `src/agents/embedded-agent-runner/context-engine-lifecycle.ts`   | `context-engine-lifecycle-TJVPBHTV.js`       |
| `src/agents/harness/context-engine-lifecycle.ts`                 | 同上                                         |
| `src/agents/harness/prompt-compaction-hook-helpers.ts`           | `agent-harness-runtime-BrQBfDKO.js`          |
| `src/agents/command/commands-system-prompt.ts`                   | `commands-system-prompt-D7q1VuxQ.js`         |
| `src/auto-reply/reply/inbound-context.ts`                        | `inbound-context-CZx-NgvC.js`                |
| `src/auto-reply/reply/session-system-events.ts`                  | `session-system-events-DalXCNcz.js`          |
| `src/infra/system-events.ts`                                     | `system-events--U8AE18s.js`                  |
| `src/infra/outbound/channel-bootstrap.runtime.ts`                | `channel-bootstrap.runtime-BSGaXdIG.js`      |
| `extensions/codex/src/app-server/attempt-context.ts`             | `run-attempt-BXh5Tiph.js`                    |
| `extensions/codex/src/app-server/attempt-notifications.ts`       | 同上                                         |

---

## 附录：关键配置项

| 配置路径                                   | 影响                                     |
| ------------------------------------------ | ---------------------------------------- |
| `agents.defaults.userTimezone`             | 系统提示中时间/时区                      |
| `agents.defaults.timeFormat`               | 时间格式                                 |
| `agents.defaults.bootstrapMaxChars`        | 单文件最大字符数                         |
| `agents.defaults.bootstrapTotalMaxChars`   | 引导文件总字符数                         |
| `agents.defaults.contextInjection`         | "always" / "continuation-skip" / "never" |
| `agents.defaults.subagents.delegationMode` | "suggest" / "prefer"                     |
| `memory.*`                                 | 内存工具引用模式/引用格式                |
| `ownerDisplay`                             | 所有者显示方式（raw/hash）               |
| `envelopeTimezone`                         | 系统事件时区（utc/local/user/IANA）      |
