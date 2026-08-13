import * as fs from 'fs';
import * as path from 'path';
import type { KpsRow, KpsSession } from './types';

function rowToObject(
  row: KpsRow,
  columns: string[],
  schemaColumns: string[],
): Record<string, unknown> {
  const obj: Record<string, unknown> = { ...row.extra };
  const schemaSet = new Set(schemaColumns);

  for (const column of columns) {
    const cell = row.cells[column];
    if (!cell || !cell.editable) {
      continue;
    }
    const isSchema = schemaSet.size === 0 || schemaSet.has(column);
    if (!isSchema && (cell.value === '' || cell.value === undefined)) {
      delete obj[column];
      continue;
    }
    obj[column] = cell.value ?? '';
  }
  return obj;
}

export function writeDirtyKpsTables(session: KpsSession): { written: string[] } {
  const written: string[] = [];

  for (const table of Object.values(session.tables)) {
    for (const stage of Object.values(table.stages)) {
      if (!stage.dirty || stage.status !== 'present') {
        continue;
      }
      const dir = path.dirname(stage.filePath);
      fs.mkdirSync(dir, { recursive: true });
      const payload = stage.rows.map((row) =>
        rowToObject(row, table.columns, table.schemaColumns),
      );
      const text = `${JSON.stringify(payload, null, 4)}\n`;
      fs.writeFileSync(stage.filePath, text, 'utf8');
      stage.dirty = false;
      written.push(stage.filePath);
    }
  }

  return { written };
}
