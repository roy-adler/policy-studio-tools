import type { ToolsHubTool } from '../toolsSidebar/types';

export const ENV_VALUES_EDITOR_TOOL: ToolsHubTool = {
  id: 'env-values-editor',
  label: 'ENV values editor',
  iconId: 'symbol-field',
  command: 'policyStudioTools.openEnvValuesEditor',
  group: 'analyze',
  order: 2,
  when: 'policyStudio.projectDetected',
  available: true,
};
