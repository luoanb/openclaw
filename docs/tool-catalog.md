# OpenClaw 工具分类

28 个内置工具，按功能和 Agent 层级角色分类。

---

## 总览

| 类别         | 工具                                                                                      | 数量 |
| ------------ | ----------------------------------------------------------------------------------------- | ---- |
| 文件操作     | read, write, edit, apply_patch, grep, find, ls                                            | 7    |
| 命令执行     | exec, process                                                                             | 2    |
| 网络/搜索    | web_search, web_fetch                                                                     | 2    |
| 浏览器       | browser                                                                                   | 1    |
| 画布         | canvas                                                                                    | 1    |
| 节点管理     | nodes                                                                                     | 1    |
| 定时任务     | cron                                                                                      | 1    |
| 消息通信     | message                                                                                   | 1    |
| Gateway 管理 | gateway                                                                                   | 1    |
| 会话管理     | sessions_spawn, sessions_yield, subagents, sessions_list, sessions_history, sessions_send | 6    |
| 运行状态     | session_status, agents_list                                                               | 2    |
| 技能管理     | skill_workshop                                                                            | 1    |
| 图像         | image, image_generate                                                                     | 2    |

---

## 分类详情

### 文件操作（Execution Tools）

| 工具          | 说明                 | 角色 |
| ------------- | -------------------- | ---- |
| `read`        | 读取文件内容         | 执行 |
| `write`       | 创建或覆盖文件       | 执行 |
| `edit`        | 精确替换文件内容     | 执行 |
| `apply_patch` | 应用多文件补丁       | 执行 |
| `grep`        | 搜索文件中的模式     | 执行 |
| `find`        | 按 glob 模式查找文件 | 执行 |
| `ls`          | 列出目录内容         | 执行 |

### 命令执行（Execution Tools）

| 工具      | 说明               | 角色 |
| --------- | ------------------ | ---- |
| `exec`    | 运行 Shell 命令    | 执行 |
| `process` | 管理后台 exec 会话 | 执行 |

### 网络/搜索（Execution Tools）

| 工具         | 说明               | 角色 |
| ------------ | ------------------ | ---- |
| `web_search` | 使用配置的引擎搜索 | 执行 |
| `web_fetch`  | 抓取 URL 内容      | 执行 |

### 浏览器 / 画布 / 节点（Execution Tools）

| 工具      | 说明                                | 角色 |
| --------- | ----------------------------------- | ---- |
| `browser` | 控制浏览器                          | 执行 |
| `canvas`  | 展示/评估/截图画布                  | 执行 |
| `nodes`   | 管理配对节点（列表/通知/相机/屏幕） | 执行 |

### 图像（Execution Tools）

| 工具             | 说明                       | 角色 |
| ---------------- | -------------------------- | ---- |
| `image`          | 使用配置的图像模型分析图片 | 执行 |
| `image_generate` | 使用配置的生成模型生成图片 | 执行 |

### 消息通信（Execution & Dispatch）

| 工具      | 说明                                   | 角色      |
| --------- | -------------------------------------- | --------- |
| `message` | 发送消息和渠道动作（主动推送、回复等） | 执行/调度 |

### 会话管理（Dispatch Tools）

| 工具               | 说明                                | 角色     |
| ------------------ | ----------------------------------- | -------- |
| `sessions_spawn`   | 生成子 Agent 或 ACP 编码会话        | **调度** |
| `sessions_yield`   | 结束当前回合并等待子 Agent 完成事件 | **调度** |
| `subagents`        | 查看子 Agent 运行状态               | **调度** |
| `sessions_list`    | 列出其他会话（含子 Agent）          | **调度** |
| `sessions_history` | 获取其他会话的历史                  | **调度** |
| `sessions_send`    | 向其他会话发送消息                  | **调度** |

### 运行状态（Read-only Query）

| 工具             | 说明                                    | 角色 |
| ---------------- | --------------------------------------- | ---- |
| `session_status` | 显示使用/时间/模型状态的卡片            | 查询 |
| `agents_list`    | 列出允许用于 sessions_spawn 的 Agent ID | 查询 |

### 系统管理（System）

| 工具             | 说明                               | 角色 |
| ---------------- | ---------------------------------- | ---- |
| `gateway`        | 重启/配置/更新 OpenClaw 进程       | 系统 |
| `cron`           | 管理定时任务和唤醒事件             | 系统 |
| `skill_workshop` | 创建/更新/管理 Skill Workshop 提案 | 系统 |

---

## 按 Agent 层级角色的分配

```
                        用户
                          │
                     ┌────┴────┐
                     │ 根节点   │
                     │  (root)  │
                     │          │
                     │ 有选择权  │ → 可以 dispatch
                     │ 有执行权  │ → 可以用 Execution Tools
                     │ 有系统权  │ → 可以用 gateway / cron
                     └────┬────┘
                          │ sessions_spawn
              ┌───────────┼───────────┐
              │           │           │
        ┌─────┴────┐    ...         ...
        │ 枝节点    │
        │ (branch) │
        │          │
        │ 有选择权  │ → 仅 dispatch 工具
        │ 无执行权  │ → 不能用 Execution Tools
        │ 无系统权  │ → 不能动 gateway/cron/skill_workshop
        └────┬────┘
             │ sessions_spawn
        ┌────┴────┐
        │ 叶节点   │
        │ (leaf)  │
        │         │
        │ 无选择权 │ → 不能 dispatch
        │ 有执行权 │ → 可以用 Execution Tools
        └─────────┘
```

### 各类节点可用的工具

| 类别                  | 根节点 | 枝节点 | 叶节点 |
| --------------------- | ------ | ------ | ------ |
| 文件操作（7）         | ✅     | ❌     | ✅     |
| 命令执行（2）         | ✅     | ❌     | ✅     |
| 网络/搜索（2）        | ✅     | ❌     | ✅     |
| 浏览器/画布/节点（3） | ✅     | ❌     | ✅     |
| 图像（2）             | ✅     | ❌     | ✅     |
| 消息通信（1）         | ✅     | ❌     | ✅     |
| **会话管理（6）**     | ✅     | ✅     | ❌     |
| 运行状态（2）         | ✅     | ✅     | ❌     |
| 系统管理（3）         | ✅     | ❌     | ❌     |

### Dispatch 工具对枝节点的意义

枝节点不能调执行工具，但可以用 dispatch 工具来完成任务：

| 枝节点能用的工具                | 用途                        |
| ------------------------------- | --------------------------- |
| `sessions_spawn(agentId, task)` | 选择合适的子 Agent 派发任务 |
| `sessions_yield()`              | 等待子 Agent 完成           |
| `subagents(action="list")`      | 查看子 Agent 状态           |
| `agents_list`                   | 查看可用的子 Agent          |
| `session_status`                | 查看自身会话状态            |

枝节点通过 **描述符（frontmatter）** 来选择子 Agent：

```
## Available Sub-Agents

<available_agents>
  <agent>
    <name>security-auditor</name>
    <description>进行代码安全审计，按 CWE 分类报告漏洞</description>
  </agent>
  <agent>
    <name>code-generator</name>
    <description>根据需求生成代码实现</description>
  </agent>
</available_agents>
```

枝节点看到描述 → 选择匹配的 Agent → `sessions_spawn(agentId: "security-auditor")` → 等结果 → 汇总。
