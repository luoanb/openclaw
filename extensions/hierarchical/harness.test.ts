import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AgentHarnessAttemptParams,
  AgentHarnessAttemptResult,
} from "openclaw/plugin-sdk/agent-harness-runtime";
import { createHierarchicalHarness } from "./harness.js";

describe("hierarchical harness delegate", () => {
  it("injects extraSystemPrompt, toolsAllow, and openclaw override", async () => {
    let captured: AgentHarnessAttemptParams | undefined;
    const harness = createHierarchicalHarness({
      delegateRunAttempt: async (params) => {
        captured = params;
        return {
          aborted: false,
          externalAbort: false,
          timedOut: false,
          idleTimedOut: false,
          timedOutDuringCompaction: false,
          promptError: null,
          promptErrorSource: null,
          sessionIdUsed: params.sessionId,
          assistantTexts: ["ok"],
          messagesSnapshot: [],
          toolMetas: [],
          lastAssistant: undefined,
          didSendViaMessagingTool: false,
          messagingToolSentTexts: [],
          messagingToolSentMediaUrls: [],
          messagingToolSentTargets: [],
          cloudCodeAssistFormatError: false,
          replayMetadata: {
            mode: "bypass",
            hadPotentialSideEffects: false,
            replaySafe: true,
          },
          itemLifecycle: { interactionId: "", runId: "", sessionId: params.sessionId },
          setTerminalLifecycleMeta: () => {},
        } as unknown as AgentHarnessAttemptResult;
      },
    });

    await harness.runAttempt({
      sessionId: "s1",
      workspaceDir: "/tmp/empty-hierarchical-workspace",
      provider: "test",
      modelId: "test",
      model: { provider: "test", id: "test" } as AgentHarnessAttemptParams["model"],
      messages: [],
      authStorage: {} as AgentHarnessAttemptParams["authStorage"],
      authProfileStore: {} as AgentHarnessAttemptParams["authProfileStore"],
      modelRegistry: {} as AgentHarnessAttemptParams["modelRegistry"],
      thinkLevel: "off",
      sessionFile: "/tmp/s1.jsonl",
      prompt: "hello",
      timeoutMs: 30_000,
      runId: "run-1",
    } as AgentHarnessAttemptParams);

    assert.ok(captured);
    assert.equal(captured!.agentHarnessRuntimeOverride, "openclaw");
    assert.equal(captured!.bootstrapContextMode, "lightweight");
    assert.ok(captured!.extraSystemPrompt?.includes("Tool Restrictions"));
    assert.ok(Array.isArray(captured!.toolsAllow));
  });
});
