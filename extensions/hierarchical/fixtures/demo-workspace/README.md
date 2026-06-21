# Demo workspace — hierarchical agent tree

Example workspace for the hierarchical plugin. Copy or point your agent's
`workspace` config here when testing with Gateway.

## Layout

```
hierarchical/
├── prompt/                    ← root node
│   ├── 10-soul.md
│   └── 20-agents.md
└── children/
    └── architect/             ← branch node
        └── hierarchical/
            ├── prompt/
            │   └── 25-agents.md
            └── children/
                ├── security-auditor/   ← leaf
                │   └── hierarchical/prompt/30-audit.md
                └── doc-translator/     ← leaf
                    └── hierarchical/prompt/30-translate.md
```

## Gateway config snippet

```json5
{
  plugins: {
    entries: {
      hierarchical: { enabled: true },
    },
  },
  agents: {
    list: [
      {
        id: "hier",
        workspace: "/path/to/this/demo-workspace",
        models: {
          "your-provider/your-model": {
            agentRuntime: { id: "hierarchical" },
          },
        },
      },
    ],
  },
}
```

## Spawn convention

```typescript
// Root dispatches to architect (branch):
sessions_spawn({ task: "Review the API design", label: "architect" });

// Architect dispatches to leaf:
sessions_spawn({ task: "Audit auth module", label: "security-auditor" });
```

Do **not** pass hierarchical nodeIds as OpenClaw `agentId`. Use `label` for the
`hierarchical/children/` directory name.

## Automated E2E (no Gateway)

```bash
npx tsx --test extensions/hierarchical/e2e-spawn-chain.test.ts
```

## Manual Gateway check

1. `pnpm build` then enable the hierarchical plugin
2. Configure agent with `agentRuntime: { id: "hierarchical" }` and this workspace
3. Send a message to root — verify coordinated behavior
4. Ask root to spawn `architect` then `security-auditor` via label
5. Confirm branch cannot run exec tools; leaf cannot spawn
