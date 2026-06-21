# Requirements — Agent 树形层级与提示词规范

## 背景

当前 OpenClaw 的子 Agent 通过 `sessions_spawn` 创建，每个子 Agent 使用与父 Agent 相同的系统提示词管道（`buildAgentSystemPrompt`），仅通过 `buildSubagentSystemPrompt` 生成的 `## Subagent Context` 片段和 task 消息区分行为。

存在两个问题：

1. **子 Agent 个性化不足**：没有统一的机制让不同子 Agent 拥有不同的人格/行为风格。当前只能通过 task 文本或配置文件级别的独立工作区来实现，前者权重低，后者过于臃肿。
2. **缺少层级管理规范**：每个子 Agent 都拥有全部工具权限，没有"枝节点只管调度、叶节点只执行"的区分。

## 目标

1. 设计一套**一致性的子 Agent 配置规范**，让每个子 Agent 可以有自己的提示词文件（hierarchical/ 文件），所有 Agent 共享同一个工作区。
2. 设计**智能体调度规范**，定义枝/叶层级结构。
3. 支持每个智能体**自定义个性**。

## 范围

- OpenClaw Agent 系统提示词管道
- `sessions_spawn` 调度机制
- 子 Agent 配置文件/提示词文件的组织方式
- 不涉及：ACP 运行时、Cron 任务调度、渠道插件

## 非目标

- 不重新设计 OpenClaw 核心提示词管道（`buildAgentSystemPrompt`）
- 不改动 `buildSubagentSystemPrompt` 的实现方式（hierarchical harness 通过 `extraSystemPrompt` 叠加层级内容）
- 不涉及视觉效果/UI 设计
- 不在本迭代修改 OpenClaw 框架核心模块（实现放在 `extensions/hierarchical/` 插件内）

## 需求

### 1. 树形层级结构

Agent 按树形层级组织，分两类节点：

```
         用户
           │
         [根节点]     ← 枝节点，上级是用户
        /        \
   [枝节点A]   [枝节点B]  ← 枝节点，只管理
      |            |
  [叶节点1]    [叶节点2]  ← 叶节点，可以调工具
```

#### 枝节点规则

- **只有选择权**：分析任务 → 判断由哪个子 Agent 执行 → 派单
- **没有执行权**：不能调用 execution 类工具（read/write/exec/web_search 等）；可保留 dispatch + query 类工具
- 对上管理：向父节点汇报结果
- 对下管理：选择子 Agent 并派发任务 → 汇总子 Agent 结果
- 枝节点的能力仅限于从自己的 `hierarchical/children/` 中选择合适的 Agent 并派发

#### 叶节点规则

- **可以调用工具**（read/write/exec/web_search 等）
- 只执行分配给自己的任务
- 不能再创建子 Agent（除非特殊配置）
- 完成即止

#### 根节点规则

- 枝节点的特例
- 上级是用户（而非另一个 Agent）
- 接收用户的原始消息 → 拆解 → 分发给下层

### 2. 提示词文件组织规范

所有 Agent 共享同一个工作区，采用**递归嵌套结构**。每个 Agent 的关注范围由目录层级决定——`hierarchical/children/` 内的属于子 Agent，之外的属于该 Agent 自身的上下文。

#### 目录结构

所有节点的提示词文件统一放在 `hierarchical/` 目录下，子层通过 slot 覆盖父层实现增量定制。

```
<workspace>/
└── hierarchical/                     ← 根节点控制器
    ├── prompt/                       ← 根节点提示词（按 slot 编号）
    │   ├── 10-soul.md
    │   ├── 20-agents.md
    │   ├── 30-memory.md
    │   └── 40-tools.md
    │
    └── children/                     ← 根节点的子 Agent 目录
        ├── security-auditor/
        │   └── hierarchical/         ← security-auditor 控制器
        │       ├── prompt/           ← security-auditor 的提示词
        │       │   └── 25-agents.md
        │       │
        │       └── children/         ← security-auditor 的子 Agent
        │           └── sub-auditor/
        │               └── hierarchical/
        │                   └── prompt/
        │
        ├── doc-translator/
        │   └── hierarchical/
        │       ├── prompt/
        │       └── children/
        │
        └── architect/
            └── hierarchical/
                ├── prompt/
                └── children/
```

#### 层级划分规则

```
<workspace>/                    ← 根节点（根 Agent）
    └── hierarchical/
        ├── prompt/             ← 根节点自己的提示词
        │   ├── 10-soul.md
        │   └── 20-agents.md
        └── children/           ← 以下属于根节点的子节点
            ├── security-auditor/
            │   └── hierarchical/
            │       ├── prompt/         ← security-auditor 自己的提示词
            │       │   └── 25-agents.md
            │       └── children/       ← 以下属于 security-auditor 的子节点
            │           └── ...
            └── ...
```

