import * as fs from 'fs';
import * as path from 'path';
import type { KpsStage, KpsStageDiscovery } from './types';

export function resolveSiblingKpsRoot(projectRoot: string): string {
  return path.join(path.dirname(path.resolve(projectRoot)), 'KPS');
}

export function discoverKpsStages(kpsRoot: string): KpsStageDiscovery {
  const resolved = path.resolve(kpsRoot);
  const stages: KpsStage[] = [];
  const skippedDirs: string[] = [];
  const tableNameSet = new Set<string>();

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return { kpsRoot: resolved, stages, tableNames: [], skippedDirs };
  }

  for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const stageDir = path.join(resolved, entry.name);
    const jsonFiles = fs
      .readdirSync(stageDir, { withFileTypes: true })
      .filter((child) => child.isFile() && child.name.toLowerCase().endsWith('.json'))
      .map((child) => child.name);

    if (jsonFiles.length === 0) {
      skippedDirs.push(entry.name);
      continue;
    }

    stages.push({ id: entry.name, stageDir });
    for (const name of jsonFiles) {
      tableNameSet.add(name);
    }
  }

  stages.sort((a, b) => a.id.localeCompare(b.id));
  const tableNames = [...tableNameSet].sort((a, b) => a.localeCompare(b));
  return { kpsRoot: resolved, stages, tableNames, skippedDirs };
}
