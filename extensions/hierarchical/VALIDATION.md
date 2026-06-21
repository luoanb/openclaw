# Validation Plan — Hierarchical Extension

> 验证覆盖 3 个核心模块 + 1 个集成场景，不依赖 Gateway 运行环境。

---

## 1. 编译验证

```bash
cd /home/lab/workspace/openclaw
npx tsc --pretty -p tsconfig.hierarchical.json
```

---

## 2. 单元测试（3 组 + node-path-resolver，覆盖 PLS / Scanner / NTS / 路径解析）

### 运行方式

```bash
cd /home/lab/workspace/openclaw
npx tsx --test extensions/hierarchical/*.test.ts
```

> 注意：直接用 `node --test` 会因 `.ts` → `.js` 未编译而失败；必须用 `tsx`。

### 2.1 prompt-loader 测试

**测试文件**：`extensions/hierarchical/prompt-loader.test.ts`

| 用例             | 验证点                        | 输入                                           | 预期输出                            |
| ---------------- | ----------------------------- | ---------------------------------------------- | ----------------------------------- |
| 空节点           | PLS 对无 ./prompt/ 的节点降级 | 临时目录，无 ./hierarchical/prompt/            | content 为空字符串，slots 为空      |
| 根节点单层聚合   | 单层 .md 文件被正常读取       | 根目录有 ./hierarchical/prompt/10-core.md      | content 包含 "10-core.md" 内容      |
| 子层覆盖父层     | slot 覆盖语义正确             | 根有 10-core.md(内容A)，子有 10-core.md(内容B) | content 包含 "内容B"，不含 "内容A"  |
| 非同名 slot 追加 | 子层新增 slot 被追加          | 根有 10-core.md，子有 15-ext.md                | content 同时包含两者                |
| 三层层级聚合     | 多层级正确合并                | 根/枝/叶 各 1 个 slot                          | 叶全量 = 根+枝+叶 正确覆盖          |
| 截断             | maxChars 生效                 | 根有超大文件，maxChars=50                      | content.length ≤ 50，truncated=true |
| 目录不存在       | 健壮性                        | 传入不存在的目录                               | 返回空结果，不抛异常                |

### 2.2 agent-children-scanner 测试

**测试文件**：`extensions/hierarchical/agent-children-scanner.test.ts`

| 用例             | 验证点                      | 输入                                 | 预期输出                                   |
| ---------------- | --------------------------- | ------------------------------------ | ------------------------------------------ |
| 无子节点         | children/ 不存在            | 根节点无 ./hierarchical/children/    | 返回 []                                    |
| 单子节点         | 发现单个子 Agent            | children/ 下有一个子目录含 AGENTS.md | 返回 [{ agentId, name, description }]      |
| 多子节点         | 发现多个子 Agent            | children/ 下有 3 个子目录            | 返回长度为 3 的数组                        |
| frontmatter 解析 | 正确读取 name/description   | AGENTS.md 内容有 `---` frontmatter   | name 和 description 被正确提取             |
| 无 frontmatter   | 降级行为                    | md 文件无 frontmatter                | 跳过该文件，继续找下一个                   |
| 空目录           | 空 children/                | children/ 存在但为空                 | 返回 []                                    |
| formatting       | formatChildrenList 输出格式 | 两个子节点                           | 包含 `<available_agents>` 和两个 `<agent>` |
| 深层递归         | 子节点的子节点 hasChildren  | 子节点下还有 children/               | hasChildren = true                         |

### 2.3 node-tool-registry 测试

**测试文件**：`extensions/hierarchical/node-tool-registry.test.ts`

