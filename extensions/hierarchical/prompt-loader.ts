/**
 * PLS — Prompt Loading Service for hierarchical agent harness.
 *
 * Walks up from the current agent directory to the workspace root, collecting
 * all `prompt/` files along the way, then merges them by slot name (child
 * layer overwrites parent layer for the same slot).
 *
 * The root prompt directory is `<workspace>/hierarchical/prompt/`.
 * Each nested agent has its own `<agentDir>/hierarchical/prompt/`.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One prompt-file slot */
export type PromptSlot = {
  /** Full filename, e.g. "10-soul.md" */
  slot: string;
  /** File contents */
  content: string;
  /** Absolute path of the directory that contributed this slot (debugging) */
  sourceLayer: string;
  /** Sort key === slot, for stable ordering */
  sortKey: string;
};

/** Final merge result */
export type PromptLoadResult = {
  /** Concatenated prompt text, slots sorted by filename */
  content: string;
  /** All resolved slots (after child-over-parent merge) */
  slots: PromptSlot[];
  /** Directories that contributed slots, root-first */
  layers: string[];
  /** True when the output was truncated due to maxChars */
  truncated: boolean;
};

export type PromptLoaderOptions = {
  /** Hard character limit on the merged output */
  maxChars?: number;
  /** Skip certain slot names entirely (exact match) */
  skipSlots?: string[];
};

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Load and merge prompt files from the agent directory up to the workspace
 * root.  Each directory `{agentDir}/hierarchical/prompt/` contributes its
 * `.md` files as slots; identical slot names from child layers overwrite
 * parent layers.  The final list is sorted by slot name.
 */
export async function loadAgentPrompt(
  rootDir: string,
  agentDir: string,
  options?: PromptLoaderOptions,
): Promise<PromptLoadResult> {
  const root = path.resolve(rootDir);
  const start = path.resolve(agentDir);

  // 1. Collect directory chain from root to agent (root first)
  const dirs: string[] = [];
  let current = start;
  let maxDepth = 100;
  while (current.startsWith(root) && maxDepth > 0) {
    dirs.unshift(current);
    if (current === root) break;
    current = path.dirname(current);
    maxDepth--;
  }

  const layers: string[] = [];
  const merged = new Map<string, PromptSlot>();

  for (const dir of dirs) {
    const promptDir = path.join(dir, "hierarchical", "prompt");
    let exists = false;
    try {
      exists = (await fs.stat(promptDir)).isDirectory();
    } catch {
      // swallow ENOENT / ENOTDIR
    }
    if (!exists) continue;

    layers.push(dir);
    const entries = await fs.readdir(promptDir, { withFileTypes: true });

    // Sort by name so slot order is deterministic
    const mdFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => ({ name: e.name, path: path.join(promptDir, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const file of mdFiles) {
      const content = await fs.readFile(file.path, "utf-8");
      // Child layer wins over parent layer for the same slot name
      merged.set(file.name, {
        slot: file.name,
        content,
        sourceLayer: dir,
        sortKey: file.name,
      });
    }
  }

  // Filter skip-list and sort
  let slots = [...merged.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  if (options?.skipSlots?.length) {
    const skip = new Set(options.skipSlots);
    slots = slots.filter((s) => !skip.has(s.slot));
  }

  let content = slots.map((s) => s.content).join("\n\n");
  let truncated = false;
  if (options?.maxChars && content.length > options.maxChars) {
    content = content.slice(0, options.maxChars);
    truncated = true;
  }

  return { content, slots, layers, truncated };
}
