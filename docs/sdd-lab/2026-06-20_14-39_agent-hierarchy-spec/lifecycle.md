# Lifecycle — Agent 树形层级与提示词规范

```yaml
status: in_progress
result: partial
updated_at: 2026-06-21 23:15
```

## Transition Log

| 时间             | 从          | 到          | 原因                     | 依据                                                          | 下一步                              |
| ---------------- | ----------- | ----------- | ------------------------ | ------------------------------------------------------------- | ----------------------------------- |
| 2026-06-20 14:39 | -           | draft       | 创建迭代                 | 景总明确需求方向                                              | 完成 requirements.md 后确认需求边界 |
| 2026-06-20 16:45 | draft       | draft       | 多次迭代优化需求         | 景总连续修正                                                  | 待景总确认需求完整                  |
| 2026-06-20 19:38 | draft       | planned     | 用户批准进入技术方案阶段 | requirements.md 已确认（5 轮迭代定稿）                        | 编写 technical-plan.md              |
| 2026-06-21 11:10 | planned     | planned     | 技术方案重构             | 景总确认采用 registerAgentHarness 独立实现方案，废弃增量改造  | 等待方案批准                        |
| 2026-06-21 22:50 | planned     | in_progress | 方案批准 + 模块实现启动  | technical-plan 四维度确认；PLS/Scanner/NTS 单测通过           | Harness V2 集成 + Gateway E2E       |
| 2026-06-21 23:15 | in_progress | in_progress | V3 自动化 E2E 完成       | e2e-spawn-chain.test.ts + fixtures/demo-workspace（52 tests） | 可选 Gateway 实机验证               |

## State

- **requirements.md**: ✅ 已定稿；spawn 路由与术语已同步
- **technical-plan.md**: ✅ V1/V2 完成；V3 自动化 E2E 完成
- **extensions/hierarchical/**: ✅ 52 tests；demo-workspace fixture 就绪
- **lifecycle.md**: ✅ 已更新

## 实现进度

| 模块                          | 状态    | 验证                       |
| ----------------------------- | ------- | -------------------------- |
| `prompt-loader.ts` (PLS)      | ✅      | 8 unit tests               |
| `agent-children-scanner.ts`   | ✅      | 9 unit tests               |
| `node-tool-registry.ts` (NTS) | ✅      | 13 unit tests              |
| `node-path-resolver.ts`       | ✅      | 5 unit tests               |
| `harness-context.ts`          | ✅      | 10 integration tests       |
| `harness.ts` V2               | ✅      | delegate + harness.test.ts |
| `e2e-spawn-chain.test.ts`     | ✅      | 6 E2E scenarios            |
| `fixtures/demo-workspace/`    | ✅      | 示例 + README              |
| Gateway 实机 E2E              | ⏸️ 可选 | 见 `GATEWAY_VALIDATION.md` |

## Gateway 实机验证

见 [`extensions/hierarchical/GATEWAY_VALIDATION.md`](../../extensions/hierarchical/GATEWAY_VALIDATION.md)（仅使用 `~/.openclaw-dev/` 开发实例，不改动生产 `~/.openclaw/`）。

## Next Action

可选：按 GATEWAY_VALIDATION.md 在 dev Gateway 上跑实机清单；或标记需求 `result: done`（自动化验收已覆盖）
