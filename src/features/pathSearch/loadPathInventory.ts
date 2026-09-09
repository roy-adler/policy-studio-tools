import type { PolicyStudioProject } from '../projectRegistry/types';
import { discoverServicePaths } from './discoverServicePaths';
import { searchPaths } from './searchPaths';
import type { PathSearchResponse } from './types';

export function loadPathInventory(
  projects: PolicyStudioProject[],
  query = '',
): PathSearchResponse {
  const { entries, warnings } = discoverServicePaths(projects);
  return {
    results: searchPaths(entries, query),
    warnings,
    projectsScanned: projects.length,
  };
}
