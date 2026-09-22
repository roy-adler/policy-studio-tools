import type { KpsColumnType, KpsRow, KpsScalar, KpsSession, KpsStageTable, KpsValue } from './types';
import {
  coerceByColumnType,
  defaultValueForColumnType,
  listElementMismatch,
  parseListInput,
} from './kpsTypeSchema';

function requirePresentStage(
  session: KpsSession,
  tableName: string,
  stageId: string,
): KpsStageTable {
  const table = session.tables[tableName];
  if (!table) {
    throw new Error(`Unknown table: ${tableName}`);
  }
  const stage = table.stages[stageId];
  if (!stage) {
    throw new Error(`Unknown stage: ${stageId}`);
  }
  if (stage.status !== 'present') {
    throw new Error(`Stage ${stageId} is not editable (status=${stage.status})`);
  }
  return stage;
}

function coerceCellValue(previous: KpsValue | undefined, text: string): KpsScalar {
  if (Array.isArray(previous)) {
    return text;
  }
  if (typeof previous === 'number') {
    const trimmed = text.trim();
    if (trimmed !== '' && !Number.isNaN(Number(trimmed))) {
      return Number(trimmed);
    }
  }
  if (typeof previous === 'boolean') {
    if (text === 'true') {
      return true;
    }
    if (text === 'false') {
      return false;
    }
  }
  if (previous === null && text === '') {
    return null;
  }
  return text;
}

export function setCell(
  session: KpsSession,
  tableName: string,
  stageId: string,
  rowIndex: number,
  column: string,
  text: string,
): void {
  const stage = requirePresentStage(session, tableName, stageId);
  const row = stage.rows[rowIndex];
  if (!row) {
    throw new Error(`Row index out of range: ${rowIndex}`);
  }
  const existing = row.cells[column];
  if (existing && !existing.editable) {
    throw new Error(`Cell "${column}" is not editable`);
  }
  const previous = existing?.value;
  const columnType = session.tables[tableName].columnTypes[column];
  if (columnType === 'list') {
    const parsed = parseListInput(text);
    if (!parsed.ok) {
      session.editWarning = `Could not set "${column}" to a list`;
      return;
    }
    const elementType = session.tables[tableName].listElementTypes[column];
    const warning = listElementMismatch(parsed.value, elementType);
    delete row.extra[column];
    session.editWarning = undefined;
    row.cells[column] = { editable: true, value: parsed.value, warning };
    stage.dirty = true;
    return;
  }
  if (columnType) {
    const coerced = coerceByColumnType(text, columnType);
    if (!coerced.ok) {
      session.editWarning = `Could not set "${column}" to "${text}" as ${columnType}`;
      return;
    }
    session.editWarning = undefined;
    row.cells[column] = { editable: true, value: coerced.value };
    stage.dirty = true;
    return;
  }

  session.editWarning = undefined;
  row.cells[column] = {
    editable: true,
    value: coerceCellValue(previous, text),
  };
  stage.dirty = true;
}

function emptyRow(columns: string[], columnTypes: Record<string, KpsColumnType>): KpsRow {
  const cells: KpsRow['cells'] = {};
  for (const column of columns) {
    cells[column] = { editable: true, value: defaultValueForColumnType(columnTypes[column]) };
  }
  return { cells, extra: {}, keyOrder: [...columns] };
}

export function addRow(session: KpsSession, tableName: string, stageId: string): void {
  const table = session.tables[tableName];
  if (!table) {
    throw new Error(`Unknown table: ${tableName}`);
  }
  const stage = requirePresentStage(session, tableName, stageId);
  stage.rows.push(emptyRow(table.columns, table.columnTypes));
  stage.dirty = true;
}

export function removeRow(
  session: KpsSession,
  tableName: string,
  stageId: string,
  rowIndex: number,
): void {
  const stage = requirePresentStage(session, tableName, stageId);
  if (rowIndex < 0 || rowIndex >= stage.rows.length) {
    throw new Error(`Row index out of range: ${rowIndex}`);
  }
  stage.rows.splice(rowIndex, 1);
  stage.dirty = true;
}

export function createMissing(session: KpsSession, tableName: string, stageId: string): void {
  const table = session.tables[tableName];
  if (!table) {
    throw new Error(`Unknown table: ${tableName}`);
  }
  const stage = table.stages[stageId];
  if (!stage) {
    throw new Error(`Unknown stage: ${stageId}`);
  }
  if (stage.status !== 'missing') {
    throw new Error(`Stage ${stageId} is not missing`);
  }
  stage.status = 'present';
  stage.rows = [];
  stage.parseError = undefined;
  stage.dirty = true;
}

export function isSessionDirty(session: KpsSession): boolean {
  for (const table of Object.values(session.tables)) {
    for (const stage of Object.values(table.stages)) {
      if (stage.dirty) {
        return true;
      }
    }
  }
  return false;
}
