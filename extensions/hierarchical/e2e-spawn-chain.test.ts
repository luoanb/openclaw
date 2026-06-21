/**
 * E2E spawn-chain tests — VALIDATION.md §4 scenarios without Gateway.
 *
 * Uses the committed demo-workspace fixture and simulates session spawn chains
 * (spawnedBy + label) exactly as Gateway would after sessions_spawn calls.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildHierarchicalAttemptContext } from "./harness-context.js";
import type { HierarchicalSessionReader } from "./node-path-resolver.js";

const FIXTURE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/demo-workspace",
);

/** Simulates session store after hierarchical spawn chain: root → architect → auditor */
const DEMO_SESSIONS: Record<string, { label?: string; spawnedBy?: string | null }> = {
  "agent:hier:main": {},
  "agent:hier:subagent:arch": {
    spawnedBy: "agent:hier:main",
    label: "architect",
  },
  "agent:hier:subagent:audit": {
    spawnedBy: "agent:hier:subagent:arch",
    label: "security-auditor",
  },
  "agent:hier:subagent:translate": {
    spawnedBy: "agent:hier:subagent:arch",
    label: "doc-translator",
  },
};

function demoSessionReader(): HierarchicalSessionReader {
  return async (sessionKey) => DEMO_SESSIONS[sessionKey];
}

describe("hierarchical E2E spawn chain (VALIDATION §4)", () => {
  it("1. root agent: supplement contains PLS aggregated content", async () => {
    const ctx = await buildHierarchicalAttemptContext({
      workspaceDir: FIXTURE_ROOT,
      sessionKey: "agent:hier:main",
      readSession: demoSessionReader(),
    });

    assert.ok(ctx.supplement.includes("Root Coordinator"));
    assert.ok(ctx.supplement.includes("Never expose credentials"));
    assert.ok(ctx.supplement.includes("<available_agents>"));
    assert.ok(ctx.supplement.includes("architect"));
    assert.equal(ctx.nodeType, "root");
  });

  it("2. child spawn (architect): inherits root + own branch content", async () => {
    const ctx = await buildHierarchicalAttemptContext({
      workspaceDir: FIXTURE_ROOT,
      sessionKey: "agent:hier:subagent:arch",
      readSession: demoSessionReader(),
    });

    assert.ok(ctx.supplement.includes("Root Coordinator"));
    assert.ok(ctx.supplement.includes("Evaluate architecture"));
    assert.ok(ctx.supplement.includes("security-auditor"));
    assert.ok(ctx.supplement.includes("doc-translator"));
    assert.equal(ctx.nodeType, "branch");
  });

  it("3. branch node (architect): exec not in toolsAllow", async () => {
    const ctx = await buildHierarchicalAttemptContext({
      workspaceDir: FIXTURE_ROOT,
      sessionKey: "agent:hier:subagent:arch",
      readSession: demoSessionReader(),
    });

    assert.ok(!ctx.toolsAllow.includes("exec"));
    assert.ok(!ctx.toolsAllow.includes("read"));
    assert.ok(ctx.toolsAllow.includes("sessions_spawn"));
    assert.ok(ctx.supplement.includes("cannot execute"));
  });

  it("4. leaf node (security-auditor): sessions_spawn not in toolsAllow", async () => {
    const ctx = await buildHierarchicalAttemptContext({
      workspaceDir: FIXTURE_ROOT,
      sessionKey: "agent:hier:subagent:audit",
      readSession: demoSessionReader(),
    });

    assert.ok(!ctx.toolsAllow.includes("sessions_spawn"));
    assert.ok(!ctx.toolsAllow.includes("subagents"));
    assert.ok(ctx.toolsAllow.includes("exec"));
    assert.ok(ctx.toolsAllow.includes("read"));
    assert.ok(ctx.supplement.includes("cannot spawn"));
    assert.equal(ctx.nodeType, "leaf");
  });

  it("5. multi-level inherit (grandchild): full root → branch → leaf chain", async () => {
    const ctx = await buildHierarchicalAttemptContext({
      workspaceDir: FIXTURE_ROOT,
      sessionKey: "agent:hier:subagent:audit",
      readSession: demoSessionReader(),
    });

    // Root layer
    assert.ok(ctx.supplement.includes("Root Coordinator"));
    assert.ok(ctx.supplement.includes("Never expose credentials"));
    // Branch layer
    assert.ok(ctx.supplement.includes("Evaluate architecture"));
    assert.ok(ctx.supplement.includes("delegate audits"));
    // Leaf layer
    assert.ok(ctx.supplement.includes("CWE classification"));
    assert.ok(ctx.supplement.includes("Audit code for vulnerabilities"));
    assert.ok(!ctx.supplement.includes("<available_agents>"));
  });

  it("6. sibling leaf (doc-translator) resolves distinct node path", async () => {
    const ctx = await buildHierarchicalAttemptContext({
      workspaceDir: FIXTURE_ROOT,
      sessionKey: "agent:hier:subagent:translate",
      readSession: demoSessionReader(),
    });

    assert.ok(ctx.supplement.includes("Doc Translator"));
    assert.ok(ctx.supplement.includes("Preserve code blocks"));
    assert.ok(!ctx.supplement.includes("CWE classification"));
    assert.equal(ctx.nodeType, "leaf");
  });
});