- **每个节点**：`hierarchical/prompt/` 放该节点的提示词文件，`hierarchical/children/` 放子节点
- **PLS 聚合规则**：从当前节点的 `hierarchical/prompt/` 开始，逐级向上读各层级 `prompt/` 目录，按 slot 名合并（子层同名文件覆盖父层）。`children/` 目录不参与 PLS 聚合
- 以此类推，递归嵌套，深度不限

#### 子 Agent 文档格式（遵循 Skills 规范）

子 Agent 的 `hierarchical/prompt/` 目录下的文件遵循 Skills 的 frontmatter 规范，格式如下：

```markdown
---
name: security-auditor
description: 进行代码安全审计，按 CWE 分类报告漏洞并给出修复建议
---

# Security Auditor

## 行为规则

- 审查代码时按 CWE 编号分类漏洞
- 按严重程度排序报告
- 未发现漏洞则直接回复
```

#### 提示词构建规则

提示词通过 PLS（Prompt Loading Service）统一构建，核心机制是**目录树聚合**。

##### PLS 聚合规则

每个节点执行时，PLS 从该节点的目录开始向上遍历到 workspace 根，沿途收集每层的 `hierarchical/` 文件，按 slot 名合并（子层同名文件覆盖父层）。

```
根节点提示词 = PLS(workspace 根)
               = root/hierarchical/ 下所有文件聚合
               + children/ 下子 Agent 的 frontmatter 列表

枝节点提示词 = PLS(枝节点目录)
               = root/hierarchical/ + 枝/hierarchical/（子层覆盖父层）
               + children/ 下子 Agent 的 frontmatter 列表

叶节点提示词 = PLS(叶节点目录)
               = root/hierarchical/ + 枝/hierarchical/ + 叶/hierarchical/
```

##### 子 Agent 描述符列表

父 Agent 在构建提示词时，扫描 `hierarchical/children/` 目录下每个子 Agent 的 `prompt/` 中的 `*agents.md` 文件，提取 frontmatter 中的 name/description，生成 `<available_agents>` 列表。

```
## Available Sub-Agents

<available_agents>
  <agent>
    <name>security-auditor</name>
    <description>进行代码安全审计</description>
    <location>children/security-auditor/</location>
  </agent>
</available_agents>
```

##### 个性机制

节点个性通过 `hierarchical/` 下的文件实现：

- 子节点在自己的 `hierarchical/` 目录下写文件，PLS 聚合时自动包含
- 同名 slot 覆盖：子层的 `25-agents.md` 覆盖父层同 slot 文件
- 非同名 slot 追加：子层的 `15-specialty.md` 作为完全新增的 slot 追加到聚合结果中

#### 目录加载机制

提示词加载由 PLS 统一处理，不依赖"父提示词传递"或"逐一追加"：

- 每次执行时，PLS 从当前节点的 `hierarchical/prompt/` 向上遍历到根的 `hierarchical/prompt/`，独立聚合
- `children/` 目录不参与 PLS 聚合；子节点目录只在父节点构建 `<available_agents>` 列表时读取 frontmatter
- 每个 Agent 只看自己 `hierarchical/children/`，不看父级或平级的
- 各 Agent 之间通过 `sessions_spawn` 通过 agentId 路由，agentId 即为 `hierarchical/children/` 下的目录名

### 3. 节点类型由目录结构自洽推断

不需要显式声明类型，目录结构本身就是类型声明：

| 目录特征                                      | 推断类型           | 含义                                |
| --------------------------------------------- | ------------------ | ----------------------------------- |
| 工作区根目录（固定）                          | `root`（根节点）   | 上级是用户                          |
| 有 `hierarchical/children/<id>/` 且内部有文件 | `branch`（枝节点） | 可以 spawn 子 Agent，**不能调工具** |
| 没有 `hierarchical/children/` 或目录为空      | `leaf`（叶节点）   | **不能 spawn** 子 Agent，可以调工具 |

#### 类型约束

| 类型               | 选择权 | 执行权 | 查询权 | 系统权 | 回传结果 |
| ------------------ | ------ | ------ | ------ | ------ | -------- |
| `root`（根节点）   | ✅     | ✅     | ✅     | ✅     | 给用户   |
| `branch`（枝节点） | ✅     | ❌     | ✅     | ❌     | 给父节点 |
| `leaf`（叶节点）   | ❌     | ✅     | ✅     | ❌     | 给父节点 |

各权限对应的工具类别：

- **选择权** = dispatch 工具：sessions_spawn, sessions_yield, subagents, sessions_list, sessions_history, sessions_send
- **执行权** = execution 工具：read, write, edit, apply_patch, grep, find, ls, exec, process, web_search, web_fetch, browser, canvas, nodes, image, image_generate, message
- **查询权** = query 工具：session_status, agents_list
- **系统权** = system 工具：gateway, cron, skill_workshop

### 4. 调度规范

#### 术语：OpenClaw agentId vs 层级 nodeId

