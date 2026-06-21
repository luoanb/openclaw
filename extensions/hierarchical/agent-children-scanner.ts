/**
 * Scans `hierarchical/children/` directories to discover sub-agent
 * entries and parse their frontmatter for the `<available_agents>` list.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One sub-agent entry discovered in the filesystem */
export type AgentChildEntry = {
  /** Directory name under `children/` — use as `sessions_spawn.label` (nodeId). */
  agentId: string;
  /** `name` from frontmatter */
  name: string;
  /** `description` from frontmatter */
  description: string;
  /** Whether this sub-agent itself has a non-empty `children/` directory */
  hasChildren: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Lightweight frontmatter parser — reads `name` and `description` only. */
function parseFrontmatter(content: string): { name?: string; description?: string } | null {
  // Must start with --- on its own line
  const match = content.match(/^---[\r\n]+([\s\S]*?)[\r\n]+---/);
  if (!match) return null;

  const yaml = match[1];
  let name: string | undefined;
  let description: string | undefined;

  for (const line of yaml.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const sep = line.indexOf(":");
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    const val = line.slice(sep + 1).trim();
    if (key === "name") {
      name = val;
    } else if (key === "description") {
      description = val;
    }
  }

  return name ? { name, description } : null;
}

async function existsDir(p: string): Promise<boolean> {
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
 * Scan `{agentDir}/hierarchical/children/` and return one entry per
 * sub-directory that contains a frontmatter-bearing prompt file.
 */
export async function scanAgentChildren(agentDir: string): Promise<AgentChildEntry[]> {
  const childrenDir = path.join(agentDir, "hierarchical", "children");
  if (!(await existsDir(childrenDir))) return [];

  const entries: AgentChildEntry[] = [];
  const dirEntries = await fs.readdir(childrenDir, { withFileTypes: true });

  for (const de of dirEntries) {
    if (!de.isDirectory()) continue;

    const childPromptDir = path.join(childrenDir, de.name, "hierarchical", "prompt");
    if (!(await existsDir(childPromptDir))) continue;

    // Read first `.md` file that has valid frontmatter
    const files: string[] = [];
    try {
      for (const f of await fs.readdir(childPromptDir)) {
        if (f.endsWith(".md")) files.push(f);
      }
    } catch {
      continue;
    }
    files.sort();

    for (const file of files) {
      try {
        const content = await fs.readFile(path.join(childPromptDir, file), "utf-8");
        const fm = parseFrontmatter(content);
        if (fm) {
          const childAgentDir = path.join(childrenDir, de.name, "hierarchical");
          entries.push({
            agentId: de.name,
            name: fm.name ?? de.name,
            description: fm.description ?? "",
            hasChildren: await existsDir(path.join(childAgentDir, "children")),
          });
          break; // first valid frontmatter wins
        }
      } catch {
        continue;
      }
    }
  }

  return entries;
}

/**
 * Format an `<available_agents>` XML block for injection into the system
 * prompt. Returns an empty string when the list is empty.
 */
export function formatChildrenList(entries: AgentChildEntry[]): string {
  if (entries.length === 0) return "";

  const items = entries
    .map(
      (e) =>
        `  <agent>\n    <name>${xmlEscape(e.name)}</name>\n    <description>${xmlEscape(e.description)}</description>\n    <location>${xmlEscape(`children/${e.agentId}/`)}</location>\n  </agent>`,
    )
    .join("\n");

  return (
    `\n## Available Sub-Agents\n` +
    `\nSpawn with sessions_spawn({ task, label: "<nodeId>" }). ` +
    `label must match the directory name under hierarchical/children/ (see <location>).\n` +
    `\n<available_agents>\n${items}\n</available_agents>`
  );
}

/** Minimal XML text-content escaping. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
