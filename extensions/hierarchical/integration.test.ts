/**
 * Integration test for hierarchical prompt assembly (harness-context).
 *
 * Validates PLS → agent-children-scanner → NTS → path resolution.
 * Does NOT start Gateway or call the embedded model runner.
 */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, it, before, after } from "node:test";
import { buildHierarchicalAttemptContext } from "./harness-context.js";
import { listToolNamesForNodeType } from "./node-tool-registry.js";

let workspaceDir: string;
let rootDir: string;
let branchDir: string;
let leafDir: string;

async function write(p: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, "utf-8");
}

describe("hierarchical harness context integration", () => {
  before(async () => {
    workspaceDir = await fs.mkdtemp("/tmp/hierarchical-intg-");
    rootDir = workspaceDir;

    const rootPrompt = path.join(rootDir, "hierarchical", "prompt");
    await write(
      path.join(rootPrompt, "10-core.md"),
      "I am the root agent.\n\nMy purpose is to coordinate work.",
    );
    await write(
      path.join(rootPrompt, "20-rules.md"),
      "Follow security rules.\nNever expose secrets.",
    );

    branchDir = path.join(rootDir, "hierarchical", "children", "auditor");
    const branchPrompt = path.join(branchDir, "hierarchical", "prompt");
    await write(
      path.join(branchPrompt, "25-agents.md"),
      [
        "---",
        "name: security-auditor",
        "description: Conduct security audits",
        "---",
        "",
        "# Security Auditor",
        "",
        "Audit all code for security vulnerabilities.",
      ].join("\n"),
    );
    await fs.mkdir(path.join(branchDir, "hierarchical", "children"), {
      recursive: true,
    });

    leafDir = path.join(branchDir, "hierarchical", "children", "scanner");
    const leafPrompt = path.join(leafDir, "hierarchical", "prompt");
    await write(
      path.join(leafPrompt, "30-scanner.md"),
      [
        "---",
        "name: vulnerability-scanner",
        "description: Deep vulnerability scan",
        "---",
        "",
        "Perform deep scans for known CVEs.",
      ].join("\n"),
    );
  });

  after(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("1. root: PLS aggregates prompt files", async () => {
    const ctx = await buildHierarchicalAttemptContext({
      workspaceDir,
      nodeDirOverride: rootDir,
    });
    assert.ok(ctx.supplement.includes("I am the root agent."));
    assert.ok(ctx.supplement.includes("Follow security rules."));
  });

  it("2. root: includes <available_agents> with location", async () => {
    const ctx = await buildHierarchicalAttemptContext({
      workspaceDir,
      nodeDirOverride: rootDir,
    });
    assert.ok(ctx.supplement.includes("<available_agents>"));
    assert.ok(ctx.supplement.includes("security-auditor"));
    assert.ok(ctx.supplement.includes("<location>children/auditor/</location>"));
  });

  it("3. root: toolsAllow includes dispatch and execution", async () => {
    const ctx = await buildHierarchicalAttemptContext({
      workspaceDir,
      nodeDirOverride: rootDir,
    });
    assert.ok(ctx.toolsAllow.includes("sessions_spawn"));
    assert.ok(ctx.toolsAllow.includes("exec"));
    assert.equal(ctx.toolsAllow.length, listToolNamesForNodeType("root").length);
  });

  it("4. branch: inherits root content", async () => {
    const ctx = await buildHierarchicalAttemptContext({
      workspaceDir,
      nodeDirOverride: branchDir,
    });
    assert.ok(ctx.supplement.includes("I am the root agent."));
    assert.ok(ctx.supplement.includes("Audit all code"));
  });

  it("5. branch: cannot execute — no exec in toolsAllow", async () => {
    const ctx = await buildHierarchicalAttemptContext({
      workspaceDir,
      nodeDirOverride: branchDir,
    });
    assert.ok(ctx.supplement.includes("cannot execute"));
    assert.ok(!ctx.toolsAllow.includes("exec"));
    assert.ok(ctx.toolsAllow.includes("sessions_spawn"));
  });

  it("6. branch: lists scanner child", async () => {
    const ctx = await buildHierarchicalAttemptContext({
      workspaceDir,
      nodeDirOverride: branchDir,
    });
    assert.ok(ctx.supplement.includes("vulnerability-scanner"));
  });

  it("7. leaf: inherits full chain", async () => {
    const ctx = await buildHierarchicalAttemptContext({
      workspaceDir,
      nodeDirOverride: leafDir,
    });
    assert.ok(ctx.supplement.includes("I am the root agent."));
    assert.ok(ctx.supplement.includes("Conduct security audits"));
    assert.ok(ctx.supplement.includes("Deep vulnerability scan"));
  });

  it("8. leaf: cannot spawn — no sessions_spawn in toolsAllow", async () => {
    const ctx = await buildHierarchicalAttemptContext({
      workspaceDir,
      nodeDirOverride: leafDir,
    });
    assert.ok(ctx.supplement.includes("cannot spawn"));
    assert.ok(!ctx.toolsAllow.includes("sessions_spawn"));
    assert.ok(ctx.toolsAllow.includes("exec"));
  });

  it("9. leaf: no <available_agents> block", async () => {
    const ctx = await buildHierarchicalAttemptContext({
      workspaceDir,
      nodeDirOverride: leafDir,
    });
    assert.ok(!ctx.supplement.includes("<available_agents>"));
  });

  it("10. toolsAllow intersects with existing allow-list", async () => {
    const ctx = await buildHierarchicalAttemptContext({
      workspaceDir,
      nodeDirOverride: leafDir,
      toolsAllow: ["exec", "sessions_spawn", "read"],
    });
    assert.deepEqual(ctx.toolsAllow.sort(), ["exec", "read"]);
  });
});
