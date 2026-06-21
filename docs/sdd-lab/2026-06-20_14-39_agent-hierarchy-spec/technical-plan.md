# Technical Plan / 技术方案: Agent 树形层级与提示词规范

## Requirement Baseline / 需求基线

- **对应需求文档**：`requirements.md`（2026-06-20，经过 5 轮迭代定稿）
- **需求确认状态**：已确认
- **本方案覆盖范围**：提示词管道改造、子 Agent 调度改造、工具权限过滤改造

## Current Project Facts / 当前项目事实

### 已读取文件/模块

| 模块                   | 文件                                                  | 作用                                                                  |
| ---------------------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| 提示词构建（主 Agent） | `src/agents/system-prompt.ts`                         | `buildAgentSystemPrompt` — 主 Agent 系统提示词组装                    |
| 提示词构建（子 Agent） | `src/agents/embedded-agent-runner/system-prompt.ts`   | `buildEmbeddedSystemPrompt` — 调用 `buildConfiguredAgentSystemPrompt` |
| 提示词构建（Codex）    | `extensions/codex/src/app-server/attempt-context.ts`  | Codex 自有提示词构建，独立的文件分类逻辑                              |
| 子 Agent 创建          | `src/agents/subagent-spawn.ts`                        | `spawnSubagentDirect` — 子 Agent 创建核心逻辑                         |
| 子 Agent 提示词        | `src/agents/subagent-system-prompt.ts`                | `buildSubagentSystemPrompt` — 当前子 Agent 提示词模板                 |
| 子 Agent 初始化        | `src/agents/subagent-initial-user-message.ts`         | `buildSubagentInitialUserMessage` — 第一条用户消息                    |
| 工具策略               | `src/agents/agent-tools.policy.ts` / `tool-policy.ts` | 工具权限策略解析                                                      |
| 工具分组               | `src/agents/tool-catalog.ts`                          | `CORE_TOOL_GROUPS` — 工具分组定义                                     |
| 引导文件加载           | `src/agents/bootstrap-files.ts`                       | workspace 文件加载                                                    |
| 插件入口               | `extensions/codex/index.ts`                           | Codex 插件注册 AgentHarness 的典型实现                                |
| Harness 注册           | `src/plugins/types.ts`                                | `registerAgentHarness` API 签名                                       |
| Harness 策略路由       | `src/agents/harness-runtimes.ts`                      | `resolveAgentHarnessPolicy` — 按 provider/model 路由                  |

### 关键架构认知：AgentHarness 机制

OpenClaw 已有**完整的 AgentHarness 插拔机制**：

```
框架定义 AgentHarness 接口:
  supports(ctx): 判断是否处理该 provider
  runAttempt(params): 完整执行链路（提示词构建 → 模型调用 → 结果处理）
  runSideQuestion(params)
  compact(params) / reset() / dispose()

已有实现:
  Native Harness — OpenClaw 内置，处理非 codex/openai 的 provider
  Codex Harness — 通过 extensions/codex/index.ts 注册，处理 codex/openai provider

路由机制:
  resolveAgentHarnessPolicy() → 按 provider/model 解析 runtime id
  → 框架找 supports() 匹配的 harness → 执行
```

**关键结论**：我们可以通过同样的 `registerAgentHarness` 注册一个全新的智能体运行时，完全自建管道，不动框架一行代码。

## Solution Options / 方案候选

本方案涉及 4 个设计维度，每个维度有多个候选方案。

---

### 维度 1：总体架构

#### 方案 A：增量改造现有代码（已废弃 ❌）

在现有的 `system-prompt.ts`、`bootstrap-files.ts`、`effective-tool-policy.ts` 等文件上修修补补。

- **涉及模块**：system-prompt.ts, subagent-spawn.ts, agent-tools.policy.ts, tool-catalog.ts, gateway/tool-resolution.ts, bootstrap-files.ts
- **优点**：无
- **缺点**：需要修改 6+ 个框架核心模块，容易引入回归，与现有缓存机制冲突
- **风险**：高
- **结论**：**废弃**。景总明确否定了这个方向。

#### 方案 B（推荐 ✅）：registerAgentHarness 独立实现

通过 `api.registerAgentHarness()` 注册一个新的智能体运行时（如 `id: "hierarchical"`），在其中实现完整的树形层级管道。

```
registerAgentHarness({
  id: "hierarchical",
  supports: (ctx) => {
    // 通过配置选择（见维度 2）
  },
  runAttempt: async (params) => {
    // ===== 完全自建的独立管道 =====
    // 1. PLS: loadAgentPrompt(agentDir)     → 目录树聚合提示词
    // 2. NTS: resolveNodeTools(agentDir)     → 节点工具组合
    // 3. 组装 system prompt
    // 4. 调模型
    // 5. 返回结果
  },
  runSideQuestion: ...,
  compact: ...,
  reset: ...,
  dispose: ...
})
```

