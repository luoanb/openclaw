/**
 * Builds hierarchical prompt supplement and tool allow-list for one agent turn.
 *
 * Called from harness.runAttempt (not from sessions_spawn). Uses sessionKey +
 * spawnedBy + label (via readSession) to resolve nodeDir, then PLS + NTS.
 */

import { formatChildrenList, scanAgentChildren } from "./agent-children-scanner.js";
import {
  resolveHierarchicalNodeContext,
  type HierarchicalNodeContext,
  type HierarchicalSessionReader,
} from "./node-path-resolver.js";
import {
  detectNodeType,
  formatToolRestrictions,
  intersectToolAllowLists,
  listToolNamesForNodeType,
  type NodeType,
} from "./node-tool-registry.js";
import { loadAgentPrompt } from "./prompt-loader.js";

export type BuildHierarchicalContextParams = {
  workspaceDir: string;
  sessionKey?: string;
  spawnedBy?: string | null;
  label?: string;
  /** Test or explicit override: absolute node directory. */
  nodeDirOverride?: string;
  readSession?: HierarchicalSessionReader;
  maxPromptChars?: number;
  /** Existing toolsAllow from config/policy; intersected with NTS. */
  toolsAllow?: string[];
  extraSystemPrompt?: string;
};

export type HierarchicalAttemptContext = {
  nodeContext: HierarchicalNodeContext;
  nodeType: NodeType;
  supplement: string;
  toolsAllow: string[];
  extraSystemPrompt: string;
};

export async function buildHierarchicalAttemptContext(
  params: BuildHierarchicalContextParams,
): Promise<HierarchicalAttemptContext> {
  const nodeContext = await resolveHierarchicalNodeContext({
    workspaceDir: params.workspaceDir,
    sessionKey: params.sessionKey,
    spawnedBy: params.spawnedBy,
    label: params.label,
    nodeDirOverride: params.nodeDirOverride,
    readSession: params.readSession,
  });

  const promptResult = await loadAgentPrompt(nodeContext.workspaceRoot, nodeContext.nodeDir, {
    maxChars: params.maxPromptChars ?? 60_000,
  });

  const children = await scanAgentChildren(nodeContext.nodeDir);
  const childrenBlock = formatChildrenList(children);

  const nodeType = await detectNodeType(nodeContext.nodeDir, nodeContext.workspaceRoot);
  const toolRestrictionHint = formatToolRestrictions(nodeType);
  const ntsAllow = listToolNamesForNodeType(nodeType);
  const toolsAllow = intersectToolAllowLists(ntsAllow, params.toolsAllow);

  const supplement = [
    promptResult.content,
    childrenBlock,
    `\n## Tool Restrictions\n\n${toolRestrictionHint}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const extraSystemPrompt = appendExtraSystemPrompt(params.extraSystemPrompt, supplement);

  return {
    nodeContext,
    nodeType,
    supplement,
    toolsAllow,
    extraSystemPrompt,
  };
}

function appendExtraSystemPrompt(existing: string | undefined, supplement: string): string {
  const parts = [existing?.trim(), supplement.trim()].filter(Boolean);
  return parts.join("\n\n");
}
