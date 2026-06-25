import type { ToolsHubTool } from './types';
import { TOOLS_HUB_GROUP_LABELS, TOOLS_HUB_GROUP_ORDER } from './types';

export type ToolsTreeNodeKind = 'group' | 'tool' | 'refresh';

export interface ToolsTreeNode {
  id: string;
  label: string;
  kind: ToolsTreeNodeKind;
  command?: string;
  iconId?: string;
  tooltip?: string;
  children?: ToolsTreeNode[];
}

export function buildToolsTree(tools: ToolsHubTool[], projectDetected: boolean): ToolsTreeNode[] {
  const nodes: ToolsTreeNode[] = [
    {
      id: 'refresh',
      label: 'Refresh projects',
      kind: 'refresh',
      command: 'policyStudioTools.refreshProjects',
      iconId: 'refresh',
    },
  ];

  if (!projectDetected) {
    return nodes;
  }

  const available = tools.filter((tool) => tool.available);
  for (const group of TOOLS_HUB_GROUP_ORDER) {
    const groupTools = available
      .filter((tool) => tool.group === group)
      .sort((a, b) => a.order - b.order);
    if (groupTools.length === 0) {
      continue;
    }

    nodes.push({
      id: `group-${group}`,
      label: TOOLS_HUB_GROUP_LABELS[group],
      kind: 'group',
      children: groupTools.map((tool) => ({
        id: tool.id,
        label: tool.label,
        kind: 'tool' as const,
        command: tool.command,
        iconId: tool.iconId,
        tooltip: tool.label,
      })),
    });
  }

  return nodes;
}

export function sortRegisteredTools(tools: ToolsHubTool[]): ToolsHubTool[] {
  return [...tools].sort((a, b) => {
    const groupDelta =
      TOOLS_HUB_GROUP_ORDER.indexOf(a.group) - TOOLS_HUB_GROUP_ORDER.indexOf(b.group);
    if (groupDelta !== 0) {
      return groupDelta;
    }
    return a.order - b.order;
  });
}

export function flattenToolCommands(tools: ToolsHubTool[]): string[] {
  return sortRegisteredTools(tools)
    .filter((tool) => tool.available)
    .map((tool) => tool.command);
}
