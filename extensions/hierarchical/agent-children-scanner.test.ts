/**
 * Tests for agent-children-scanner.ts — frontmatter parsing & children discovery.
 */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, it, before, after } from "node:test";
import {
  scanAgentChildren,
  formatChildrenList,
  type AgentChildEntry,
} from "./agent-children-scanner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function write(p: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, "utf-8");
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("agent-children-scanner", () => {
  let root: string;

  before(async () => {
    root = await fs.mkdtemp("/tmp/hierarchical-children-test-");

    // Setup: root with 3 children
    const childrenDir = path.join(root, "hierarchical", "children");
    await fs.mkdir(childrenDir, { recursive: true });

    // Child 1: auditor — has frontmatter + own children
    const auditorPrompt = path.join(childrenDir, "auditor", "hierarchical", "prompt");
    await fs.mkdir(auditorPrompt, { recursive: true });
    await write(
      path.join(auditorPrompt, "20-agents.md"),
      `---\nname: security-auditor\ndescription: 代码安全审计\n---\n\n# Security Auditor`,
    );
    // Give auditor its own child
    await fs.mkdir(path.join(childrenDir, "auditor", "hierarchical", "children", "sub"), {
      recursive: true,
    });

    // Child 2: translator — no children, no frontmatter
    await fs.mkdir(path.join(childrenDir, "translator", "hierarchical", "prompt"), {
      recursive: true,
    });
    await write(
      path.join(childrenDir, "translator", "hierarchical", "prompt", "10-todo.md"),
      "Just translate stuff.",
    );

    // Child 3: architect — frontmatter but no children
    const archPrompt = path.join(childrenDir, "architect", "hierarchical", "prompt");
    await fs.mkdir(archPrompt, { recursive: true });
    await write(
      path.join(archPrompt, "20-agents.md"),
      `---\nname: architect\ndescription: 方案架构设计\n---\n\n# Architect`,
    );

    // Child 4: empty-dir — empty children dir
    await fs.mkdir(path.join(childrenDir, "empty-dir"), { recursive: true });

    // Nested child (for child-children discovery)
    await fs.mkdir(path.join(childrenDir, "nested", "hierarchical", "prompt"), { recursive: true });
    await write(
      path.join(childrenDir, "nested", "hierarchical", "prompt", "20-agents.md"),
      `---\nname: nested-agent\ndescription: A nested agent\n---\n\n# Nested`,
    );
    await fs.mkdir(path.join(childrenDir, "nested", "hierarchical", "children", "deep"), {
      recursive: true,
    });
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  // ---- Test cases ----

  it("1. returns empty when children/ does not exist", async () => {
    const noChildren = await fs.mkdtemp("/tmp/hierarchical-nochild-");
    try {
      const entries = await scanAgentChildren(noChildren);
      assert.deepEqual(entries, []);
    } finally {
      await fs.rm(noChildren, { recursive: true, force: true });
    }
  });

  it("2. discovers child with frontmatter", async () => {
    const entries = await scanAgentChildren(root);
    const auditor = entries.find((e) => e.agentId === "auditor");
    assert.ok(auditor, "auditor should be found");
    assert.equal(auditor?.name, "security-auditor");
    assert.equal(auditor?.description, "代码安全审计");
  });

  it("3. discovers three children with frontmatter", async () => {
    const entries = await scanAgentChildren(root);
    // auditor, architect, nested all have frontmatter; translator & empty-dir don't
    assert.equal(entries.length, 3);
  });

  it("4. child without frontmatter is skipped", async () => {
    const entries = await scanAgentChildren(root);
    const translator = entries.find((e) => e.agentId === "translator");
    assert.equal(translator, undefined);
  });

  it("5. empty children/ returns empty", async () => {
    const emptyParent = await fs.mkdtemp("/tmp/hierarchical-empty-child-");
    try {
      await fs.mkdir(path.join(emptyParent, "hierarchical", "children"), {
        recursive: true,
      });
      const entries = await scanAgentChildren(emptyParent);
      assert.deepEqual(entries, []);
    } finally {
      await fs.rm(emptyParent, { recursive: true, force: true });
    }
  });

  it("6. hasChildren is true when child has own children", async () => {
    const entries = await scanAgentChildren(root);
    const auditor = entries.find((e) => e.agentId === "auditor");
    assert.equal(auditor?.hasChildren, true);
    const nested = entries.find((e) => e.agentId === "nested");
    assert.equal(nested?.hasChildren, true);
  });

  it("7. hasChildren is false when child has no children", async () => {
    const entries = await scanAgentChildren(root);
    const architect = entries.find((e) => e.agentId === "architect");
    assert.equal(architect?.hasChildren, false);
  });

  it("8. formatChildrenList produces valid XML block", async () => {
    const entries: AgentChildEntry[] = [
      {
        agentId: "auditor",
        name: "security-auditor",
        description: "代码安全审计",
        hasChildren: true,
      },
      {
        agentId: "architect",
        name: "architect",
        description: "方案架构设计",
        hasChildren: false,
      },
    ];
    const xml = formatChildrenList(entries);
    assert.ok(xml.includes("<available_agents>"));
    assert.ok(xml.includes("</available_agents>"));
    assert.ok(xml.includes("<name>security-auditor</name>"));
    assert.ok(xml.includes("<name>architect</name>"));
    assert.ok(xml.includes("代码安全审计"));
    assert.ok(xml.includes("方案架构设计"));
    assert.ok(xml.includes("<location>children/auditor/</location>"));
    assert.ok(xml.includes('label: "<nodeId>"'));
  });

  it("9. empty list produces empty string", async () => {
    assert.equal(formatChildrenList([]), "");
  });
});
