/**
 * Tests for node-tool-registry.ts — node type detection & tool filtering.
 */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, it, before, after } from "node:test";
import {
  detectNodeType,
  resolveNodeTools,
  formatToolRestrictions,
  listToolNamesForNodeType,
  intersectToolAllowLists,
  type NodeType,
  type ToolDefinition,
} from "./node-tool-registry.js";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("node-tool-registry", () => {
  describe("detectNodeType", () => {
    let root: string;
    let branchDir: string;
    let leafDir: string;

    before(async () => {
      root = await fs.mkdtemp("/tmp/hierarchical-nt-");
      // Root — just root itself (no children/)
      // Branch — has children/
      branchDir = path.join(root, "sub");
      await fs.mkdir(path.join(branchDir, "hierarchical", "children", "leaf"), {
        recursive: true,
      });
      // Leaf — no children/
      leafDir = path.join(branchDir, "hierarchical", "children", "leaf");
    });

    after(async () => {
      await fs.rm(root, { recursive: true, force: true });
    });

    it("1. detects root when agentDir === rootDir", async () => {
      assert.equal(await detectNodeType(root, root), "root");
    });

    it("2. detects branch when children/ exists and is non-empty", async () => {
      assert.equal(await detectNodeType(branchDir, root), "branch");
    });

    it("3. detects leaf when children/ is absent", async () => {
      assert.equal(await detectNodeType(leafDir, root), "leaf");
    });

    it("4. detects leaf when children/ exists but is empty", async () => {
      const emptyBranch = await fs.mkdtemp("/tmp/hierarchical-emptybr-");
      try {
        await fs.mkdir(path.join(emptyBranch, "hierarchical", "children"), { recursive: true });
        // No children actually created inside
        assert.equal(await detectNodeType(emptyBranch, root), "leaf");
      } finally {
        await fs.rm(emptyBranch, { recursive: true, force: true });
      }
    });
  });

  describe("resolveNodeTools", () => {
    // Build a comprehensive tool list
    const ALL_TOOLS: ToolDefinition[] = [
      // dispatch (6)
      { name: "sessions_spawn" },
      { name: "sessions_yield" },
      { name: "subagents" },
      { name: "sessions_list" },
      { name: "sessions_history" },
      { name: "sessions_send" },
      // execution (13)
      { name: "read" },
      { name: "write" },
      { name: "edit" },
      { name: "apply_patch" },
      { name: "grep" },
      { name: "find" },
      { name: "ls" },
      { name: "exec" },
      { name: "process" },
      { name: "web_search" },
      { name: "web_fetch" },
      { name: "browser" },
      { name: "canvas" },
      { name: "nodes" },
      { name: "image" },
      { name: "image_generate" },
      { name: "message" },
      // query (2)
      { name: "session_status" },
      { name: "agents_list" },
      // system (3)
      { name: "gateway" },
      { name: "cron" },
      { name: "skill_workshop" },
    ];

    it("5. root gets all tools", () => {
      const tools = resolveNodeTools("root", ALL_TOOLS);
      assert.equal(tools.length, ALL_TOOLS.length);
    });

    it("6. branch gets dispatch (6) + query (2) = 8 tools", () => {
      const tools = resolveNodeTools("branch", ALL_TOOLS);
      const names = tools.map((t) => t.name);
      assert.equal(tools.length, 8, `got ${tools.length} tools: ${names.join(", ")}`);

      // Should have dispatch tools
      assert.ok(names.includes("sessions_spawn"));
      assert.ok(names.includes("sessions_yield"));
      assert.ok(names.includes("subagents"));

      // Should have query tools
      assert.ok(names.includes("session_status"));

      // Should NOT have execution tools
      assert.ok(!names.includes("read"));
      assert.ok(!names.includes("exec"));
      assert.ok(!names.includes("web_search"));

      // Should NOT have system tools
      assert.ok(!names.includes("gateway"));
      assert.ok(!names.includes("cron"));
    });

    it("7. leaf gets execution (17) + query (2) = 19 tools", () => {
      const tools = resolveNodeTools("leaf", ALL_TOOLS);
      const names = tools.map((t) => t.name);
      assert.equal(tools.length, 19, `got ${tools.length} tools: ${names.join(", ")}`);

      // Should have execution tools
      assert.ok(names.includes("read"));
      assert.ok(names.includes("exec"));
      assert.ok(names.includes("web_search"));

      // Should have query tools
      assert.ok(names.includes("session_status"));

      // Should NOT have dispatch tools
      assert.ok(!names.includes("sessions_spawn"));
      assert.ok(!names.includes("sessions_yield"));

      // Should NOT have system tools
      assert.ok(!names.includes("gateway"));
      assert.ok(!names.includes("cron"));
    });

    it("8. unknown tool names are excluded", () => {
      const tools = resolveNodeTools("root", [
        ...ALL_TOOLS,
        { name: "custom_future_tool" },
        { name: "some_unknown_thing" },
      ]);
      const names = tools.map((t) => t.name);
      assert.ok(!names.includes("custom_future_tool"));
      assert.ok(!names.includes("some_unknown_thing"));
    });

    it("9. listToolNamesForNodeType matches resolveNodeTools names", () => {
      const listed = listToolNamesForNodeType("branch");
      const resolved = resolveNodeTools("branch", ALL_TOOLS)
        .map((t) => t.name)
        .sort();
      assert.deepEqual(listed, resolved);
    });

    it("10. intersectToolAllowLists keeps only NTS-allowed tools", () => {
      const nts = listToolNamesForNodeType("leaf");
      const intersected = intersectToolAllowLists(nts, ["exec", "sessions_spawn", "read"]);
      assert.deepEqual(intersected.sort(), ["exec", "read"]);
    });
  });

  describe("formatToolRestrictions", () => {
    it("root hint mentions 'root agent'", () => {
      const hint = formatToolRestrictions("root");
      assert.ok(hint.includes("root agent"));
      assert.ok(hint.includes("All tools"));
    });

    it("branch hint mentions 'branch agent' and no actions", () => {
      const hint = formatToolRestrictions("branch");
      assert.ok(hint.includes("branch agent"));
      assert.ok(hint.includes("cannot execute"));
    });

    it("leaf hint mentions 'leaf agent' and no spawn", () => {
      const hint = formatToolRestrictions("leaf");
      assert.ok(hint.includes("leaf agent"));
      assert.ok(hint.includes("cannot spawn"));
    });
  });
});
