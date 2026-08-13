import * as fs from 'fs';
import * as path from 'path';
import { discoverKpsStages } from './discoverKpsStages';
import { buildKpsSession } from './kpsTableModel';
import { loadKpsTypeSchemas, resolveSiblingPolicyProject } from './kpsTypeSchema';
import type { KpsSession } from './types';

export function loadKpsSession(kpsRoot: string): KpsSession {
  const discovery = discoverKpsStages(kpsRoot);
  const projectRoot = resolveSiblingPolicyProject(discovery.kpsRoot);
  const schema = projectRoot
    ? loadKpsTypeSchemas(projectRoot)
    : { columnTypesByTable: {}, schemaColumnsByTable: {}, warnings: [] as string[] };

  const tableNames = [
    ...new Set([...discovery.tableNames, ...Object.keys(schema.columnTypesByTable)]),
  ].sort((a, b) => a.localeCompare(b));

  const fileContents: Record<string, string | null> = {};
  for (const stage of discovery.stages) {
    for (const tableName of tableNames) {
      const key = `${stage.id}/${tableName}`;
      const filePath = path.join(stage.stageDir, tableName);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        fileContents[key] = fs.readFileSync(filePath, 'utf8');
      } else {
        fileContents[key] = null;
      }
    }
  }

  const session = buildKpsSession(
    discovery.kpsRoot,
    { ...discovery, tableNames },
    fileContents,
    schema.columnTypesByTable,
    schema.schemaColumnsByTable,
  );
  session.warnings.push(...schema.warnings);
  for (const tableName of tableNames) {
    if (!schema.columnTypesByTable[tableName]) {
      session.warnings.push(`No Store/Type Group found for ${tableName}`);
    }
  }
  return session;
}
