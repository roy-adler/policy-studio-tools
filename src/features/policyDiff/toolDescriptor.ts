import type { ToolsHubTool } from '../toolsSidebar/types';

export const POLICY_DIFF_TOOL: ToolsHubTool = {
  id: 'policy-diff',
  label: 'Compare policies',
  iconId: 'diff',
  command: 'policyStudioTools.comparePolicies',
  group: 'analyze',
  order: 1,
  when: 'policyStudio.projectDetected',
  available: true,
};