- **新增文件**：`extensions/hierarchical/` 目录下的插件
- **涉及模块**：无框架模块修改
- **优点**：
  - 框架零改动，利用现有 AgentHarness 接口
  - 和 Native / Codex 两条管道完全共存，互不影响
  - 可以独立迭代、独立测试、独立部署
  - 继承机制（PLS 目录树聚合 + 节点工具集）完全在 harness 内部闭环
- **缺点**：
  - 与 Native 管道有部分功能重复（提示词基本结构、运行时间等）——但这是**选择性的重复**，不是耦合
- **风险**：低

---

### 维度 2：如何启用分层 Harness

用户怎么切换到这个新的 hierarchical harness？

#### 方案 A（推荐 ✅）：通过 model 配置的 agentRuntime

复用现有 `agentRuntime` 配置机制：

```json5
{
  agents: {
    list: [
      {
        id: "my-agent",
        models: {
          // 指定某些模型走 hierarchical harness
          "siliconflow/deepseek-ai/DeepSeek-V3.2": {
            agentRuntime: { id: "hierarchical" },
          },
          // 通配符：该 provider 下的所有模型都走 hierarchical
          "siliconflow/*": {
            agentRuntime: { id: "hierarchical" },
          },
        },
      },
    ],
  },
}
```

`resolveAgentHarnessPolicy()` 的现有路由逻辑不需要任何修改——它已经支持 `agentRuntime.id` 的配置解析和匹配。框架只认 `id`，不关心里面是什么实现。

#### 方案 B：插件自动注册 + 特定 provider 绑定

新插件在注册时声明自己绑定的 provider ids，替换这些 provider 的执行链路。

- **优点**：用户不需要手动配置
- **缺点**：影响范围不明确，用户难以感知切换

---

### 维度 3：提示词加载（PLS）— 独立于框架的目录树聚合

在 harness 内部实现 `prompt-loader.ts`，不依赖 `bootstrap-files.ts`。

#### 核心机制

```
agentDir
  → walk up 到 OpenClaw Agent 根路径
  → 沿途收集 prompt/ 下的文件
  → 按 slot 名合并（子层覆盖父层）
  → 返回聚合后的提示词文本
```

详见独立文档 `prompt-loader-design.md`（含目录约定、slot 匹配规则、加载算法、缓存策略）。

#### 与需求 #2 的对应关系

需求中要求"子 Agent 提示词 = 父 Agent 提示词 + 自身内容"，PLS 通过目录树聚合统一实现：

```
根节点提示词 = PLS(workspace 根)
               = root/hierarchical/prompt/ 下所有文件聚合
               + children/ 下子 Agent 的 frontmatter 列表

枝节点提示词 = PLS(枝节点目录)
               = root/prompt/ + 枝/prompt/（子层覆盖父层）
               + children/ 下子 Agent 的 frontmatter 列表

叶节点提示词 = PLS(叶节点目录)
               = root/prompt/ + 枝/prompt/ + 叶/prompt/
               +（无子 Agent 列表）
```

每个节点的个性直接写在自己所在层的 `prompt/` 目录下，通过 slot 覆盖机制（同名文件子层替换父层）实现增量定制。不需要单独的 AGENTS.md 追加机制。

#### 与现有框架的关系

- `bootstrap-files.ts`：**不动**。现有 Native / Codex harness 继续使用它
- `system-prompt.ts`：**不动**。PLS 是 hierarchical harness 内部的事
- 新 harness 内部组装提示词时调用 PLS 得到聚合文本，再组装成完整的 system prompt

---

### 维度 4：工具权限（NTS）— 独立于框架的节点级工具组合

在 harness 内部实现 `node-tool-registry.ts`，不依赖 `effective-tool-policy.ts`。

#### 核心机制

```typescript
// hierarchical harness 内部
function resolveNodeTools(agentDir: string): NodeToolSet {
  const nodeType = detectNodeType(agentDir);
  // 根据节点类型决定可用工具分组
  const allowedGroups = getGroupsForNodeType(nodeType);
  // 加载系统工具（按分组过滤）
  const systemTools = loadSystemTools().filter((t) => allowedGroups.has(t.group));
  // 加载节点自定义工具（从 config 或 .tools/ 目录）
  const customTools = loadNodeCustomTools(agentDir);
  return { tools: [...systemTools, ...customTools] };
}

function detectNodeType(agentDir: string): "root" | "branch" | "leaf" {
  const childrenDir = path.join(agentDir, "hierarchical", "children");
  const hasChildren = await existsDir(childrenDir);
  const isRoot = agentDir === rootDir;
  if (isRoot) return "root";
  if (hasChildren) return "branch";
  return "leaf";
}
```

