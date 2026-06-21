/**
 * Entry point for the hierarchical agent extension.
 *
 * Registers the "hierarchical" AgentHarness so that sessions configured with
 * `agentRuntime: { id: "hierarchical" }` are executed by this harness.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createHierarchicalHarness } from "./harness.js";
import type { HierarchicalSessionReader } from "./node-path-resolver.js";

function createSessionReader(runtime: {
  agent: {
    session: {
      getSessionEntry: (scope: {
        sessionKey: string;
      }) => { label?: string; spawnedBy?: string } | undefined;
    };
  };
}): HierarchicalSessionReader {
  return async (sessionKey) => {
    const entry = runtime.agent.session.getSessionEntry({ sessionKey });
    if (!entry) {
      return undefined;
    }
    return {
      label: entry.label,
      spawnedBy: entry.spawnedBy,
    };
  };
}

export default definePluginEntry({
  id: "hierarchical",
  name: "Hierarchical Agent",
  description:
    "Tree-hierarchy agent harness with inherited prompts (PLS) and node-type tool isolation (NTS).",

  register(api) {
    api.registerAgentHarness(
      createHierarchicalHarness({
        readSession: createSessionReader(api.runtime),
      }),
    );
  },
});
