import * as fs from 'fs';
import * as path from 'path';
import { discoverKpsStages } from './discoverKpsStages';
import { buildKpsSession } from './kpsTableModel';
import type { KpsSession } from './types';

export function loadKpsSession(kpsRoot: string): KpsSession {
  const discovery = discoverKpsStages(kpsRoot);
  const fileContents: Record<string, string | null> = {};

  for (const stage of discovery.stages) {
    for (const tableName of discovery.tableNames) {
      const key = `${stage.id}/${tableName}`;
      const filePath = path.join(stage.stageDir, tableName);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        fileContents[key] = fs.readFileSync(filePath, 'utf8');
      } else {
        fileContents[key] = null;
      }
    }
  }

  return buildKpsSession(discovery.kpsRoot, discovery, fileContents);
}
