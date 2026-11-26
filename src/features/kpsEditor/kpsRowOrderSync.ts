import type { KpsRow, KpsSession } from './types';

/**
 * Identity of a row inside one stage: the key column's value plus its
 * occurrence number, so duplicate keys still match first-to-first.
 * Returns undefined when the row has no usable key value.
 */
export function rowKeyIds(rows: KpsRow[], keyColumn: string): Array<string | undefined> {
  const seen = new Map<string, number>();
  return rows.map((row) => {
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
    const base = JSON.stringify(value);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return `${base}#${occurrence}`;
  });
}

/**
 * Reorders `rows` so rows whose key also exists in `sourceOrder` follow the
 * source's relative order. Rows whose key is not in the source keep their
 * exact index; shared rows are redistributed over the slots shared rows
 * already occupied. Returns undefined when the order would not change.
 */
export function reorderRowsByKey(
  rows: KpsRow[],
  sourceKeyIds: Array<string | undefined>,
  keyColumn: string,
): KpsRow[] | undefined {
  const sourceIndex = new Map<string, number>();
  sourceKeyIds.forEach((id, index) => {
    if (id !== undefined) {
      sourceIndex.set(id, index);
    }
  });

  const keyIds = rowKeyIds(rows, keyColumn);
  const slots: number[] = [];
  const shared: Array<{ row: KpsRow; rank: number }> = [];
  keyIds.forEach((id, index) => {
    const rank = id === undefined ? undefined : sourceIndex.get(id);
    if (rank !== undefined) {
      slots.push(index);
      shared.push({ row: rows[index], rank });
    }
  });

  const sorted = [...shared].sort((left, right) => left.rank - right.rank);
  if (sorted.every((entry, index) => entry === shared[index])) {
    return undefined;
  }
  const result = [...rows];
  slots.forEach((slot, index) => {
    result[slot] = sorted[index].row;
  });
  return result;
}

/**
 * After a reorder in `sourceStageId`, applies the same relative order of
 * matching rows (by the table's key column) to every other present stage of
 * the table, skipping `excludeStageIds` (the stages the edit already wrote).
 * Returns the ids of stages whose order changed; those are marked dirty.
 */
export function syncRowOrderAcrossStages(
  session: KpsSession,
  tableName: string,
  sourceStageId: string,
  excludeStageIds: string[] = [],
): string[] {
  const table = session.tables[tableName];
  const keyColumn = table?.keyColumn;
  const source = table?.stages[sourceStageId];
  if (!table || !keyColumn || !source || source.status !== 'present') {
    return [];
  }

  const sourceKeyIds = rowKeyIds(source.rows, keyColumn);
  const changed: string[] = [];
  for (const stageId of session.stageIds) {
    if (stageId === sourceStageId || excludeStageIds.includes(stageId)) {
      continue;
    }
    const stage = table.stages[stageId];
    if (!stage || stage.status !== 'present') {
      continue;
    }
    const reordered = reorderRowsByKey(stage.rows, sourceKeyIds, keyColumn);
    if (reordered) {
      stage.rows = reordered;
      stage.dirty = true;
      changed.push(stageId);
    }
  }
  return changed;
}