#### 工具分组（harness 内部定义，不与框架的 CORE_TOOL_GROUPS 耦合）

| 分组      | 包含工具                                                                                  | root | branch | leaf |
| --------- | ----------------------------------------------------------------------------------------- | ---- | ------ | ---- |
| dispatch  | sessions_spawn, sessions_yield, subagents, sessions_list, sessions_history, sessions_send | ✅   | ✅     | ❌   |
| execution | read, write, edit, exec, web_search, web_fetch, ...                                       | ✅   | ❌     | ✅   |
| query     | session_status, agents_list                                                               | ✅   | ✅     | ✅   |
| system    | gateway, cron, skill_workshop                                                             | ✅   | ❌     | ❌   |

#### 与现有框架的关系

- `effective-tool-policy.ts`：**不动**。NTS 是 hierarchical harness 内部的事
- `tool-catalog.ts`：**不动**。工具分组定义在 harness 内部
- `gateway/tool-resolution.ts`：**不动**
- 如果用户同时配置了框架层的 tool policy（如 `deny: ["exec"]`），在 harness 内部完成组合后作为最终策略——但这不是框架强制，是 harness 主动遵守

---

### 维度 6：调度设计（"spawn 时 hierarchical harness 接管"的代码路径）

#### 完整代码流程

```
1. 用户配置
   ┌─────────────────────────────────────────────────────┐
   │ agents.list[].models["xxx/yyy"].agentRuntime        │
   │   = { id: "hierarchical" }                          │
   └─────────────────────────────────────────────────────┘

2. 父 Agent 会话启动
   → resolveAgentHarnessPolicy() 读取 config
   → 返回 { runtime: "hierarchical" }
   → 框架遍历 registered harnesses，调每个的 supports()
   → hierarchical harness.supports({
       provider, modelId,
       requestedRuntime: "hierarchical"    ← 框架传进来的
     })
     → return { supported: true, priority: 100 }
   → 框架选中 hierarchical harness
   → 调 hierarchical.runAttempt(parentSessionParams)
     ├─ PLS 聚合根节点提示词
     ├─ NTS 组合根节点工具集（root: 所有分组可用）
     ├─ 组装系统提示词
     ├─ 模型对话循环（hierarchy harness 自管理）
     │   ├─ 模型返回会话 spawn → 框架工具执行器处理
     │   │   ├─ 调 spawnSubagentDirect() 创建子会话
     │   │   └─ 子会话由框架按 agentRuntime 路由回 hierarchical
     │   ├─ 模型返回其他工具调用 → harness 调框架内置工具执行器
     │   └─ 模型返回文本结果 → 本节点完成
     └─ 返回结果

3. 子会话自动匹配同一 harness
   → 子会话继承父的 model/provider
   → resolveAgentHarnessPolicy() 同样返回 "hierarchical"
   → 框架再次选中 hierarchical harness
   → 调 hierarchical.runAttempt(childSessionParams)
     ├─ PLS: 从子 Agent 目录向上聚合（含父级 prompt/）
     ├─ prompt/ 聚合（含子层覆盖）
     ├─ NTS: detectNodeType(childDir)
     │   ├─ 有 children/ → "branch": 只有 dispatch+query
     │   └─ 无 children/ → "leaf": 有 execution+query
     ├─ 组装提示词
     ├─ 模型对话循环（同上，自管理）
     └─ 返回结果给父会话
```

#### 关键代码点

**层级 harness 内自管理的对话循环（含 sessions_spawn 拦截）**：

````typescript
// extensions/hierarchical/harness.ts
api.registerAgentHarness({
  id: "hierarchical",
  supports: (ctx) => {
    if (ctx.requestedRuntime === "hierarchical") {
      return { supported: true, priority: 100 }
    }
    return { supported: false }
  },

  runAttempt: async (params) => {
    // 1. PLS: 从 agentDir 向上聚合提示词
    const agentDir = resolveAgentDir(params)
    const prompt = loadAgentPrompt(rootAgentDir, agentDir)

    // 2. NTS: 节点检测 + 工具组合
    const nodeType = detectNodeType(agentDir)
    const tools = resolveNodeTools(nodeType)

    // 3. 组装系统提示词（不调框架的 buildAgentSystemPrompt）
    const systemPrompt = buildHierarchicalSystemPrompt(prompt, tools)

    // 4. 对话循环（所有工具调用统一经框架工具执行器处理）
    let messages = params.messages
    while (true) {
      const response = await callModel({
        systemPrompt,
        messages,
        tools,
      })

      if (!response.hasToolCall) {
        return { text: response.text }
      }

      // 所有工具调用统一调框架的工具执行器
      // sessions_spawn 也是其中之一，不需要特殊处理
      for (const toolCall of response.toolCalls) {
        const result = await executeTool(toolCall)
        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: result,
        })
      }
    }
  },
})

