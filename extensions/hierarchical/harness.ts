/**
 * Hierarchical agent harness — AgentHarness implementation.
 *
 * Architecture (two layers, one turn):
 *   1. Outer runAttempt — preprocessor only: node path, PLS, NTS, supplement.
 *   2. delegateRunAttempt → runOpenClawEmbeddedAttempt — native model/tool loop.
 *
 * Does not hook or replace core sessions_spawn. Spawn writes label/spawnedBy;
 * this harness reads them on each turn via readSession + node-path-resolver.
 *
 * delegateRunAttempt passes:
 *   - extraSystemPrompt / toolsAllow — already enriched by buildHierarchicalAttemptContext
 *   - agentHarnessRuntimeOverride: "openclaw" — inner run must not re-enter hierarchical
 *
 * Registration: api.registerAgentHarness(createHierarchicalHarness(deps))
 * Overview: extensions/hierarchical/README.md
 */

import type {
  AgentHarness,
  AgentHarnessSupportContext,
  AgentHarnessSupport,
  AgentHarnessAttemptParams,
  AgentHarnessAttemptResult,
  AgentHarnessSideQuestionParams,
  AgentHarnessSideQuestionResult,
  AgentHarnessCompactParams,
  AgentHarnessCompactResult,
  AgentHarnessResetParams,
} from "openclaw/plugin-sdk/agent-harness-runtime";
import { buildHierarchicalAttemptContext } from "./harness-context.js";
import type { HierarchicalSessionReader } from "./node-path-resolver.js";

async function defaultDelegateRunAttempt(
  params: AgentHarnessAttemptParams,
): Promise<AgentHarnessAttemptResult> {
  const mod = (await import("openclaw/plugin-sdk/agent-harness-runtime")) as {
    runOpenClawEmbeddedAttempt?: (
      p: AgentHarnessAttemptParams,
    ) => Promise<AgentHarnessAttemptResult>;
  };
  if (!mod.runOpenClawEmbeddedAttempt) {
    throw new Error(
      "runOpenClawEmbeddedAttempt is not exported; rebuild OpenClaw after upgrading hierarchical plugin",
    );
  }
  return mod.runOpenClawEmbeddedAttempt(params);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HierarchicalHarnessDeps = {
  /** Load session label/spawnedBy for node-path resolution. */
  readSession?: HierarchicalSessionReader;
  /**
   * Delegate run attempt (defaults to OpenClaw embedded runner).
   * Tests inject a mock here.
   */
  delegateRunAttempt?: (params: AgentHarnessAttemptParams) => Promise<AgentHarnessAttemptResult>;
};

// ---------------------------------------------------------------------------
// Harness factory
// ---------------------------------------------------------------------------

export function createHierarchicalHarness(deps: HierarchicalHarnessDeps = {}): AgentHarness {
  const delegateRunAttempt = deps.delegateRunAttempt ?? defaultDelegateRunAttempt;

  return {
    id: "hierarchical",
    label: "Hierarchical agent harness",
    contextEngineHostCapabilities: [
      "bootstrap",
      "assemble-before-prompt",
      "after-turn",
      "maintain",
    ],

    supports(ctx: AgentHarnessSupportContext): AgentHarnessSupport {
      if (ctx.requestedRuntime === "hierarchical") {
        return { supported: true, priority: 100 };
      }
      return { supported: false };
    },

    runAttempt: async (params: AgentHarnessAttemptParams): Promise<AgentHarnessAttemptResult> => {
      try {
        const ctx = await buildHierarchicalAttemptContext({
          workspaceDir: params.workspaceDir,
          sessionKey: params.sessionKey,
          spawnedBy: params.spawnedBy,
          readSession: deps.readSession,
          toolsAllow: params.toolsAllow,
          extraSystemPrompt: params.extraSystemPrompt,
        });

        // Inner layer: native embedded runner consumes enriched prompt/tools only.
        const delegated = await delegateRunAttempt({
          ...params,
          agentHarnessRuntimeOverride: "openclaw",
          extraSystemPrompt: ctx.extraSystemPrompt,
          toolsAllow: ctx.toolsAllow,
          bootstrapContextMode: params.bootstrapContextMode ?? "lightweight",
        });

        return {
          ...delegated,
          agentHarnessId: "hierarchical",
        };
      } catch (err) {
        return buildErrorAttemptResult(params.sessionId, err);
      }
    },

    runSideQuestion: async (
      _params: AgentHarnessSideQuestionParams,
    ): Promise<AgentHarnessSideQuestionResult> => {
      return { text: "Side questions are not supported in this harness." };
    },

    compact: async (
      _params: AgentHarnessCompactParams,
    ): Promise<AgentHarnessCompactResult | undefined> => {
      return undefined;
    },

    reset(_params: AgentHarnessResetParams): void {
      /* no special cleanup needed */
    },

    dispose(): void {
      /* no special cleanup needed */
    },
  };
}

// ---------------------------------------------------------------------------
// Result builders
// ---------------------------------------------------------------------------

function buildErrorAttemptResult(sessionId: string, error: unknown): AgentHarnessAttemptResult {
  return {
    aborted: false,
    externalAbort: false,
    timedOut: false,
    idleTimedOut: false,
    timedOutDuringCompaction: false,
    promptError: error,
    promptErrorSource: "prompt",
    sessionIdUsed: sessionId,
    messagesSnapshot: [],
    assistantTexts: [],
    toolMetas: [],
    lastAssistant: undefined,
    didSendViaMessagingTool: false,
    messagingToolSentTexts: [],
    messagingToolSentMediaUrls: [],
    messagingToolSentTargets: [],
    cloudCodeAssistFormatError: false,
    replayMetadata: {
      mode: "bypass",
    },
    itemLifecycle: {
      interactionId: "",
      runId: "",
      sessionId,
    },
    setTerminalLifecycleMeta: () => {},
  } as unknown as AgentHarnessAttemptResult;
}
