# Demo workspace — hierarchical agent tree

内置示例 workspace，用于 hierarchical 插件实机验证与自动化 E2E。

**完整操作步骤**（dev 实例、`~/.openclaw-dev/`、Gateway 启动、验收清单）见：

→ [`extensions/hierarchical/GATEWAY_VALIDATION.md`](../../GATEWAY_VALIDATION.md)

## 目录结构

```
hierarchical/
├── prompt/10-soul.md, 20-agents.md          ← 根节点
└── children/architect/                        ← 枝节点
    └── hierarchical/
        ├── prompt/25-agents.md
        └── children/
            ├── security-auditor/              ← 叶节点
            └── doc-translator/                  ← 叶节点
```

## 在 dev 实例中使用

将 `agents.list[].workspace` 指向本目录（**仅改** `~/.openclaw-dev/openclaw.json`）：

```json5
{
  agents: {
    list: [
      {
        id: "dev",
        workspace: "/path/to/openclaw/extensions/hierarchical/fixtures/demo-workspace",
      },
    ],
  },
}
```

或复制到 dev 工作区：

```bash
cp -a extensions/hierarchical/fixtures/demo-workspace/hierarchical \
  ~/.openclaw-dev/workspace-dev/hierarchical
```

## 自动化测试

```bash
npx tsx --test extensions/hierarchical/e2e-spawn-chain.test.ts
```
