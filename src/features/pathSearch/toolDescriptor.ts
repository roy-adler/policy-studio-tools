import type { ToolsHubTool } from '../toolsSidebar/types';

export const PATH_SEARCH_TOOL: ToolsHubTool = {
  id: 'path-search',
  label: 'Search paths',
  iconId: 'list-filter',
  command: 'policyStudioTools.searchPaths',
  group: 'navigate',
  order: 3,
  when: 'policyStudio.projectDetected',
  available: true,
};
