/**
 * NTS — Node Tool Set for hierarchical agent harness.
 *
 * Detects the node type (root / branch / leaf) from the filesystem layout and
 * returns the appropriate tool subset.
 *
 * Tool-to-group mappings are hardcoded here and deliberately *not* coupled to
 * the framework's `tool-catalog.ts`.  Groups follow the requirements doc:
 *
 *   dispatch  → sessions_spawn, sessions_yield, subagents, ...
 *   execution → read, write, edit, exec, web_search, ...
 *   query     → session_status, agents_list
 *   system    → gateway, cron, skill_workshop
 *
 * | Type   | dispatch | execution | query | system |
 * |--------|----------|-----------|-------|--------|
 * | root   | ✅       | ✅        | ✅    | ✅     |
 * | branch | ✅       | ❌        | ✅    | ❌     |
 * | leaf   | ❌       | ✅        | ✅    | ❌     |
 */

import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NodeType = "root" | "branch" | "leaf";

export type ToolDefinition = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Group definitions
// ---------------------------------------------------------------------------

export type NodeToolGroup = "dispatch" | "execution" | "query" | "system";

/** Node type → allowed groups */
const NODE_TYPE_GROUPS: Record<NodeType, readonly NodeToolGroup[]> = {
  root: ["dispatch", "execution", "query", "system"],
  branch: ["dispatch", "query"],
  leaf: ["execution", "query"],
};

// ---------------------------------------------------------------------------
// Tool-to-group mapping
// ---------------------------------------------------------------------------

const TOOL_GROUP_MAP: Record<string, NodeToolGroup> = {
  // dispatch (choice)
  sessions_spawn: "dispatch",
  sessions_yield: "dispatch",
  subagents: "dispatch",
  sessions_list: "dispatch",
  sessions_history: "dispatch",
  sessions_send: "dispatch",
  // execution (action)
  read: "execution",
  write: "execution",
  edit: "execution",
  apply_patch: "execution",
  grep: "execution",
  find: "execution",
  ls: "execution",
  exec: "execution",
  process: "execution",
  web_search: "execution",
  web_fetch: "execution",
  browser: "execution",
  canvas: "execution",
  nodes: "execution",
  image: "execution",
  image_generate: "execution",
  message: "execution",
  // query (read-only)
  session_status: "query",
  agents_list: "query",
  // system (admin)
  gateway: "system",
  cron: "system",
  skill_workshop: "system",
};

function toolGroup(name: string): NodeToolGroup | undefined {
  return TOOL_GROUP_MAP[name];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function existsDir(p: string): Promise<boolean> {
  const { promises: fs } = await import("node:fs");
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Detect node type from the filesystem.
 * - `root`   == agentDir equals rootDir
 * - `branch` == non-root and has non-empty `hierarchical/children/`
 * - `leaf`   == everything else
 */
export async function detectNodeType(agentDir: string, rootDir: string): Promise<NodeType> {
  if (path.resolve(agentDir) === path.resolve(rootDir)) return "root";

  const childrenDir = path.join(agentDir, "hierarchical", "children");
  if (await existsDir(childrenDir)) {
    const { promises: fs } = await import("node:fs");
    try {
      const entries = await fs.readdir(childrenDir);
      if (entries.some((e) => e !== ".DS_Store" && !e.startsWith("."))) {
        return "branch";
      }
    } catch {
      // fall through to leaf
    }
  }

  return "leaf";
}

/**
 * Filter a list of system-level tool definitions down to the subset allowed
 * for the given node type.
 */
export function resolveNodeTools(nodeType: NodeType, tools: ToolDefinition[]): ToolDefinition[] {
  const allowedGroups = NODE_TYPE_GROUPS[nodeType];
  return tools.filter((t) => {
    const g = toolGroup(t.name);
    return g !== undefined && allowedGroups.includes(g);
  });
}

/** All tool names allowed for a node type (for toolsAllow hard filtering). */
export function listToolNamesForNodeType(nodeType: NodeType): string[] {
  const allowedGroups = NODE_TYPE_GROUPS[nodeType];
  return Object.entries(TOOL_GROUP_MAP)
    .filter(([, group]) => allowedGroups.includes(group))
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));
}

/** Intersect NTS allow-list with any existing toolsAllow from config/policy. */
export function intersectToolAllowLists(
  ntsAllow: readonly string[],
  existing?: readonly string[] | null,
): string[] {
  if (!existing?.length) {
    return [...ntsAllow];
  }
  const allowed = new Set(ntsAllow);
  return existing.filter((name) => allowed.has(name));
}

/** Human-readable explanation of tool restrictions for the system prompt. */
export function formatToolRestrictions(nodeType: NodeType): string {
  switch (nodeType) {
    case "root":
      return "You are the root agent. All tools are available.";
    case "branch":
      return (
        "You are a branch agent (manager). You may dispatch work to " +
        "sub-agents and query status, but you cannot execute actions " +
        "(read/write/exec/…) yourself."
      );
    case "leaf":
      return (
        "You are a leaf agent (worker). You may execute actions and " +
        "query status, but you cannot spawn new sub-agents."
      );
  }
}