| 概念                  | 含义                                                               | 示例                                                 |
| --------------------- | ------------------------------------------------------------------ | ---------------------------------------------------- |
| **OpenClaw agentId**  | `agents.list[].id` 中注册的运行时 agent；启用 hierarchical harness | `my-agent`                                           |
| **层级 nodeId**       | `hierarchical/children/` 下的目录名；用于 PLS/NTS 定位节点         | `security-auditor`                                   |
| **OpenClaw agentDir** | 状态目录（auth、sqlite 等）；**不用于 PLS**                        | `~/.openclaw/agents/my-agent/agent`                  |
| **层级 nodeDir**      | workspace 内节点目录；**PLS/NTS 使用**                             | `{workspace}/hierarchical/children/security-auditor` |

#### 创建子 Agent（hierarchical harness 路由约定）

hierarchical 模式下，`sessions_spawn.agentId` **仍指 OpenClaw 注册的 agent**（通常与父 agent 相同，或不传以继承父 agent）。**层级 nodeId 通过 `label` 传递**：

```typescript
sessions_spawn({
  task: "审计此代码",
  label: "security-auditor", // nodeId = hierarchical/children/ 下的目录名
  // 不传 agentId → 继承父 OpenClaw agent；harness 按 label 解析 nodeDir
});
```

节点路径解析：

- **根节点**：`nodeDir = workspaceDir`（含 `hierarchical/` 的工作区根）
- **子节点**：沿 `spawnedBy` 会话链向上，每层取 session `label` 作为 nodeId，拼接 `{parent}/hierarchical/children/{nodeId}`

spawn 时 **实时读取** `hierarchical/children/{nodeId}/` 下的 prompt 文件（不预加载）。

#### 任务流转

```
根节点收到用户请求
    │
    ├─ 分析 → 拆解为子任务
    │
    ├─ sessions_spawn(agentId: "architect", task: "评估架构方案")
    │   └─ 枝节点 architect 收到任务
    │       ├─ 分析任务 → 拆解
    │       ├─ sessions_spawn(agentId: "security-auditor", task: "审查某模块")  ← 叶节点
    │       ├─ sessions_spawn(agentId: "doc-translator", task: "翻译某文档")     ← 叶节点
    │       ├─ 等待子节点完成
    │       ├─ 汇总结果
    │       └─ 返回给根节点
    │
    └─ 根节点汇总所有子节点结果 → 回复用户
```

#### 结果回传

- 叶节点：工具执行结果 + 文本结论 → 直接报告给父节点
- 枝节点：汇总所有子节点的结果 + 自己的分析判断 → 报告给父节点
- 根节点：汇总 → 呈现给用户

## 验收标准

1. [x] 树形层级定义清晰（枝/叶/根三类），类型约束可验证 — `node-tool-registry.test.ts`
2. [x] 目录结构规范明确：`hierarchical/children/` 递归嵌套，每个节点有独立的 `prompt/` 目录
3. [x] 每个 Agent 通过自己的 `hierarchical/prompt/` 目录实现个性化，slot 覆盖机制支持增量定制 — `prompt-loader.test.ts`
4. [x] 节点类型由目录结构自洽推断：有非空 `hierarchical/children/` 为枝节点，否则为叶节点 — `detectNodeType`
5. [x] 枝节点不调 execution 工具、叶节点不能 spawn — NTS + `toolsAllow` 硬过滤（单测通过；Gateway E2E 待 V3）
6. [x] 子 Agent 的 `hierarchical/prompt/` 文件遵循 Skills frontmatter 规范（`name`/`description`）
7. [x] 父 Agent 构建提示词时扫描 `hierarchical/children/` 下 frontmatter，生成 `<available_agents>` 列表
8. [x] 加载机制明确：PLS 从 nodeDir 向上聚合各层 `hierarchical/prompt/` 文件，子层覆盖父层
9. [x] 子 Agent 提示词 = PLS 从子 nodeDir 向上聚合（含根到子的全部层级）
10. [x] 每个 Agent 只看自己的 `hierarchical/children/`，不访问父级或平级的 children
11. [x] 系统级配置由根节点 `hierarchical/prompt/` 统一管理，子节点通过 slot 覆盖调整
12. [x] 子节点只需在 `hierarchical/prompt/` 下放需要覆盖的 slot 文件，其余从根节点继承

## 开放问题（已关闭）

1. **工具权限** ✅：dispatch（6）+ query（2）给 branch；execution（17）+ query（2）给 leaf；root 全部。V1 不支持叶节点自定义白名单。
2. **Agent 发现方式** ✅：OpenClaw agentId 与层级 nodeId 分离；nodeId 通过 `sessions_spawn.label` 传递，**不需要**在 `agents.list` 为每个子节点注册。
3. **`children/` 扫描时机** ✅：每次 harness turn 实时读取（PLS + scanner）。
4. **hierarchical/ 在提示词中的位置** ✅：PLS 聚合结果经 `extraSystemPrompt` 注入；与 Native bootstrap 并存（V2 用 `bootstrapContextMode: lightweight` 减少重复）。
5. **根节点继承** ✅：PLS 目录树聚合自动传递；子层 slot 覆盖。
