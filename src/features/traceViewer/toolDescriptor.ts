import type { ToolsHubTool } from '../toolsSidebar/types';

export const TRACE_VIEWER_TOOL: ToolsHubTool = {
  id: 'trace-viewer',
  label: 'Open trace file',
  iconId: 'debug-alt',
  command: 'policyStudioTools.openTraceFile',
  group: 'traces',
  order: 1,
  available: true,
};
