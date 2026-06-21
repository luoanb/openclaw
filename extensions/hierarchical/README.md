# Hierarchical Agent Harness

树形层级 agent 插件：在 **不改 core `sessions_spawn`** 的前提下，通过 AgentHarness 在每次 turn 注入 PLS 提示词与 NTS 工具隔离。

- 实机验证：[`GATEWAY_VALIDATION.md`](GATEWAY_VALIDATION.md)
- 自动化测试：[`VALIDATION.md`](VALIDATION.md)
- Demo workspace：[`fixtures/demo-workspace/README.md`](fixtures/demo-workspace/README.md)

---

## 1. 总体架构（两层）

```text
一次 agent run（根或 subagent session 相同）
  │
  ▼
【外层】hierarchical.runAttempt          ← 本插件：turn 前 preprocessor
  │   buildHierarchicalAttemptContext
  │     · node-path-resolver  → nodeDir
  │     · prompt-loader (PLS) → 聚合 hierarchical/prompt/
  │     · node-tool-registry (NTS) → toolsAllow
  │     · agent-children-scanner → <available_agents>
  │
  ▼
【内层】runOpenClawEmbeddedAttempt       ← OpenClaw 原生：调模型、调工具、写 transcript
      (= runEmbeddedAttempt，不经 harness 再选一次)
```

**`delegateRunAttempt` 三参数含义：**

| 参数                                       | 作用                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `extraSystemPrompt: ctx.extraSystemPrompt` | 外层已拼好 PLS + 子 agent 列表 + Tool Restrictions，内层原样使用                                      |
| `toolsAllow: ctx.toolsAllow`               | NTS 硬过滤后的工具名列表                                                                              |
| `agentHarnessRuntimeOverride: "openclaw"`  | 内层按 openclaw 执行；若再走 `runAgentHarnessAttempt` 且 config 仍是 hierarchical，会递归进本 harness |

本插件 **不修改** `sessions_spawn` 的实现；spawn 仍由 core 负责，hierarchical 只消费 spawn 写入 session 的 metadata。

---

## 2. Spawn vs Turn

| 阶段      | 谁负责                   | 发生什么                                                                                                                 |
| --------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **Spawn** | core `subagent-spawn.ts` | 建 `agent:<id>:subagent:<uuid>`；写 `spawnedBy`、`label`；注入 core `# Subagent Context`；首条 user 为 `[Subagent Task]` |
| **Turn**  | hierarchical harness     | 读 `sessionKey` + `spawnedBy` 链 + `label` → `nodeDir` → PLS/NTS → 追加到 `extraSystemPrompt`                            |

定制 prompt **不在 spawn 时注入**，在 **子 session 每次 agent run（turn）** 的 `runAttempt` 里实时读盘注入。

---

## 3. 子 agent 调用约定

### OpenClaw `agentId` vs 层级 `nodeId`

| 概念               | 含义                              | 怎么传                          |
| ------------------ | --------------------------------- | ------------------------------- |
| OpenClaw `agentId` | `agents.list[].id`                | 不传（继承父）或传同一个 id     |
| 层级 `nodeId`      | `hierarchical/children/` 下目录名 | **`sessions_spawn` 的 `label`** |

```typescript
sessions_spawn({
  task: "审计 auth 模块",
  label: "security-auditor", // nodeId，不要用 agentId 传 nodeId
});
```

### 节点路径解析

- **根**：无 `spawnedBy` → `nodeDir = workspaceRoot`
- **子**：沿 `spawnedBy` 向上，每层取 session 的 `label`，拼 `…/hierarchical/children/{label}/…`

实现：`node-path-resolver.ts` → `resolveHierarchicalNodeContext()` / `walk()`

### 任务回传

core subagent announce 机制不变：叶 → 枝 → 根 → 用户。对用户可见回复由根节点决定。

---

## 4. 怎么选中 hierarchical harness

由 **model 级配置** 决定，与是否 subagent session **无关**：

```json5
{
  agents: {
    defaults: {
      models: {
        "your-provider/your-model": {
          agentRuntime: { id: "hierarchical" },
        },
      },
    },
  },
}
```

根 turn 与子 turn 共用同一 runtime；**读哪份 prompt** 由 session 的 spawn 链 + `label` 区分，不是由不同 runtime 区分。

---

## 5. 节点类型与工具（NTS）

| 类型   | 判定                            | spawn | exec/read 等 |
| ------ | ------------------------------- | ----- | ------------ |
| root   | `nodeDir === workspaceRoot`     | ✅    | ✅           |
| branch | 有非空 `hierarchical/children/` | ✅    | ❌           |
| leaf   | 其余                            | ❌    | ✅           |

实现：`node-tool-registry.ts` → `detectNodeType()` / `listToolNamesForNodeType()`

---

## 6. 代码地图

| 文件                        | 职责                                                 |
| --------------------------- | ---------------------------------------------------- |
| `index.ts`                  | 注册 harness；`readSession` 读 `label` / `spawnedBy` |
| `harness.ts`                | 外层 `runAttempt` + `delegateRunAttempt`             |
| `harness-context.ts`        | 编排 PLS + scanner + NTS → supplement                |
| `node-path-resolver.ts`     | spawn 链 + label → `nodeDir`                         |
| `prompt-loader.ts`          | 从 `nodeDir` 向上读 `hierarchical/prompt/*.md`       |
| `node-tool-registry.ts`     | root/branch/leaf 工具分组                            |
| `agent-children-scanner.ts` | 扫描 `<available_agents>`                            |
| `e2e-spawn-chain.test.ts`   | spawn 链 + context 端到端（无 Gateway）              |

---

## 7. 与 core subagent 的关系

- `runtime: "subagent"`（默认）：OpenClaw 内部 subagent，hierarchical 走这条路。
- `runtime: "acp"`：外部 CLI harness，与 hierarchical 树无关。
- hierarchical **没有**自定义 spawn 工具；枝/叶能力靠 NTS 在 turn 时硬过滤 `toolsAllow`。

---

## 8. 常见误区

1. **用 `agentId` 传 nodeId** → 应使用 `label`（`<available_agents>` 文案已统一为 `label`）。
2. **以为 spawn 时就加载 PLS** → PLS 在 turn 的 `buildHierarchicalAttemptContext` 才读盘。
3. **以为 subagent 会自动 hierarchical** → 必须 config 绑定 `agentRuntime.id: "hierarchical"`。
4. **delegate 会再跑一遍 hierarchical** → 内层直接 `runEmbeddedAttempt`，override 防 harness 重入。
