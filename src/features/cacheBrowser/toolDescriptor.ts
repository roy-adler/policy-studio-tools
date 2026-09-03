import type { ToolsHubTool } from '../toolsSidebar/types';

export const CACHE_BROWSER_TOOL: ToolsHubTool = {
  id: 'cache-browser',
  label: 'Caches',
  iconId: 'database',
  command: 'policyStudioTools.openCacheBrowser',
  group: 'analyze',
  order: 4,
  when: 'policyStudio.projectDetected',
  available: true,
};
