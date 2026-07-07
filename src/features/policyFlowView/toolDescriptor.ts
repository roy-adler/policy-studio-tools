import type { ToolsHubTool } from '../toolsSidebar/types';

export const POLICY_FLOW_TOOL: ToolsHubTool = {
  id: 'policy-flow',
  label: 'Policy flow',
  iconId: 'type-hierarchy-sub',
  command: 'policyStudioTools.showPolicyFlow',
  group: 'analyze',
  order: 1,
  when: 'policyStudio.projectDetected',
  available: true,
};
