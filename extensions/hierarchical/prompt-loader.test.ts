/**
 * Tests for prompt-loader.ts — PLS directory-tree aggregation.
 *
 * Uses node:test + node:assert + fs.mkdtemp for isolated tmpdirs.
 */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, it, before, after } from "node:test";
import { loadAgentPrompt, type PromptLoadResult } from "./prompt-loader.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function mkdirs(...parts: string[]): Promise<string> {
  const p = path.join(...parts);
  await fs.mkdir(p, { recursive: true });
  return p;
}

async function write(p: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, "utf-8");
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("prompt-loader", () => {
  let root: string;
  let branchDir: string;
  let leafDir: string;

  before(async () => {
    root = await fs.mkdtemp("/tmp/hierarchical-test-");
    const rootPrompt = await mkdirs(root, "hierarchical", "prompt");

    // Root: 10-core.md, 20-safety.md
    await write(path.join(rootPrompt, "10-core.md"), "I am the root agent.");
    await write(path.join(rootPrompt, "20-safety.md"), "Always obey safety rules.");

    // Branch: children/auditor/
    branchDir = await mkdirs(root, "hierarchical", "children", "auditor");
    const branchPrompt = await mkdirs(branchDir, "hierarchical", "prompt");
    await write(path.join(branchPrompt, "25-agents.md"), "I am the auditor agent.");

    // Leaf: children/auditor/children/scanner/
    leafDir = await mkdirs(branchDir, "hierarchical", "children", "scanner");
    const leafPrompt = await mkdirs(leafDir, "hierarchical", "prompt");
    await write(path.join(leafPrompt, "25-agents.md"), "I am the scanner agent.");
    await write(path.join(leafPrompt, "15-scope.md"), "I only scan for vulnerabilities.");
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  // ---- Test cases ----

  it("1. returns empty result for agent without prompt/ dirs", async () => {
    const emptyDir = await fs.mkdtemp("/tmp/hierarchical-empty-");
    try {
      const result = await loadAgentPrompt(emptyDir, emptyDir);
      assert.equal(result.content, "");
      assert.equal(result.slots.length, 0);
      assert.equal(result.layers.length, 0);
      assert.equal(result.truncated, false);
    } finally {
      await fs.rm(emptyDir, { recursive: true, force: true });
    }
  });

  it("2. root agent picks up all root prompt files", async () => {
    const result = await loadAgentPrompt(root, root);
    assert.ok(result.content.includes("I am the root agent."));
    assert.ok(result.content.includes("Always obey safety rules."));
    assert.equal(result.slots.length, 2);
    assert.equal(result.layers.length, 1);
    assert.equal(result.truncated, false);
  });

  it("3. child overrides parent slot (25-agents.md)", async () => {
    const result = await loadAgentPrompt(root, branchDir);
    // Branch has 25-agents.md which overrides... there's no parent 25-agents.md
    // But it should still have root's 10-core.md and 20-safety.md
    assert.ok(result.content.includes("I am the root agent."));
    assert.ok(result.content.includes("Always obey safety rules."));
    assert.ok(result.content.includes("I am the auditor agent."));
    assert.equal(result.slots.length, 3);
  });

  it("4. leaf adds non-overlapping slot (15-scope.md)", async () => {
    const result = await loadAgentPrompt(root, leafDir);
    // Leaf should have: 10-core(root) + 20-safety(root) + 25-agents(leaf) + 15-scope(leaf)
    assert.ok(result.content.includes("I am the root agent."));
    assert.ok(result.content.includes("Always obey safety rules."));
    assert.ok(result.content.includes("I am the scanner agent."));
    assert.ok(result.content.includes("I only scan for vulnerabilities."));
    // 25-agents from leaf overrides branch's 25-agents
    assert.ok(!result.content.includes("I am the auditor agent."));
    assert.equal(result.slots.length, 4);
  });

  it("5. three-level hierarchy merges correctly", async () => {
    const result = await loadAgentPrompt(root, leafDir);
    assert.equal(result.layers.length, 3); // root + auditor + scanner (no-prompt dirs skipped)
    assert.equal(result.slots.length, 4);
  });

  it("6. maxChars truncation works", async () => {
    const result = await loadAgentPrompt(root, root, { maxChars: 5 });
    assert.ok(result.content.length <= 50);
    assert.equal(result.truncated, true);
  });

  it("7. returns empty for nonexistent directories", async () => {
    const result = await loadAgentPrompt("/nonexistent", "/nonexistent");
    assert.equal(result.content, "");
    assert.equal(result.slots.length, 0);
  });

  it("8. skipSlots excludes named slots", async () => {
    const result = await loadAgentPrompt(root, root, {
      skipSlots: ["20-safety.md"],
    });
    assert.ok(result.content.includes("I am the root agent."));
    assert.ok(!result.content.includes("Always obey safety rules."));
    assert.equal(result.slots.length, 1);
  });
});
