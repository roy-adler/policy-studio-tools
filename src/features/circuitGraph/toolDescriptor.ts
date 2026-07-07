import type { ToolsHubTool } from '../toolsSidebar/types';

export const CIRCUIT_GRAPH_TOOL: ToolsHubTool = {
  id: 'circuit-graph',
  label: 'Circuit graph',
  iconId: 'type-hierarchy',
  command: 'policyStudioTools.showCircuitGraph',
  group: 'analyze',
  order: 2,
  when: 'policyStudio.projectDetected',
  available: true,
};
