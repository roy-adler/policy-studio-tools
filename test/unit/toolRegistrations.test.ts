import { describe, expect, it } from 'vitest';
import { CIRCUIT_GRAPH_TOOL } from '../../src/features/circuitGraph/toolDescriptor';
import { JUMP_TO_CIRCUIT_TOOL } from '../../src/features/circuitNavigation/toolDescriptor';
import { EXPORT_DOCUMENTATION_TOOL } from '../../src/features/exportDocumentation/toolDescriptor';
import { PATH_TEMPLATE_VALIDATOR_TOOL } from '../../src/features/pathTemplateValidator/toolDescriptor';
import { POLICY_DIFF_TOOL } from '../../src/features/policyDiff/toolDescriptor';
import { POLICY_FLOW_TOOL } from '../../src/features/policyFlowView/toolDescriptor';
import { TRACE_VIEWER_TOOL } from '../../src/features/traceViewer/toolDescriptor';
import { ToolsHubService } from '../../src/features/toolsSidebar/toolsHubService';
import { buildToolsTree } from '../../src/features/toolsSidebar/toolsTreeModel';

const ALL_TOOLS = [
  JUMP_TO_CIRCUIT_TOOL,
  POLICY_FLOW_TOOL,
  CIRCUIT_GRAPH_TOOL,
  POLICY_DIFF_TOOL,
  PATH_TEMPLATE_VALIDATOR_TOOL,
  EXPORT_DOCUMENTATION_TOOL,
  TRACE_VIEWER_TOOL,
];

describe('sidebar tool registrations', () => {
  it('registers all feature tools as available', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.available).toBe(true);
      expect(tool.command).toMatch(/^policyStudioTools\./);
    }
  });

  it('places tools in the correct sidebar groups', () => {
    expect(JUMP_TO_CIRCUIT_TOOL.group).toBe('navigate');
    expect(POLICY_FLOW_TOOL.group).toBe('analyze');
    expect(CIRCUIT_GRAPH_TOOL.group).toBe('analyze');
    expect(POLICY_DIFF_TOOL.group).toBe('analyze');
    expect(PATH_TEMPLATE_VALIDATOR_TOOL.group).toBe('validate');
    expect(EXPORT_DOCUMENTATION_TOOL.group).toBe('export');
    expect(TRACE_VIEWER_TOOL.group).toBe('traces');
  });

  it('shows all registered tools in the tools tree when a project is detected', () => {
    const hub = new ToolsHubService();
    for (const tool of ALL_TOOLS) {
      hub.registerTool(tool);
    }

    const nodes = buildToolsTree(hub.getTools(), true);
    const commands = nodes
      .flatMap((node) => node.children ?? [])
      .map((child) => child.command)
      .filter(Boolean);

    for (const tool of ALL_TOOLS) {
      expect(commands).toContain(tool.command);
    }
  });
});
