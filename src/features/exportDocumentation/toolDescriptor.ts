import type { ToolsHubTool } from '../toolsSidebar/types';

export const EXPORT_DOCUMENTATION_TOOL: ToolsHubTool = {
  id: 'export-documentation',
  label: 'Export documentation',
  iconId: 'export',
  command: 'policyStudioTools.exportDocumentation',
  group: 'export',
  order: 1,
  when: 'policyStudio.projectDetected',
  available: true,
};
