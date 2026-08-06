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

  if (projects.length === 1) {
    return projects[0];
  }

  return undefined;
}
