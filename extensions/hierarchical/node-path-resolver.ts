/**
 * Resolves hierarchical node directories from workspace layout and session spawn chain.
 *
 * OpenClaw `agentDir` (state/auth) is NOT used here. PLS/NTS consume `nodeDir`:
 * the workspace-relative directory that owns `hierarchical/prompt/` and
 * `hierarchical/children/` for this tree node.
 *
 * Spawn routing (see README.md):
 * - Root: nodeDir = workspace root
 * - Child: walk spawnedBy chain; each session's `label` = nodeId under parent's children/
 */

import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal session fields needed to resolve the spawn chain. */
export type HierarchicalSessionSnapshot = {
  label?: string;
  spawnedBy?: string | null;
};

export type HierarchicalSessionReader = (
  sessionKey: string,
) => Promise<HierarchicalSessionSnapshot | undefined>;

/** Resolved node location inside the workspace tree. */
export type HierarchicalNodeContext = {
  /** Absolute workspace root (contains `hierarchical/` for the root agent). */
  workspaceRoot: string;
  /** Absolute path to this node's directory (parent of its `hierarchical/` folder). */
  nodeDir: string;
  /** Relative path from workspaceRoot; empty string for root. */
  nodeRelPath: string;
};

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export function resolveWorkspaceRoot(workspaceDir: string): string {
  return path.resolve(workspaceDir);
}

export function rootNodeContext(workspaceRoot: string): HierarchicalNodeContext {
  const root = path.resolve(workspaceRoot);
  return { workspaceRoot: root, nodeDir: root, nodeRelPath: "" };
}

/** Append one hierarchical child segment under an already-resolved parent node. */
export function childNodeContext(
  parent: HierarchicalNodeContext,
  childId: string,
): HierarchicalNodeContext {
  const id = childId.trim();
  if (!id) {
    return parent;
  }
  const nodeRelPath = parent.nodeRelPath
    ? path.join(parent.nodeRelPath, "hierarchical", "children", id)
    : path.join("hierarchical", "children", id);
  return {
    workspaceRoot: parent.workspaceRoot,
    nodeDir: path.join(parent.workspaceRoot, nodeRelPath),
    nodeRelPath,
  };
}

/**
 * Resolve the hierarchical node for the current session.
 *
 * When `nodeDirOverride` is set (tests), it wins over session chain resolution.
 */
export async function resolveHierarchicalNodeContext(params: {
  workspaceDir: string;
  sessionKey?: string;
  spawnedBy?: string | null;
  label?: string;
  nodeDirOverride?: string;
  readSession?: HierarchicalSessionReader;
  /** Prevents infinite loops on corrupted spawn chains. */
  maxDepth?: number;
}): Promise<HierarchicalNodeContext> {
  const workspaceRoot = resolveWorkspaceRoot(params.workspaceDir);

  if (params.nodeDirOverride?.trim()) {
    const nodeDir = path.resolve(params.nodeDirOverride);
    const nodeRelPath = nodeDir.startsWith(workspaceRoot + path.sep)
      ? path.relative(workspaceRoot, nodeDir)
      : "";
    return { workspaceRoot, nodeDir, nodeRelPath };
  }

  if (!params.spawnedBy && !params.sessionKey) {
    return rootNodeContext(workspaceRoot);
  }

  const readSession = params.readSession;
  const maxDepth = params.maxDepth ?? 32;

  async function walk(sessionKey: string, depth: number): Promise<HierarchicalNodeContext> {
    if (depth > maxDepth) {
      return rootNodeContext(workspaceRoot);
    }

    const entry = readSession ? await readSession(sessionKey) : undefined;
    const spawnedBy = entry?.spawnedBy ?? (depth === 0 ? params.spawnedBy : undefined);

    if (!spawnedBy) {
      return rootNodeContext(workspaceRoot);
    }

    const parent = await walk(spawnedBy, depth + 1);
    const label = (entry?.label ?? (depth === 0 ? params.label : undefined))?.trim();
    if (!label) {
      return parent;
    }
    return childNodeContext(parent, label);
  }

  if (params.sessionKey && readSession) {
    return walk(params.sessionKey, 0);
  }

  // Fallback when session reader is unavailable: single-hop from params only.
  if (params.spawnedBy && params.label?.trim()) {
    return childNodeContext(rootNodeContext(workspaceRoot), params.label.trim());
  }

  return rootNodeContext(workspaceRoot);
}
