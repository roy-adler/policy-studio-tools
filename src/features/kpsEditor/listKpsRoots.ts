import * as fs from 'fs';
import * as path from 'path';
import type { PolicyStudioProject } from '../projectRegistry/types';
import { discoverKpsStages, resolveSiblingKpsRoot } from './discoverKpsStages';

export interface KpsRootCandidate {
  kpsRoot: string;
  project: PolicyStudioProject;
  /** Parent folder name next to POLICY_yaml (often the service bundle name). */
  bundleName: string;
  stageIds: string[];
  tableNames: string[];
}

/**
 * Projects in the given list whose sibling KPS/ exists and has at least one stage.
 */
export function listKpsRootsForProjects(projects: PolicyStudioProject[]): KpsRootCandidate[] {
  const candidates: KpsRootCandidate[] = [];

  for (const project of projects) {
    const kpsRoot = resolveSiblingKpsRoot(project.rootPath);
    if (!fs.existsSync(kpsRoot) || !fs.statSync(kpsRoot).isDirectory()) {
      continue;
    }
    const discovery = discoverKpsStages(kpsRoot);
    if (discovery.stages.length === 0) {
      continue;
    }
    candidates.push({
      kpsRoot: discovery.kpsRoot,
      project,
      bundleName: path.basename(path.dirname(path.resolve(project.rootPath))),
      stageIds: discovery.stages.map((stage) => stage.id),
      tableNames: discovery.tableNames,
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