---

## 推荐方案汇总

| 维度 | 推荐方案 | 理由 |
|---|---|---:|
| ① 总体架构 | registerAgentHarness 独立实现 | 框架零改动，和 Native/Codex 共存 |
| ② 启用方式 | agentRuntime 配置 | 复用现有路由逻辑 |
| ③ 提示词加载 | PLS 目录树聚合 | hierarchical/prompt/ 统一管理，子层覆盖父层 |
| ④ 工具权限 | NTS 节点类型检测 | 枝/叶/根三类自动推断 |
| ⑤ 调度机制 | 框架 sessions_spawn + Context Engine | 不干预 spawn，全部交给框架基础设施 |
## Decision / 方案决策

- **Selected / 选定方案**：registerAgentHarness 独立实现（维度 1–5 全部采纳）
- **Decision Owner / 决策人**：景总
- **Decision Time / 决策时间**：2026-06-21
- **方案确认状态**：✅ 已确认

### 执行阶段划分

| 阶段 | 范围 | 状态 |
|---|---|---|
| V1 | PLS + Scanner + NTS 模块 + harness 桩（验证组装逻辑） | ✅ 完成 |
| V2 | node-path-resolver + harness delegate OpenClaw runner + toolsAllow 硬过滤 | ✅ 完成（46 tests） |
| V3 | Gateway E2E spawn 链（自动化） | ✅ 6 tests + demo-workspace fixture |
| V3b | Gateway 实机验证 | ⏸️ 可选（需 pnpm build + live GW） |

## Open Questions / 开放问题（已关闭）

1. **Harness 插件位置** ✅：`extensions/hierarchical/`（与 codex 同级的外部 bundled 插件）
2. **children/ 扫描** ✅：每次 turn 实时读取（scanner + PLS）
3. **节点自定义工具** ⏸️ V2 不做；后续可通过叶节点 config 或 `.tools/` 扩展
4. **prompt slot 命名** ✅：`{NN}-{name}.md`，按文件名排序；同名 slot 子层覆盖父层（见 `prompt-loader.ts`）

## Impacted Areas / 影响范围

### 改动范围总览

**框架核心：0 行修改。** 所有改动在 `extensions/hierarchical/` 内。

| 操作 | 文件 | 行数估计 |
|---|---|---:|
| 新增 | `extensions/hierarchical/index.ts` | ~30 行 |
| 新增 | `extensions/hierarchical/harness.ts` | ~200 行 |
| 新增 | `extensions/hierarchical/prompt-loader.ts` | ~100 行 |
| 新增 | `extensions/hierarchical/node-tool-registry.ts` | ~80 行 |
| 新增 | `extensions/hierarchical/agent-children-scanner.ts` | ~50 行 |
| 新增 | `extensions/hierarchical/package.json` | ~20 行 |
| **合计** | | **~480 行** |

### 各文件详解

**`extensions/hierarchical/index.ts`** — 插件入口

```typescript
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry"
import { createHierarchicalHarness } from "./harness"

export default definePluginEntry({
  id: "hierarchical",
  name: "Hierarchical Agent",
  description: "树形层级 Agent 运行时：继承式提示词 + 节点类型工具限制",
  register(api) {
    api.registerAgentHarness(createHierarchicalHarness())
  },
})
````

**`extensions/hierarchical/harness.ts`** — AgentHarness 实现

```typescript
export function createHierarchicalHarness(): AgentHarness {
  return {
    id: "hierarchical",
    label: "Hierarchical agent harness",
    contextEngineHostCapabilities: [
      /* 需要的引擎能力 */
    ],

    supports: (ctx) => {
      // 框架在 resolveAgentHarnessPolicy() 后传来自 requestedRuntime
      // ctx.requestedRuntime 来自用户配置的 agentRuntime: { id: "hierarchical" }
      if (ctx.requestedRuntime === "hierarchical") {
        return { supported: true, priority: 100 };
      }
      return { supported: false };
    },

    runAttempt: async (params) => {
      // 完整链路，不调框架的 buildAgentSystemPrompt
      const agentDir = resolveAgentDir(params);
      const prompt = loadAgentPrompt(rootAgentDir, agentDir);
      const nodeType = detectNodeType(agentDir);
      const tools = resolveNodeTools(nodeType);
      const systemPrompt = buildHierarchicalSystemPrompt(prompt, tools);
      return executeWithModel(systemPrompt, params.messages, tools);
    },

    runSideQuestion: async (params) => {
      /* ... */
    },
    compact: async (params) => {
      /* ... */
    },
    reset: (params) => {
      /* ... */
    },
    dispose: () => {
      /* ... */
    },
  };
}
```

**`extensions/hierarchical/prompt-loader.ts`** — PLS 核心

```typescript
export function loadAgentPrompt(rootDir: string, agentDir: string): string {
  // 从 agentDir 向上遍历到 rootDir
  // 沿途读取 prompt/ 目录下的文件
  // 按 slot 名合并（子层覆盖父层）
  // 返回合并后的提示词文本
}
```

**`extensions/hierarchical/node-tool-registry.ts`** — NTS 核心

```typescript
export function detectNodeType(agentDir: string): "root" | "branch" | "leaf" {
  // 有 children/ 且非空 → "branch"
  // 是根目录 → "root"
  // 其他 → "leaf"
}

