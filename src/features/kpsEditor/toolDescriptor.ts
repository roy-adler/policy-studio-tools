import type { ToolsHubTool } from '../toolsSidebar/types';

export const KPS_EDITOR_TOOL: ToolsHubTool = {
  id: 'kps-editor',
  label: 'KPS editor',
  iconId: 'table',
  command: 'policyStudioTools.openKpsEditor',
  group: 'analyze',
  order: 3,
  when: 'policyStudio.projectDetected',
  available: true,
};
