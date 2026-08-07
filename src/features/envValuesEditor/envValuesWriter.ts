import * as fs from 'fs';
import type { EnvValuesModel } from './types';
import { dumpMappingYaml } from './yamlMaps';

export function writeDirtyEnvDocuments(model: EnvValuesModel): {
  written: string[];
  model: EnvValuesModel;
} {
  const written: string[] = [];
  const documents = { ...model.documents };

  for (const [stageId, doc] of Object.entries(documents)) {
    if (!doc.dirty || doc.parseError) {
      continue;
    }
    const text = dumpMappingYaml(doc.data, doc.style);
    try {
      fs.writeFileSync(doc.filePath, text, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to write "${doc.filePath}": ${message}`);
    }
    written.push(doc.filePath);
    documents[stageId] = { ...doc, dirty: false };
  }

  return {
    written,
    model: { ...model, documents },
  };
}
