import type { PolicyStudioProject, ProjectScope } from '../projectRegistry/types';

export function pickProjectRootForEnvEditor(
  projects: PolicyStudioProject[],
  scope: ProjectScope,
): PolicyStudioProject | undefined {
  if (projects.length === 0) {
    return undefined;
  }

  if (scope.mode === 'activeProject' && scope.activeProjectId) {
    const active = projects.find((project) => project.id === scope.activeProjectId);
    if (active) {
      return active;
    }
  }

  if (scope.mode === 'selectedProjects') {
    const selectedIds = scope.selectedProjectIds ?? [];
    if (selectedIds.length === 1) {
      const selected = projects.find((project) => project.id === selectedIds[0]);
      if (selected) {
        return selected;
      }
    }
  }

  if (projects.length === 1) {
    return projects[0];
  }

  return undefined;
}
