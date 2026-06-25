import type { PolicyStudioProject, ProjectScope } from './types';
import { getProjectForFile } from './discoverProjects';

export function getProjectsInScope(
  projects: PolicyStudioProject[],
  scope: ProjectScope,
): PolicyStudioProject[] {
  switch (scope.mode) {
    case 'allProjects':
      return [...projects];
    case 'activeProject': {
      if (!scope.activeProjectId) {
        return [];
      }
      const active = projects.find((p) => p.id === scope.activeProjectId);
      return active ? [active] : [];
    }
    case 'selectedProjects': {
      const ids = new Set(scope.selectedProjectIds ?? []);
      return projects.filter((p) => ids.has(p.id));
    }
  }
}

export function resolveDefaultScope(
  projects: PolicyStudioProject[],
  activeFilePath: string | undefined,
): ProjectScope {
  if (activeFilePath) {
    const project = getProjectForFile(activeFilePath, projects);
    if (project) {
      return { mode: 'activeProject', activeProjectId: project.id };
    }
  }

  if (projects.length > 0) {
    return { mode: 'allProjects' };
  }

  return { mode: 'allProjects' };
}

export function statusBarLabel(
  projects: PolicyStudioProject[],
  scope: ProjectScope,
): string | undefined {
  if (projects.length === 0) {
    return undefined;
  }

  if (projects.length === 1) {
    return `Policy Studio: ${projects[0].displayName}`;
  }

  if (scope.mode === 'activeProject' && scope.activeProjectId) {
    const active = projects.find((p) => p.id === scope.activeProjectId);
    if (active) {
      return `Policy Studio: ${active.displayName}`;
    }
  }

  return `Policy Studio: ${projects.length} projects`;
}
