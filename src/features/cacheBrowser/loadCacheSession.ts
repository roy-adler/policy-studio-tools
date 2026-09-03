import type { PolicyStudioProject } from '../projectRegistry/types';
import { discoverCaches } from './discoverCaches';
import { findCacheUsages } from './findCacheUsages';
import type { CacheSession } from './types';

export function loadCacheSession(projects: PolicyStudioProject[]): CacheSession {
  const session: CacheSession = {
    caches: [],
    usages: [],
    warnings: [],
    projectLabel:
      projects.length === 0 ? '' : projects.length === 1 ? projects[0].displayName : `${projects.length} projects`,
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
