import * as fs from 'fs';
import * as path from 'path';
import type { EnvStage, EnvStageDiscovery } from './types';

export function resolveSiblingEnvRoot(projectRoot: string): string {
  return path.join(path.dirname(path.resolve(projectRoot)), 'ENV');
}

export function discoverEnvStages(envRoot: string): EnvStageDiscovery {
  const resolved = path.resolve(envRoot);
  const stages: EnvStage[] = [];
  const skippedDirs: string[] = [];

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return { envRoot: resolved, stages, skippedDirs };
  }

  for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const stageDir = path.join(resolved, entry.name);
    const valuesFilePath = path.join(stageDir, 'values.yaml');
    if (fs.existsSync(valuesFilePath) && fs.statSync(valuesFilePath).isFile()) {
      stages.push({ id: entry.name, valuesFilePath });
    } else {
      skippedDirs.push(entry.name);
    }
  }

  stages.sort((a, b) => a.id.localeCompare(b.id));
  return { envRoot: resolved, stages, skippedDirs };
}
