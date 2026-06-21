import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, it, before, after } from "node:test";
import {
  childNodeContext,
  resolveHierarchicalNodeContext,
  rootNodeContext,
} from "./node-path-resolver.js";

describe("node-path-resolver", () => {
  let workspaceDir: string;

  before(async () => {
    workspaceDir = await fs.mkdtemp("/tmp/hierarchical-path-");
    await fs.mkdir(path.join(workspaceDir, "hierarchical", "prompt"), {
      recursive: true,
    });
    await fs.mkdir(
      path.join(workspaceDir, "hierarchical", "children", "auditor", "hierarchical", "prompt"),
      { recursive: true },
    );
    await fs.mkdir(
      path.join(
        workspaceDir,
        "hierarchical",
        "children",
        "auditor",
        "hierarchical",
        "children",
        "scanner",
        "hierarchical",
        "prompt",
      ),
      { recursive: true },
    );
  });

  after(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("1. root session resolves to workspace root", async () => {
    const ctx = await resolveHierarchicalNodeContext({ workspaceDir });
    assert.equal(ctx.nodeDir, path.resolve(workspaceDir));
    assert.equal(ctx.nodeRelPath, "");
  });

  it("2. nodeDirOverride wins over session chain", async () => {
    const auditorDir = path.join(workspaceDir, "hierarchical", "children", "auditor");
    const ctx = await resolveHierarchicalNodeContext({
      workspaceDir,
      nodeDirOverride: auditorDir,
    });
    assert.equal(ctx.nodeDir, path.resolve(auditorDir));
    assert.ok(ctx.nodeRelPath.includes("auditor"));
  });

  it("3. childNodeContext builds relative path from root", () => {
    const root = rootNodeContext(workspaceDir);
    const child = childNodeContext(root, "auditor");
    assert.equal(child.nodeDir, path.join(workspaceDir, "hierarchical", "children", "auditor"));
  });

  it("4. spawnedBy chain resolves nested node", async () => {
    const sessions = new Map<string, { label?: string; spawnedBy?: string }>([
      ["agent:main:main", {}],
      ["agent:main:subagent:child1", { spawnedBy: "agent:main:main", label: "auditor" }],
      ["agent:main:subagent:child2", { spawnedBy: "agent:main:subagent:child1", label: "scanner" }],
    ]);

    const ctx = await resolveHierarchicalNodeContext({
      workspaceDir,
      sessionKey: "agent:main:subagent:child2",
      readSession: async (key) => sessions.get(key),
    });

    assert.ok(ctx.nodeDir.endsWith(path.join("auditor", "hierarchical", "children", "scanner")));
  });

  it("5. single-hop fallback without readSession uses params", async () => {
    const ctx = await resolveHierarchicalNodeContext({
      workspaceDir,
      spawnedBy: "agent:main:main",
      label: "auditor",
    });
    assert.equal(ctx.nodeDir, path.join(workspaceDir, "hierarchical", "children", "auditor"));
  });
});