| 用例           | 验证点                | 输入                                          | 预期输出                            |
| -------------- | --------------------- | --------------------------------------------- | ----------------------------------- |
| 根节点检测     | agentDir == rootDir   | agentDir = "/tmp/root", rootDir = "/tmp/root" | type = "root"                       |
| 枝节点检测     | 有 children/          | agentDir 下有 ./hierarchical/children/        | type = "branch"                     |
| 叶节点检测     | 无 children/          | agentDir 下无 ./hierarchical/children/        | type = "leaf"                       |
| root 工具集    | 全分组可用            | nodeType=root                                 | 返回全部 28 个已知工具              |
| branch 工具集  | dispatch+query        | nodeType=branch                               | 返回 dispatch 6 + query 2 = 8 个    |
| leaf 工具集    | execution+query       | nodeType=leaf                                 | 返回 execution 17 + query 2 = 19 个 |
| branch 无 exec | 枝节点不应有执行权    | nodeType=branch 包含 exec                     | exec 不在返回列表中                 |
| leaf 无 spawn  | 叶节点不应有 dispatch | nodeType=leaf 包含 sessions_spawn             | sessions_spawn 不在返回列表中       |

---

## 3. 测试工具

使用 Node.js 内置 `node:test` + `node:assert`，通过 `tsx` 运行 TypeScript 源文件。

测试目录结构（每次测试时用 `fs.mkdtemp` 动态创建）：

```
/tmp/hierarchical-test-XXXXX/
└── hierarchical/
    ├── prompt/
    │   └── 10-core.md
    └── children/
        └── auditor/
            ├── hierarchical/
            │   └── prompt/
            │       └── 20-agents.md
            └── children/
```

---

## 4. E2E 验证

### 4a. 自动化 spawn 链（无需 Gateway）✅

使用 `fixtures/demo-workspace/` + 模拟 session 链，覆盖 VALIDATION 原 §4 五场景：

```bash
npx tsx --test extensions/hierarchical/e2e-spawn-chain.test.ts
# 或跑全量：
npx tsx --test extensions/hierarchical/*.test.ts   # 52 tests
```

| #   | 场景           | 自动化验证方式                                    |
| --- | -------------- | ------------------------------------------------- |
| 1   | 根 Agent 启动  | session `agent:hier:main` → PLS 含 root prompt    |
| 2   | 子 Agent spawn | `label: architect` 链 → 继承 root + branch 内容   |
| 3   | 枝节点权限     | architect → `toolsAllow` 无 exec/read             |
| 4   | 叶节点权限     | security-auditor → `toolsAllow` 无 sessions_spawn |
| 5   | 多层继承       | root → architect → security-auditor 三层 PLS 全链 |

Spawn 约定：`sessions_spawn({ task, label: "<nodeId>" })`（见 `fixtures/demo-workspace/README.md`）。

### 4b. 手动 Gateway 验证（可选）

需先 `pnpm build` 启用 `runOpenClawEmbeddedAttempt` export。

```json5
// 用户 config.json5 中的配置
{
  agents: {
    list: [
      {
        id: "test-agent",
        models: {
          "siliconflow/*": {
            agentRuntime: { id: "hierarchical" },
          },
        },
      },
    ],
  },
}
```

### 端到端场景

| #   | 场景              | 步骤                                           | 预期                                   |
| --- | ----------------- | ---------------------------------------------- | -------------------------------------- |
| 1   | 根 Agent 正常启动 | 启动 Gateway，发送消息                         | 响应正常，提示词包含 PLS 聚合内容      |
| 2   | 子 Agent spawn    | `sessions_spawn({ agentId: "auditor", task })` | 子 Agent 提示词包含父级内容 + 自有内容 |
| 3   | 枝节点权限        | 枝节点尝试调 exec                              | 工具不存在或返回无权限                 |
| 4   | 叶节点权限        | 叶节点尝试调 sessions_spawn                    | 工具不存在或返回无权限                 |
| 5   | 多层继承          | spawn 子 Agent → spawn 孙 Agent                | 孙 Agent 提示词包含全链条内容          |

---

## 5. 验证执行计划

| 阶段 | 内容                                    | 预计时间   |
| ---- | --------------------------------------- | ---------- |
| 1    | 编写 3 个 test 文件                     | ~20 min    |
| 2    | 运行测试，修 bug                        | ~10 min    |
| 3    | E2E spawn 链（e2e-spawn-chain.test.ts） | ✅ 6 cases |
| 4    | 手动 Gateway 实机验证                   | 可选       |
