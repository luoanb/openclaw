# Hierarchical 插件 — 实机验证指南

本文说明如何在 **开发实例** 上对 hierarchical harness 做 Gateway 实机验证。

> **禁止改动生产配置**：`~/.openclaw/openclaw.json` 为生产环境，本文所有配置与命令仅针对 **`~/.openclaw-dev/`** 开发实例。

---

## 1. 开发实例 vs 生产实例

OpenClaw 用 **profile** 隔离状态目录。源码本地调试应使用 dev profile，与生产完全分离。

| 项目              | 生产（勿动）                | 开发（源码验证用）                         |
| ----------------- | --------------------------- | ------------------------------------------ |
| 状态目录          | `~/.openclaw/`              | `~/.openclaw-dev/`                         |
| 配置文件          | `~/.openclaw/openclaw.json` | `~/.openclaw-dev/openclaw.json`            |
| 默认 Gateway 端口 | `18789`（常规）             | `19001`                                    |
| 启用方式          | —                           | CLI 全局 `--dev` 或 `OPENCLAW_PROFILE=dev` |

官方说明见：

- [Debugging — Dev profile + dev gateway](docs/help/debugging.md#dev-profile--dev-gateway-dev)
- [Gateway configuration — 多实例](docs/gateway/configuration-reference.md)（`--dev` / `OPENCLAW_CONFIG_PATH`）
- [CLI global flags — `--dev`](docs/cli/index.md#global-flags)

### 1.1 源码仓库推荐的 Gateway 启动方式

在仓库根目录：

```bash
# 等价于 OPENCLAW_PROFILE=dev + gateway --dev，并跳过 channel 加载
pnpm gateway:dev
```

重置 dev 实例（**仅 wipe `~/.openclaw-dev`**，不影响生产）：

```bash
pnpm gateway:dev:reset
```

等价的手动形式：

```bash
OPENCLAW_PROFILE=dev pnpm openclaw gateway --dev --force
```

---

## 2. 前置条件

### 2.1 编译

插件从 **`dist/extensions/hierarchical/`** 加载；harness 委托 OpenClaw runner 需要 SDK export `runOpenClawEmbeddedAttempt`。

```bash
cd /path/to/openclaw   # 仓库根
pnpm install           # 如需要
pnpm build
```

每次修改 `extensions/hierarchical/` 或 `src/plugin-sdk/agent-harness-runtime.ts` 后需重新 build，并 **重启 dev Gateway**。

### 2.2 自动化测试（无需 Gateway）

```bash
npx tsx --test extensions/hierarchical/*.test.ts
# 52 tests — 含 spawn 链 E2E
```

---

## 3. 配置开发实例（仅 `~/.openclaw-dev/openclaw.json`）

以下所有编辑 **只改** `~/.openclaw-dev/openclaw.json`，不要碰 `~/.openclaw/openclaw.json`。

### 3.1 启用 hierarchical 插件

**方式 A — bundled（build 后默认路径）**

```bash
OPENCLAW_PROFILE=dev pnpm openclaw plugins enable hierarchical
```

**方式 B — 源码热路径（开发推荐）**

在 `~/.openclaw-dev/openclaw.json` 中指向仓库内的插件目录（路径按本机 checkout 调整）：

```json5
{
  plugins: {
    load: {
      paths: ["/path/to/openclaw/extensions/hierarchical"],
    },
    entries: {
      hierarchical: { enabled: true },
    },
  },
}
```

验证：

```bash
OPENCLAW_PROFILE=dev pnpm openclaw plugins inspect hierarchical
# Status: enabled；Source 指向 dist 或 load.paths
```

### 3.2 绑定 hierarchical runtime（model 级）

`agentRuntime.id` 必须写在 **provider/model 条目**上，不是 legacy 的 whole-agent runtime。

```json5
{
  agents: {
    defaults: {
      model: "your-provider/your-model",
      models: {
        "your-provider/your-model": {
          agentRuntime: { id: "hierarchical" },
        },
      },
    },
    list: [
      {
        id: "dev",
        default: true,
        workspace: "/path/to/your/hierarchical-workspace",
      },
    ],
  },
  gateway: {
    mode: "local",
  },
}
```

**注意**：若 `agents.defaults.model` 与 `models` 里启用 hierarchical 的 model ref **不一致**，实机 turn 不会走 hierarchical harness。测试时请：

- 把 hierarchical 绑到默认 model 上，或
- CLI 显式指定：`--model your-provider/your-model`

### 3.3 选择 workspace

二选一（路径仅示例，按本机调整）：

| 方案              | workspace 路径                                           | 说明                                  |
| ----------------- | -------------------------------------------------------- | ------------------------------------- |
| **A. 内置 demo**  | 仓库内 `extensions/hierarchical/fixtures/demo-workspace` | 已含完整三层树，开箱即用              |
| **B. dev 工作区** | `~/.openclaw-dev/workspace-dev`                          | 在目录下自建或复制 `hierarchical/` 树 |

方案 B 示例：

```bash
cp -a extensions/hierarchical/fixtures/demo-workspace/hierarchical \
  ~/.openclaw-dev/workspace-dev/hierarchical
```

### 3.4 配置自检

```bash
OPENCLAW_PROFILE=dev pnpm openclaw doctor
# 有问题：OPENCLAW_PROFILE=dev pnpm openclaw doctor --fix
```

---

## 4. 启动 dev Gateway

**终端 A**（仓库根）：

```bash
pnpm build                  # 如刚改过插件
pnpm gateway:dev
# 或：OPENCLAW_PROFILE=dev pnpm openclaw gateway --force
```

**终端 B** 检查就绪：

```bash
OPENCLAW_PROFILE=dev pnpm openclaw gateway status --deep
# dev Gateway 端口默认 19001
```

若本机同时跑着 **生产 Gateway**（18789），两者可并存；CLI 需带 `--dev` / `OPENCLAW_PROFILE=dev` 才会连 dev 实例。

---

## 5. 发送测试 turn

所有 CLI 命令必须带 **dev profile**：

```bash
OPENCLAW_PROFILE=dev pnpm openclaw agent ...
# 或
pnpm openclaw --dev agent ...
```

### 5.1 根节点 smoke

```bash
OPENCLAW_PROFILE=dev pnpm openclaw agent \
  --agent dev \
  --model your-provider/your-model \
  --message "你是根节点。简述职责，并列出可用子 Agent。" \
  --verbose on
```

期望：

- 回复体现 workspace 内 `hierarchical/prompt/` 的内容（demo 下为 Root Coordinator / Root Rules）
- 提到 `architect` 等子 Agent
- `OPENCLAW_PROFILE=dev pnpm openclaw status` 中 Runtime 显示 hierarchical harness（非纯 OpenClaw Default）

### 5.2 验证 spawn 链

向根节点发送（自然语言即可，模型应调用工具）：

```text
请用 sessions_spawn 派 architect 分析 API 设计。
task: "Review REST API"
label 必须是 "architect"（不要传 agentId 作为 nodeId）。
```

再派叶节点：

```text
请用 sessions_spawn 派 security-auditor 审计 auth 模块，label: "security-auditor"。
```

**Spawn 约定**（详见 `docs/sdd-lab/2026-06-20_14-39_agent-hierarchy-spec/requirements.md`）：

| 字段               | 含义                                                |
| ------------------ | --------------------------------------------------- |
| OpenClaw `agentId` | `agents.list[].id`（通常继承父 agent，或不传）      |
| `label`            | 层级 **nodeId** = `hierarchical/children/` 下目录名 |

### 5.3 验证工具硬过滤

| 节点类型               | 测试                  | 期望                           |
| ---------------------- | --------------------- | ------------------------------ |
| 枝（architect）        | 要求 `exec` / `read`  | 工具不在 allow-list 或调用失败 |
| 叶（security-auditor） | 要求 `sessions_spawn` | 不可用；`read`/`exec` 可用     |

### 5.4 不启 Gateway 的快速路径

```bash
OPENCLAW_PROFILE=dev pnpm openclaw agent \
  --agent dev \
  --local \
  --model your-provider/your-model \
  --verbose on \
  --message "hierarchical harness smoke"
```

`--local` 走 embedded 路径，仍 preload 插件；适合先确认 harness 委托是否正常。

---

## 6. 验收清单（对照 VALIDATION §4）

- [ ] 根 Agent 回复含 PLS 聚合内容
- [ ] `label: "architect"` spawn 后，子 turn 含根 + 枝内容
- [ ] architect（枝）无法 `exec`/`read`
- [ ] security-auditor（叶）无法 `sessions_spawn`，可 `read`/`exec`
- [ ] 三层继承：auditor 含 root + architect + audit 全文链

自动化等价验证（无需 Gateway）：

```bash
npx tsx --test extensions/hierarchical/e2e-spawn-chain.test.ts
```

---

## 7. 常见问题

| 现象                                         | 原因                                            | 处理                                                 |
| -------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| `runOpenClawEmbeddedAttempt is not exported` | dist 过旧                                       | `pnpm build` + 重启 dev Gateway                      |
| 仍走 OpenClaw Default runtime                | 当前 model 未绑 `agentRuntime.id: hierarchical` | 改 `~/.openclaw-dev/openclaw.json` 或 `--model` 指定 |
| 改了插件无效果                               | 未 build / 未重启 Gateway                       | `pnpm build` + 重启 `pnpm gateway:dev`               |
| 提示词无层级内容                             | workspace 无 `hierarchical/` 或路径错误         | 检查 `agents.list[].workspace`                       |
| spawn 找不到子节点                           | 用 `agentId` 传 nodeId                          | 改用 `label: "<nodeId>"`                             |
| CLI 连错 Gateway                             | 未带 dev profile                                | 命令前加 `OPENCLAW_PROFILE=dev` 或 `--dev`           |
| 误改生产配置                                 | 编辑了 `~/.openclaw/`                           | **仅编辑** `~/.openclaw-dev/openclaw.json`           |

---

## 8. 相关文档

| 文档                                                  | 内容                                 |
| ----------------------------------------------------- | ------------------------------------ |
| `extensions/hierarchical/VALIDATION.md`               | 编译 / 单测 / 自动化 E2E             |
| `extensions/hierarchical/fixtures/demo-workspace/`    | 示例 workspace 目录树                |
| `docs/help/debugging.md`                              | dev profile、`pnpm gateway:dev`      |
| `docs/concepts/agent-runtimes.md`                     | `agentRuntime.id` 语义               |
| `docs/tools/plugin.md`                                | `plugins.load.paths`、enable/disable |
| `docs/sdd-lab/2026-06-20_14-39_agent-hierarchy-spec/` | 需求 / 方案 / 生命周期               |
