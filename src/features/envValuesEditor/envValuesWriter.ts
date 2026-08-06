import * as fs from 'fs';
import { dump } from 'js-yaml';
import type { EnvValuesModel } from './types';

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
    const text = dump(doc.data, {
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    });
    fs.writeFileSync(doc.filePath, text, 'utf8');
    written.push(doc.filePath);
    documents[stageId] = { ...doc, dirty: false };
  }

  return {
    written,
    model: { ...model, documents },
  };
}
