import * as fs from 'fs';
import * as path from 'path';
import type { KpsRow, KpsSession } from './types';

function rowToObject(
  row: KpsRow,
  columns: string[],
  schemaColumns: string[],
): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const schemaSet = new Set(schemaColumns);
  const seen = new Set<string>();

  const writeKey = (key: string) => {
    if (seen.has(key)) {
      return;
    }
    const cell = row.cells[key];
    if (cell?.editable && Array.isArray(cell.value)) {
      obj[key] = cell.value;
      seen.add(key);
      return;
    }
    if (key in row.extra) {
      obj[key] = row.extra[key];
      seen.add(key);
      return;
    }
    if (!cell || !cell.editable) {
      return;
    }
    const isSchema = schemaSet.size === 0 || schemaSet.has(key);
    if (!isSchema && (cell.value === '' || cell.value === undefined)) {
      seen.add(key);
      return;
    }
    obj[key] = cell.value ?? '';
    seen.add(key);
  };

  for (const key of row.keyOrder) {
    writeKey(key);
  }
  for (const column of columns) {
    writeKey(column);
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
      const text = JSON.stringify(payload, null, 4);
      fs.writeFileSync(stage.filePath, text, 'utf8');
      stage.dirty = false;
      written.push(stage.filePath);
    }
  }

  return { written };
}
