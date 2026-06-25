export interface PolicyStudioProject {
  id: string;
  rootPath: string;
  workspaceFolder: string;
  relativePath: string;
  displayName: string;
  projectType: 'xml' | 'yaml';
}

export interface ProjectRegistry {
  projects: PolicyStudioProject[];
  discoveredAt: Date;
  warnings: string[];
}

export interface ProjectScopedLocation {
  projectId: string;
  projectDisplayName: string;
  filePath: string;
  range?: Range;
}

export interface Range {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export type ProjectScopeMode = 'activeProject' | 'allProjects' | 'selectedProjects';

export interface ProjectScope {
  mode: ProjectScopeMode;
  activeProjectId?: string;
  selectedProjectIds?: string[];
}

export interface DiscoverySettings {
  scanDepth: number;
  includePaths: string[];
  excludePaths: string[];
  autoDiscover: boolean;
}