export function resolveNodeTools(nodeType: string): ToolDefinition[] {
  // 按节点类型决定可用工具分组
}
```

**`extensions/hierarchical/agent-children-scanner.ts`** — 目录扫描

```typescript
export function scanAgentChildren(agentDir: string): AgentChildEntry[] {
  // 读取 children/ 下的子目录
  // 解析每个 AGENTS.md 的 frontmatter
  // 返回 { agentId, name, description }[]
}
```

### 不动框架文件（确认清单 ✅）

| 文件                                   | 为什么不动                                                   |
| -------------------------------------- | ------------------------------------------------------------ |
| `src/agents/system-prompt.ts`          | Native harness 专用                                          |
| `src/agents/bootstrap-files.ts`        | Native / Codex harness 继续使用                              |
| `src/agents/effective-tool-policy.ts`  | 框架级工具策略，与 NTS 独立                                  |
| `src/agents/tool-catalog.ts`           | 框架级工具分组，与 NTS 独立                                  |
| `src/agents/subagent-system-prompt.ts` | Native harness 专用                                          |
| `src/agents/subagent-spawn.ts`         | 框架级 spawn 机制。hierarchical harness 直接调用它创建子会话 |
| `src/agents/harness-runtimes.ts`       | 已有路由逻辑，不需要改                                       |
| `src/gateway/tool-resolution.ts`       | 框架级工具解析，与 NTS 独立                                  |
| `src/agents/harness/types.ts`          | 框架级 AgentHarness 接口                                     |
| `src/plugins/captured-registration.ts` | 已有 harness 注册机制                                        |
| `extensions/codex/**`                  | 完全不碰                                                     |

## Execution Steps / 执行步骤

### 文件清单

| 顺序 | 文件                                                | 依赖                              |
| ---- | --------------------------------------------------- | --------------------------------- |
| 1    | `extensions/hierarchical/prompt-loader.ts`          | 无                                |
| 2    | `extensions/hierarchical/agent-children-scanner.ts` | 无                                |
| 3    | `extensions/hierarchical/node-tool-registry.ts`     | prompt-loader                     |
| 4    | `extensions/hierarchical/harness.ts`                | prompt-loader, node-tool-registry |
| 5    | `extensions/hierarchical/index.ts`                  | harness                           |
| 6    | `extensions/hierarchical/package.json`              | 无                                |

---

### 文件 1：`extensions/hierarchical/prompt-loader.ts`

**职责**：PLS 核心。从节点目录向上遍历，聚合所有层的 `prompt/` 文件。

**依赖**：无（纯文件操作 + 字符串处理）

**导出函数**：

```typescript
/** 单个提示词文件条目 */
export type PromptSlot = {
  slot: string; // 完整文件名，如 "10-soul.md"
  content: string; // 文件内容
  sourceLayer: string; // 来源层级（用于调试）
  sortKey: string; // 排序键 = 文件名
};

/** 聚合结果 */
export type PromptLoadResult = {
  content: string; // 合并后的提示词文本
  slots: PromptSlot[]; // 最终生效的 slot 列表
  layers: string[]; // 参与聚合的目录
  truncated: boolean; // 是否截断
};

