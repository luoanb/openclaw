# Integration Test Plan — Hierarchical Extension (Automated)

> 不依赖 Gateway 运行环境。V2 将集成测聚焦于 `buildHierarchicalAttemptContext`（PLS + Scanner + NTS + 路径解析）；Harness delegate 行为由 `harness.test.ts` 验证。

---

## 方案

### 1. `integration.test.ts` — 上下文组装（10 场景）

通过 `nodeDirOverride` 模拟根/枝/叶节点，验证：

| #   | 场景                   | 验证点                              |
| --- | ---------------------- | ----------------------------------- |
| 1   | 根节点 PLS             | supplement 含 root prompt 内容      |
| 2   | 根节点子 Agent 列表    | `<available_agents>` + `<location>` |
| 3   | 根节点 toolsAllow      | 含 dispatch + execution             |
| 4   | 枝节点继承             | supplement 含根内容                 |
| 5   | 枝节点 NTS             | 无 exec；含 sessions_spawn          |
| 6   | 枝节点 children        | 列出 scanner                        |
| 7   | 叶节点三层继承         | 根 + 枝 + 叶内容                    |
| 8   | 叶节点 NTS             | 无 sessions_spawn；含 exec          |
| 9   | 叶节点无 children 列表 | 无 `<available_agents>`             |
| 10  | toolsAllow 交集        | 与 config allow-list 取交集         |

### 2. `harness.test.ts` — delegate 参数（1 场景）

Mock `delegateRunAttempt`，验证 harness 注入：

- `agentHarnessRuntimeOverride: "openclaw"`
- `bootstrapContextMode: "lightweight"`
- `extraSystemPrompt` 含 Tool Restrictions
- `toolsAllow` 为数组

### 3. `node-path-resolver.test.ts` — spawn 链路径（5 场景）

验证 `spawnedBy` + session `label` 链式解析 nodeDir。

---

## 执行方式

```bash
cd /home/lab/workspace/openclaw
npx tsx --test extensions/hierarchical/*.test.ts
```

## 通过标准

全部 46 个用例通过，零失败。

## Gateway E2E（V3，待做）

见 `VALIDATION.md` §4。
