import type { ProjectRegistryStore } from '../projectRegistry/projectRegistry';
import type { PolicyStudioProject } from '../projectRegistry/types';
import type { CacheInventoryScope } from './types';

export function resolveCacheBrowserProjects(
  store: Pick<ProjectRegistryStore, 'getProjectsInScope' | 'getProjectRegistry'>,
  inventoryScope: CacheInventoryScope,
): PolicyStudioProject[] {
  return inventoryScope === 'allProjects'
    ? store.getProjectRegistry().projects
    : store.getProjectsInScope();
}

export function cacheSessionProjectLabel(
  projects: PolicyStudioProject[],
  inventoryScope: CacheInventoryScope,
): string {
  if (projects.length === 0) {
    return '';
  }

  if (inventoryScope === 'allProjects') {
    return projects.length === 1
      ? `All projects · ${projects[0].displayName}`
      : `All projects (${projects.length})`;
  }

  return projects.length === 1 ? projects[0].displayName : `${projects.length} projects`;
}

export function shouldShowProjectNames(session: CacheSessionLike): boolean {
  if (new Set(session.caches.map((cache) => cache.projectId)).size > 1) {
    return true;
  }

  return session.inventoryScope === 'allProjects' && session.loadedProjectCount > 1;
}

interface CacheSessionLike {
  caches: Array<{ projectId: string }>;
  inventoryScope: CacheInventoryScope;
  loadedProjectCount: number;
}