/** PLS 核心函数 */
export function loadAgentPrompt(
  rootDir: string, // workspace 根目录
  agentDir: string, // 当前节点目录（含 hierarchical/）
  options?: {
    maxChars?: number;
    skipSlots?: string[];
  },
): Promise<PromptLoadResult>;
```

**核心逻辑（伪代码）**：

```typescript
async function loadAgentPrompt(rootDir, agentDir, options) {
  // 1. 向上收集目录链（限制最大深度 100，避免死循环）
  const dirs: string[] = [];
  let current = path.resolve(agentDir);
  const root = path.resolve(rootDir);
  let maxDepth = 100;
  while (current.startsWith(root) && maxDepth > 0) {
    dirs.unshift(current);
    if (current === root) break;
    current = path.dirname(current);
    maxDepth--;
  }

  // 2. 每层读 hierarchical/prompt/ 下的文件
  const layerSlots: PromptSlot[][] = [];
  for (const dir of dirs) {
    const promptDir = path.join(dir, "hierarchical", "prompt");
    if (!(await existsDir(promptDir))) continue;
    const files = await readDirSorted(promptDir); // 按文件名排序
    layerSlots.push(
      files.map((f) => ({
        slot: f.name,
        content: await readFile(f.path),
        sourceLayer: dir,
        sortKey: f.name,
      })),
    );
  }

  // 3. 从根到叶，按 slot 合并（子层覆盖父层同名 slot）
  const merged = new Map<string, PromptSlot>();
  for (const layer of layerSlots) {
    for (const slot of layer) {
      merged.set(slot.slot, slot); // 子层覆盖父层
    }
  }

  // 4. 按文件名排序输出
  const slots = [...merged.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  let content = slots.map((s) => s.content).join("\n\n");
  let truncated = false;
  if (options?.maxChars && content.length > options.maxChars) {
    content = content.slice(0, options.maxChars);
    truncated = true;
  }

  return { content, slots, layers: dirs, truncated };
}

async function existsDir(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

async function readDirSorted(dir: string): Promise<{ name: string; path: string }[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
```

**不处理的逻辑**：AGENTS.md 追加、frontmatter 注入、工具定义——这些不是 PLS 的职责

---

### 文件 2：`extensions/hierarchical/agent-children-scanner.ts`

**职责**：扫描 `hierarchical/children/` 目录，解析子 Agent 的 frontmatter，生成 `<available_agents>` 列表。

**依赖**：无

**导出函数**：

```typescript
/** 子 Agent 摘要条目 */
export type AgentChildEntry = {
  agentId: string; // children/ 下的目录名
  name: string; // frontmatter 中的 name
  description: string; // frontmatter 中的 description
  hasChildren: boolean; // 该子节点下面还有 children/ 吗
};

/** 扫描 children/ 目录，返回所有子 Agent 的摘要 */
export function scanAgentChildren(
  agentDir: string, // 当前节点目录 hierarchy/
): Promise<AgentChildEntry[]>;

/** 格式化子 Agent 列表为提示词区块 */
export function formatAgentChildrenList(entries: AgentChildEntry[]): string;
```

**核心逻辑**：

```typescript
async function scanAgentChildren(agentDir: string): Promise<AgentChildEntry[]> {
  const childrenDir = path.join(agentDir, "hierarchical", "children");
  if (!(await existsDir(childrenDir))) return [];

  const entries: AgentChildEntry[] = [];
  const dirs = await fs.readdir(childrenDir, { withFileTypes: true });

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;

    // 读取该子节点的 prompt/ 下带 frontmatter 的文件
    const promptDir = path.join(childrenDir, dir.name, "hierarchical", "prompt");
    if (!(await existsDir(promptDir))) continue;

    // 解析第一个有 frontmatter 的 .md 文件
    const promptFiles = (await fs.readdir(promptDir)).filter((f) => f.endsWith(".md"));
    for (const file of promptFiles) {
      const content = await fs.readFile(path.join(promptDir, file), "utf-8");
      const fm = parseFrontmatter(content);
      if (fm?.name && fm?.description) {
        entries.push({
          agentId: dir.name,
          name: fm.name,
          description: fm.description,
          hasChildren: await existsDir(
            path.join(childrenDir, dir.name, "hierarchical", "children"),
          ),
        });
        break; // 只取第一个有 frontmatter 的文件
      }
    }
  }

  return entries;
}

/** 解析 Markdown frontmatter */
function parseFrontmatter(content: string): { name?: string; description?: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const yaml = match[1];
  const fm: Record<string, string> = {};
  for (const line of yaml.split("\n")) {
    const [key, ...rest] = line.split(":");
    if (key && rest.length) fm[key.trim()] = rest.join(":").trim();
  }
  return fm.name ? { name: fm.name, description: fm.description } : null;
}

function formatAgentChildrenList(entries: AgentChildEntry[]): string {
  if (entries.length === 0) return "";
  const items = entries
    .map(
      (e) =>
        `  <agent>\n    <name>${e.name}</name>\n    <description>${e.description}</description>\n  </agent>`,
    )
    .join("\n");
  return `\n## Available Sub-Agents\n\n<available_agents>\n${items}\n</available_agents>`;
}
```

---

### 文件 3：`extensions/hierarchical/node-tool-registry.ts`

**职责**：NTS 核心。检测节点类型，按类型组合可用工具。

**依赖**：prompt-loader（共享目录路径解析）

**导出函数**：

```typescript
export type NodeType = "root" | "branch" | "leaf";

export type NodeToolGroup =
  | "dispatch" // sessions_spawn, sessions_yield, subagents
  | "execution" // read, write, edit, exec, web_search
  | "query" // session_status, agents_list
  | "system"; // gateway, cron, skill_workshop

/** 节点类型 → 可用工具分组 */
const NODE_TYPE_GROUPS: Record<NodeType, NodeToolGroup[]> = {
  root: ["dispatch", "execution", "query", "system"],
  branch: ["dispatch", "query"],
  leaf: ["execution", "query"],
};

/** 根据目录结构推断节点类型 */
export function detectNodeType(
  agentDir: string, // 当前节点目录（含 hierarchical/）
  rootDir: string, // workspace 根目录
): Promise<NodeType>;

/** 按节点类型解析可用工具 */
export function resolveNodeTools(
  nodeType: NodeType,
  systemTools: ToolDefinition[], // 框架提供的所有系统工具
): ToolDefinition[];
```

**核心逻辑**：

```typescript
async function detectNodeType(agentDir: string, rootDir: string): Promise<NodeType> {
  if (agentDir === rootDir) return "root";
  const childrenDir = path.join(agentDir, "hierarchical", "children");
  if (await existsDir(childrenDir)) {
    const entries = await fs.readdir(childrenDir);
    if (entries.length > 0) return "branch";
  }
  return "leaf";
}

function resolveNodeTools(nodeType: NodeType, systemTools: ToolDefinition[]): ToolDefinition[] {
  const allowedGroups = NODE_TYPE_GROUPS[nodeType];
  return systemTools.filter((t) => {
    const group = getToolGroup(t.name); // 工具→分组映射
    return group ? allowedGroups.includes(group) : false;
  });
}

/** 工具→分组映射（hardcode，不依赖框架的 tool-catalog.ts）
 *  分组定义来自需求文档：dispatch=选择权, execution=执行权, query=查询权, system=系统权
 */
function getToolGroup(toolName: string): NodeToolGroup | undefined {
  const MAP: Record<string, NodeToolGroup> = {
    // dispatch（选择权）
    sessions_spawn: "dispatch",
    sessions_yield: "dispatch",
    subagents: "dispatch",
    sessions_list: "dispatch",
    sessions_history: "dispatch",
    sessions_send: "dispatch",
    // execution（执行权）
    read: "execution",
    write: "execution",
    edit: "execution",
    apply_patch: "execution",
    grep: "execution",
    find: "execution",
    ls: "execution",
    exec: "execution",
    process: "execution",
    web_search: "execution",
    web_fetch: "execution",
    browser: "execution",
    canvas: "execution",
    nodes: "execution",
    image: "execution",
    image_generate: "execution",
    message: "execution",
    // query（查询权）
    session_status: "query",
    agents_list: "query",
    // system（系统权）
    gateway: "system",
    cron: "system",
    skill_workshop: "system",
  };
  return MAP[toolName];
}
```

---

### 文件 4：`extensions/hierarchical/harness.ts`

**职责**：AgentHarness 接口实现。组装 PLS + NTS → 构建提示词 → 调模型。

**依赖**：prompt-loader, node-tool-registry, agent-children-scanner, plugin SDK

**引用 SDK 接口**：

```typescript
import type {
  AgentHarness,
  AgentHarnessSupportContext,
  AgentHarnessSupport,
  AgentHarnessAttemptParams, // = EmbeddedRunAttemptParams
  AgentHarnessAttemptResult, // = EmbeddedRunAttemptResult
  AgentHarnessSideQuestionParams,
  AgentHarnessSideQuestionResult,
  AgentHarnessCompactParams,
  AgentHarnessCompactResult,
  AgentHarnessResetParams,
} from "openclaw/plugin-sdk/agent-harness-runtime";
```

**核心实现**：

```typescript
export function createHierarchicalHarness(rootDir: string): AgentHarness {
  return {
    id: "hierarchical",
    label: "Hierarchical agent harness",

    contextEngineHostCapabilities: [
      "bootstrap",
      "assemble-before-prompt",
      "after-turn",
      "maintain",
    ],

    supports: (ctx: AgentHarnessSupportContext): AgentHarnessSupport => {
      if (ctx.requestedRuntime === "hierarchical") {
        return { supported: true, priority: 100 };
      }
      return { supported: false };
    },

    runAttempt: async (params: AgentHarnessAttemptParams): Promise<AgentHarnessAttemptResult> => {
      try {
        // Phase 1: PLS 聚合提示词
        const agentDir =
          params.agentDir ?? (await resolveAgentDir(params.config, params.agentId ?? ""));
        const promptResult = await loadAgentPrompt(rootDir, agentDir);

        // Phase 2: 子 Agent 描述符列表
        const children = await scanAgentChildren(agentDir);
        const childrenBlock = formatAgentChildrenList(children);

        // Phase 3: NTS 工具组合
        const nodeType = await detectNodeType(agentDir, rootDir);
        const tools = resolveNodeTools(nodeType, params.runtimePlan?.tools ?? []);

        // Phase 4: 组装系统提示词
        const systemPrompt = [
          promptResult.content,
          childrenBlock,
          // runtime 信息通过 Context Engine 注入
        ]
          .filter(Boolean)
          .join("\n\n");

        // Phase 5: 对话循环（调模型 → 处理工具调用 → 继续）
        let messages = [...params.messages];
        while (true) {
          const response = await callModel({
            systemPrompt,
            messages,
            tools,
            model: params.model,
            apiKey: params.resolvedApiKey,
          });

          if (!response.hasToolCall) {
            return { text: response.text }; // 简写，实际需构造 EmbeddedRunAttemptResult
          }

          for (const toolCall of response.toolCalls) {
            // 所有工具（含 sessions_spawn）经框架工具执行器处理
            const result = await executeTool(toolCall, params);
            messages.push({
              role: "tool",
              toolCallId: toolCall.id,
              content: result,
            });
          }
        }
      } catch (err) {
        return {
          aborted: false,
          externalAbort: false,
          timedOut: false,
          idleTimedOut: false,
          timedOutDuringCompaction: false,
          promptError: err,
          promptErrorSource: "prompt",
          sessionIdUsed: params.sessionId,
        };
      }
    },

    runSideQuestion: async (
      _params: AgentHarnessSideQuestionParams,
    ): Promise<AgentHarnessSideQuestionResult> => {
      return { text: "Side questions not supported in hierarchical harness" };
    },

    compact: async (
      params: AgentHarnessCompactParams,
    ): Promise<AgentHarnessCompactResult | undefined> => {
      if (params.contextEngine) {
        return params.contextEngine.compact(params);
      }
      return undefined;
    },

    reset: () => {
      // 无需特殊清理
    },

    dispose: () => {
      // 无需特殊清理
    },
  };
}
```

---

### 文件 5：`extensions/hierarchical/index.ts`

**职责**：插件入口，注册 AgentHarness。

**依赖**：harness, plugin SDK

```typescript
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createHierarchicalHarness } from "./harness";

export default definePluginEntry({
  id: "hierarchical",
  name: "Hierarchical Agent",
  description: "树形层级 Agent 运行时：继承式提示词 + 节点类型工具限制",

  register(api) {
    // 注册 AgentHarness，框架通过 agentRuntime: { id: "hierarchical" } 匹配
    api.registerAgentHarness(
      createHierarchicalHarness(
        resolveAgentRootDir(), // workspace 根目录
      ),
    );
  },
});
```

---

### 文件 6：`extensions/hierarchical/package.json`

**职责**：插件元数据，声明依赖和兼容性。

```json
{
  "name": "@openclaw/hierarchical",
  "version": "2026.6.21",
  "type": "module",
  "dependencies": {
    "@openclaw/plugin-sdk": "workspace:*"
  },
  "openclaw": {
    "extensions": ["./index.ts"],
    "compat": {
      "pluginApi": ">=2026.6.8"
    }
  }
}
```

## Risk And Mitigation / 风险与缓解

| 风险                                       | 缓解方式                                                   |
| ------------------------------------------ | ---------------------------------------------------------- |
| 与 Native/Codex 的提示词功能重复           | 选择性重复，不是耦合。后续可提取共享库                     |
| 子 Agent 会话管理依赖框架                  | 只复用 spawn 的会话创建，提示词构建在 harness 内部完全自主 |
| `resolveAgentHarnessPolicy` 对新 id 的支持 | 现有路由已支持任意 `id` 字符串，不需要改                   |
| 用户需要手动配置 agentRuntime              | 这是意图明确的显式选择，不是负担                           |

## Validation Plan / 验证计划

- **静态检查**：TypeScript 编译通过
- **单元测试**：新增 prompt-loader.test.ts, node-tool-registry.test.ts
- **集成测试**：spawn 子 Agent → 验证提示词继承 + 工具权限
- **手动验证**：
  1. 配置 `agentRuntime: { id: "hierarchical" }`
  2. 根 Agent 提示词包含可用子 Agent 列表
  3. 运行 `sessions_spawn` → 子 Agent 提示词包含继承内容
  4. 枝节点看不到 execution 工具
  5. 叶节点看不到 dispatch 工具

## Execute Checkpoint / 执行检查点

- **当前理解**：registerAgentHarness 独立实现，框架零改动（V2 新增 1 行 SDK export：`runOpenClawEmbeddedAttempt`）
- **核心目标**：V2 harness 委托 OpenClaw embedded runner，NTS 通过 `toolsAllow` 硬过滤
- **下一步**：Gateway E2E（VALIDATION §4）
- **风险**：低

**Execution Approval**: `Approved`（2026-06-21）
