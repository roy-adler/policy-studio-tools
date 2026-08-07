import * as fs from 'fs';
import * as path from 'path';
import type { PolicyStudioProject } from '../projectRegistry/types';
import { discoverEnvStages, resolveSiblingEnvRoot } from './discoverEnvStages';

export interface EnvRootCandidate {
  envRoot: string;
  project: PolicyStudioProject;
  /** Parent folder name next to POLICY_yaml (often the service bundle name). */
  bundleName: string;
  stageIds: string[];
}

/**
 * Projects in the given list whose sibling ENV/ exists and has at least one stage.
 */
export function listEnvRootsForProjects(projects: PolicyStudioProject[]): EnvRootCandidate[] {
  const candidates: EnvRootCandidate[] = [];

  for (const project of projects) {
    const envRoot = resolveSiblingEnvRoot(project.rootPath);
    if (!fs.existsSync(envRoot) || !fs.statSync(envRoot).isDirectory()) {
      continue;
    }
    const discovery = discoverEnvStages(envRoot);
    if (discovery.stages.length === 0) {
      continue;
    }
    candidates.push({
      envRoot: discovery.envRoot,
      project,
      bundleName: path.basename(path.dirname(path.resolve(project.rootPath))),
      stageIds: discovery.stages.map((stage) => stage.id),
    });
  }

  candidates.sort((a, b) => {
    const byBundle = a.bundleName.localeCompare(b.bundleName);
    if (byBundle !== 0) {
      return byBundle;
    }
    return a.project.displayName.localeCompare(b.project.displayName);
  });

  return candidates;
}
