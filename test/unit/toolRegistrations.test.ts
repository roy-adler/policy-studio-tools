import { describe, expect, it } from 'vitest';
import { JUMP_TO_CIRCUIT_TOOL } from '../../src/features/circuitNavigation/toolDescriptor';
import { POLICY_FLOW_TOOL } from '../../src/features/policyFlowView/toolDescriptor';
import { ToolsHubService } from '../../src/features/toolsSidebar/toolsHubService';
import { buildToolsTree } from '../../src/features/toolsSidebar/toolsTreeModel';

describe('sidebar tool registrations', () => {
  it('jump-to-circuit registers as an available Navigate tool', () => {
    expect(JUMP_TO_CIRCUIT_TOOL.group).toBe('navigate');
    expect(JUMP_TO_CIRCUIT_TOOL.command).toBe('policyStudioTools.jumpToCircuit');
    expect(JUMP_TO_CIRCUIT_TOOL.available).toBe(true);
  });

  it('policy flow registers as an available Analyze tool', () => {
    expect(POLICY_FLOW_TOOL.group).toBe('analyze');
    expect(POLICY_FLOW_TOOL.command).toBe('policyStudioTools.showPolicyFlow');
    expect(POLICY_FLOW_TOOL.available).toBe(true);
  });

  it('both tools appear in the tools tree when a project is detected', () => {
    const hub = new ToolsHubService();
    hub.registerTool(JUMP_TO_CIRCUIT_TOOL);
    hub.registerTool(POLICY_FLOW_TOOL);

    const nodes = buildToolsTree(hub.getTools(), true);
    const navigate = nodes.find((node) => node.id === 'group-navigate');
    const analyze = nodes.find((node) => node.id === 'group-analyze');

    expect(navigate?.children?.some((child) => child.command === 'policyStudioTools.jumpToCircuit')).toBe(true);
    expect(analyze?.children?.some((child) => child.command === 'policyStudioTools.showPolicyFlow')).toBe(true);
  });
});
