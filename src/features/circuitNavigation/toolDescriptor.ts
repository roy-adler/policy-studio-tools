import type { ToolsHubTool } from '../toolsSidebar/types';

export const JUMP_TO_CIRCUIT_TOOL: ToolsHubTool = {
  id: 'jump-to-circuit',
  label: 'Jump to circuit',
  iconId: 'link',
  command: 'policyStudioTools.jumpToCircuit',
  group: 'navigate',
  order: 2,
  when: 'policyStudio.projectDetected',
  available: true,
};
