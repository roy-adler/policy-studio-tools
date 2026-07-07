import type { ToolsHubTool } from '../toolsSidebar/types';

export const PATH_TEMPLATE_VALIDATOR_TOOL: ToolsHubTool = {
  id: 'path-template-validator',
  label: 'Validate path templates',
  iconId: 'checklist',
  command: 'policyStudioTools.validatePathTemplates',
  group: 'validate',
  order: 1,
  when: 'policyStudio.projectDetected',
  available: true,
};
