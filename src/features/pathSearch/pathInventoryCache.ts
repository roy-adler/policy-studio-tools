import type { PolicyStudioProject } from '../projectRegistry/types';
import {
  discoverServicePaths,
  type DiscoverServicePathsResult,
} from './discoverServicePaths';
import type { ServicePathEntry } from './types';

export interface PathInventorySnapshot {
  entries: ServicePathEntry[];
  warnings: string[];
  projectsScanned: number;
}

type DiscoverPaths = (projects: PolicyStudioProject[]) => DiscoverServicePathsResult;

export class PathInventoryCache {
  private snapshot: PathInventorySnapshot | undefined;

  constructor(private readonly discoverPaths: DiscoverPaths = discoverServicePaths) {}

  get(projects: PolicyStudioProject[]): PathInventorySnapshot {
    return this.snapshot ?? this.rebuild(projects);
  }

  rebuild(projects: PolicyStudioProject[]): PathInventorySnapshot {
    const { entries, warnings } = this.discoverPaths(projects);
    this.snapshot = {
      entries,
      warnings,
      projectsScanned: projects.length,
    };
    return this.snapshot;
  }

  invalidate(): void {
    this.snapshot = undefined;
  }
}
