export type ToolsHubGroup = 'navigate' | 'analyze' | 'validate' | 'export' | 'traces';

export interface ToolsHubTool {
  id: string;
  label: string;
  iconId: string;
  command: string;
  group: ToolsHubGroup;
  order: number;
  when?: string;
  available: boolean;
}

export const TOOLS_HUB_GROUP_ORDER: ToolsHubGroup[] = [
  'navigate',
  'analyze',
  'validate',
  'export',
  'traces',
];

export const TOOLS_HUB_GROUP_LABELS: Record<ToolsHubGroup, string> = {
  navigate: 'Navigate',
  analyze: 'Analyze',
  validate: 'Validate',
  export: 'Export',
  traces: 'Traces',
};

export interface CircuitSearchViewHost {
  focus(): void;
  notifyScopeChanged(): void;
}
