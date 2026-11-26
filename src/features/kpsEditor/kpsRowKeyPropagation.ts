import { emptyRow } from './kpsTableMutations';
import type { KpsRow, KpsSession } from './types';

function keyValueOf(row: KpsRow, keyColumn: string): string | undefined {
  const cell = row.cells[keyColumn];
  let value: unknown;
  if (cell?.editable) {
    value = cell.value;
  } else if (keyColumn in row.extra) {
    value = row.extra[keyColumn];
  } else if (cell && cell.nested !== undefined) {
    value = cell.nested;
  }
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return JSON.stringify(value);
}

/**
 * After the row at `rowIndex` of `sourceStageId` got a key value (typically a
 * new row whose key cell was just filled), adds a row with only that key to
 * every other present stage of the table that has no row with that key value.
 * The other cells get the same defaults as Add row. The new row is placed
 * after the nearest preceding source row whose key the stage has, else before
 * the nearest following one, else at the end, so stage order stays aligned
 * with row-order sync. `excludeStageIds` are skipped (stages the edit already
 * wrote, e.g. group members). Returns the ids of stages that got a row.
 */
export function addKeyRowToOtherStages(
  session: KpsSession,
  tableName: string,
  sourceStageId: string,
  rowIndex: number,
  excludeStageIds: string[] = [],
): string[] {
  const table = session.tables[tableName];
  const keyColumn = table?.keyColumn;
  const source = table?.stages[sourceStageId];
  if (!table || !keyColumn || !source || source.status !== 'present') {
    return [];
  }
  const sourceRow = source.rows[rowIndex];
  const key = sourceRow ? keyValueOf(sourceRow, keyColumn) : undefined;
  if (!sourceRow || key === undefined) {
    return [];
  }
  const keyCell = sourceRow.cells[keyColumn];
  const sourceKeys = source.rows.map((row) => keyValueOf(row, keyColumn));

  const changed: string[] = [];
  for (const stageId of session.stageIds) {
    if (stageId === sourceStageId || excludeStageIds.includes(stageId)) {
      continue;
    }
    const stage = table.stages[stageId];
    if (!stage || stage.status !== 'present') {
      continue;
    }
    const stageKeys = stage.rows.map((row) => keyValueOf(row, keyColumn));
    if (stageKeys.includes(key)) {
      continue;
    }

    let insertAt = stage.rows.length;
    let placed = false;
    for (let i = rowIndex - 1; i >= 0 && !placed; i -= 1) {
      const neighbour = sourceKeys[i];
      const at = neighbour === undefined ? -1 : stageKeys.lastIndexOf(neighbour);
      if (at !== -1) {
        insertAt = at + 1;
        placed = true;
      }
    }
    for (let i = rowIndex + 1; i < sourceKeys.length && !placed; i += 1) {
      const neighbour = sourceKeys[i];
      const at = neighbour === undefined ? -1 : stageKeys.indexOf(neighbour);
      if (at !== -1) {
        insertAt = at;
        placed = true;
      }
    }

    const row = emptyRow(table.columns, table.columnTypes);
    row.cells[keyColumn] = { editable: true, value: structuredClone(keyCell?.value) };
    stage.rows.splice(insertAt, 0, row);
    stage.dirty = true;
    changed.push(stageId);
  }
  return changed;
}
