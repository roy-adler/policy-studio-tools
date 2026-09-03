import type { PolicyStudioProject } from '../projectRegistry/types';
import { discoverCaches } from './discoverCaches';
import { findCacheUsages } from './findCacheUsages';
import { cacheSessionProjectLabel } from './resolveCacheBrowserProjects';
import type { CacheInventoryScope, CacheSession } from './types';

export function loadCacheSession(
  projects: PolicyStudioProject[],
  options?: { inventoryScope?: CacheInventoryScope },
): CacheSession {
  const inventoryScope = options?.inventoryScope ?? 'inScope';
  const session: CacheSession = {
    caches: [],
    usages: [],
    warnings: [],
    projectLabel: cacheSessionProjectLabel(projects, inventoryScope),
    inventoryScope,
    loadedProjectCount: projects.length,
  };

  for (const project of projects) {
    const discovered = discoverCaches(project);
    session.caches.push(...discovered.caches);
    session.warnings.push(...discovered.warnings);
    const usage = findCacheUsages(project, discovered.caches, new Set(discovered.inventoryPaths));
    session.usages.push(...usage.usages);
    session.warnings.push(...usage.warnings);
  }

  return session;
}
