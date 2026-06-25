import { EventEmitter } from 'events';
import type { PolicyStudioProject, ProjectRegistry, ProjectScope } from './types';
import { getProjectsInScope as resolveProjectsInScope } from './projectScope';

export { discoverProjects, getProjectForFile } from './discoverProjects';
export { getProjectsInScope } from './projectScope';
export type { PolicyStudioProject, ProjectRegistry, ProjectScope, ProjectScopedLocation } from './types';

export class ProjectRegistryStore {
  private registry: ProjectRegistry = {
    projects: [],
    discoveredAt: new Date(0),
    warnings: [],
  };

  private scope: ProjectScope = { mode: 'allProjects' };

  private readonly emitter = new EventEmitter();

  getProjectRegistry(): ProjectRegistry {
    return this.registry;
  }

  getScope(): ProjectScope {
    return this.scope;
  }

  setRegistry(registry: ProjectRegistry): void {
    this.registry = registry;
    this.emitter.emit('changed', registry);
  }

  setScope(scope: ProjectScope): void {
    this.scope = scope;
    this.emitter.emit('scopeChanged', scope);
  }

  getProjectsInScope(): PolicyStudioProject[] {
    return resolveProjectsInScope(this.registry.projects, this.scope);
  }

  onProjectsChanged(listener: (registry: ProjectRegistry) => void): { dispose: () => void } {
    this.emitter.on('changed', listener);
    return { dispose: () => this.emitter.off('changed', listener) };
  }

  onScopeChanged(listener: (scope: ProjectScope) => void): { dispose: () => void } {
    this.emitter.on('scopeChanged', listener);
    return { dispose: () => this.emitter.off('scopeChanged', listener) };
  }
}
