import * as fs from 'fs';
import { discoverEnvStages } from './discoverEnvStages';
import { buildEnvValuesModel, parseEnvValuesYaml } from './envValuesModel';
import type { EnvStageDocument, EnvValuesModel } from './types';

export function loadEnvValuesSession(envRoot: string): EnvValuesModel {
  const discovery = discoverEnvStages(envRoot);
  const documents: EnvStageDocument[] = discovery.stages.map((stage) => {
    const text = fs.readFileSync(stage.valuesFilePath, 'utf8');
    const parsed = parseEnvValuesYaml(text);
    return {
      stageId: stage.id,
      filePath: stage.valuesFilePath,
      data: parsed.data,
      parseError: parsed.error,
      dirty: false,
    };
  });
  return buildEnvValuesModel(discovery.envRoot, documents);
}
