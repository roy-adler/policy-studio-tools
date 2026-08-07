import * as fs from 'fs';
import { discoverEnvStages } from './discoverEnvStages';
import { buildEnvValuesModel, parseEnvValuesYaml } from './envValuesModel';
import type { EnvStageDocument, EnvValuesModel } from './types';

export function loadEnvValuesSession(envRoot: string): EnvValuesModel {
  const discovery = discoverEnvStages(envRoot);
  const documents: EnvStageDocument[] = discovery.stages.map((stage) => {
    let text: string;
    try {
      text = fs.readFileSync(stage.valuesFilePath, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read "${stage.valuesFilePath}": ${message}`);
    }
    const parsed = parseEnvValuesYaml(text);
    return {
      stageId: stage.id,
      filePath: stage.valuesFilePath,
      data: parsed.data,
      style: parsed.style,
      parseError: parsed.error,
      dirty: false,
    };
  });
  return buildEnvValuesModel(discovery.envRoot, documents);
}
