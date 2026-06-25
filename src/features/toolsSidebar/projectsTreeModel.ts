import type { PolicyStudioProject, ProjectRegistry, ProjectScope } from '../projectRegistry/types';

export type ProjectsTreeNodeKind = 'scope' | 'refresh' | 'project' | 'warning' | 'empty';

export interface ProjectsTreeNode {
  id: string;
  label: string;
  description?: string;
  kind: ProjectsTreeNodeKind;
  projectId?: string;
  iconId?: string;
  tooltip?: string;
  command?: string;
}

export function formatScopeSummary(projects: PolicyStudioProject[], scope: ProjectScope): string {
  if (projects.length === 0) {
    return 'No projects';
  }

  switch (scope.mode) {
    case 'allProjects':
      return `All projects (${projects.length})`;
    case 'selectedProjects': {
      const count = scope.selectedProjectIds?.length ?? 0;
      return `Selected: ${count} project(s)`;
    }
    case 'activeProject': {
      const active = projects.find((p) => p.id === scope.activeProjectId);
      return active ? `Active: ${active.displayName}` : 'Active project';
    }
  }
}

export function scopeIconId(scope: ProjectScope): string {
  switch (scope.mode) {
    case 'allProjects':
      return 'folder-library';
    case 'selectedProjects':
      return 'list-selection';
    case 'activeProject':
      return 'target';
  }
}

export function buildProjectsTree(
  registry: ProjectRegistry,
  scope: ProjectScope,
): ProjectsTreeNode[] {
  const { projects, warnings } = registry;

  if (projects.length === 0) {
    return [
      {
        id: 'empty',
        label: 'No Policy Studio projects found',
        kind: 'empty',
        description: 'Run Refresh or check workspace markers (PrimaryStore.xml / values.yaml)',
        iconId: 'info',
      },
      {
        id: 'refresh',
        label: 'Refresh projects',
        kind: 'refresh',
        command: 'policyStudioTools.refreshProjects',
        iconId: 'refresh',
      },
    ];
  }

  const nodes: ProjectsTreeNode[] = [
    {
      id: 'scope',
      label: formatScopeSummary(projects, scope),
      kind: 'scope',
      command: 'policyStudioTools.selectProjectScope',
      iconId: scopeIconId(scope),
      tooltip: 'Change project scope',
    },
    {
      id: 'refresh',
      label: 'Refresh projects',
      kind: 'refresh',
      command: 'policyStudioTools.refreshProjects',
      iconId: 'refresh',
    },
  ];

  const duplicateNames = new Set<string>();
  const nameCounts = new Map<string, number>();
  for (const project of projects) {
    nameCounts.set(project.displayName, (nameCounts.get(project.displayName) ?? 0) + 1);
  }
  for (const [name, count] of nameCounts) {
    if (count > 1) {
      duplicateNames.add(name);
    }
  }

  for (const project of projects) {
    const isActive =
      scope.mode === 'activeProject' && scope.activeProjectId === project.id;
    const descriptionParts = [
      project.projectType.toUpperCase(),
      project.relativePath || undefined,
      duplicateNames.has(project.displayName) ? project.workspaceFolder : undefined,
      isActive ? '(active)' : undefined,
    ].filter(Boolean);

    nodes.push({
      id: `project-${project.id}`,
      label: project.displayName,
      description: descriptionParts.join(' · '),
      kind: 'project',
      projectId: project.id,
      iconId: isActive ? 'check' : project.projectType === 'yaml' ? 'symbol-key' : 'file-code',
      tooltip: project.rootPath,
    });
  }

  for (const [index, warning] of warnings.entries()) {
    nodes.push({
      id: `warning-${index}`,
      label: warning,
      kind: 'warning',
      iconId: 'warning',
      tooltip: warning,
    });
  }

  return nodes;
}
