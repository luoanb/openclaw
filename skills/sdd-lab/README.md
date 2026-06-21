# sdd-lab

`sdd-lab` 是项目级 SDD 需求迭代工作流。它参考 `sdd-riper-one-light` 的门禁思想，并按阶段沉淀文档：

- `requirements.md`：需求对齐，说明要做什么、为什么做、怎么验收。
- `visual-design.md`：视觉设计文档，说明 Figma 或视觉稿的核心设计事实；仅在涉及视觉稿时创建。
- `lifecycle.md`：生命周期，说明当前状态、批准、执行、验证、review 和交接。
- `technical-plan.md`：技术方案，说明基于当前项目现状怎么实现；只在技术方案生成阶段创建。

## 适用场景

- 需要先沉淀需求文档，涉及视觉稿时先生成视觉设计文档，再生成技术方案。
- 需求需要多轮对齐、执行、review 和回写。
- 希望在 `docs/sdd-lab` 下管理多个需求迭代。
- 需要默认列出当前需求，并区分进行中与已完结。

## 文档位置

所有需求迭代放在：

```text
docs/sdd-lab/
```

每个需求一个独立文件夹。需求文档生成阶段只创建：

```text
docs/sdd-lab/YYYY-MM-DD_hh-mm_<iteration-name>/
├── lifecycle.md
└── requirements.md
```

若需求涉及 Figma、视觉稿、页面还原、Icon 导出或设计稿文档化，在技术方案生成前创建：

```text
docs/sdd-lab/YYYY-MM-DD_hh-mm_<iteration-name>/
├── lifecycle.md
├── requirements.md
└── visual-design.md
```

进入技术方案生成阶段后，再创建；若不涉及视觉稿，可以没有 `visual-design.md`：

```text
docs/sdd-lab/YYYY-MM-DD_hh-mm_<iteration-name>/
├── lifecycle.md
├── requirements.md
├── visual-design.md
└── technical-plan.md
```

## 最小启动方式

创建新迭代时：

```text
请使用 sdd-lab 建立一个新需求迭代。
目标：
范围：
约束：
验收方式：
先生成需求文档，不要写代码。
```

继续已有迭代时：

```text
请使用 sdd-lab 继续 <iteration-name>。
先读取 lifecycle、requirements 和 technical-plan，告诉我当前状态和下一步。
```

默认无具体输入时：

```text
请使用 sdd-lab。
```

此时 agent 应列出 `docs/sdd-lab` 下的需求列表，按进行中优先、时间倒序展示；`reviewing` 和 `done` 都归入已完结分组。

## 状态

状态只保留 5 个：

- `draft`：需求对齐中。
- `planned`：需求已确认，视觉设计文档按需补齐，技术方案生成或已确认。
- `executing`：用户已批准执行。
- `reviewing`：实现完成后进入 review，列表展示时算已完结。
- `done`：已完结。

主路径：

```text
draft -> planned -> executing -> reviewing -> done
```

回退路径：

- `planned -> draft`：需求不清或需求变更。
- `executing -> planned`：技术方案不可行。
- `reviewing -> planned`：review 发现方案偏差或验证不足。

## 与 sdd-riper-one-light 的差异

`sdd-riper-one-light` 强调最小 spec 和 checkpoint；`sdd-lab` 强调需求迭代资产化。

主要差异：

- 不把需求、方案和执行记录压在一个 spec 里。
- 需求阶段只维护 `requirements.md` 和 `lifecycle.md`，不创建 `technical-plan.md` 占位文件。
- 涉及视觉稿时，先创建或维护 `visual-design.md`，再生成 `technical-plan.md`。
- 技术方案阶段再创建并维护 `technical-plan.md`。
- 用 `lifecycle.md` 管状态流转、批准、验证和 review。
- 默认行为是列出 `docs/sdd-lab` 的需求列表，而不是直接进入某个任务。

## 使用原则

- 没有需求文档，不写技术方案。
- 涉及视觉稿时，没有必要的视觉设计文档，不写技术方案。
- 没有技术方案，不进入执行。
- 没有用户批准，不改代码。
- 文档与代码冲突时，先同步文档，再同步代码。
- Review 以 `requirements.md`、`visual-design.md`（如存在）和 `technical-plan.md` 为基准，不以聊天记忆为基准。
