import { rowKeyIds } from './kpsRowOrderSync';
import type { KpsRow, KpsSession } from './types';

/**
 * One stage's view of a row key: the matching row, or why there is none.
 * - `present`: the stage has a row with this key (first-to-first for duplicates).
 * - `absent`: the stage file exists but has no row with this key.
 * - `missing`: the table file does not exist in this stage.
 * - `error`: the table file in this stage could not be parsed.
 */
export type KpsRowStageEntry =
  | { stageId: string; status: 'present'; rowIndex: number; row: KpsRow }
  | { stageId: string; status: 'absent' }
  | { stageId: string; status: 'missing' }
  | { stageId: string; status: 'error'; parseError?: string };

/** Key ids (key value + occurrence) of every row of one stage, by row index. */
export function stageRowKeyIds(
  session: KpsSession,
  tableName: string,
  stageId: string,
): Array<string | undefined> {
  const table = session.tables[tableName];
  const stage = table?.stages[stageId];
  if (!table?.keyColumn || !stage || stage.status !== 'present') {
    return [];
  }
  return rowKeyIds(stage.rows, table.keyColumn);
}

/** Key id of one row, or undefined when the row has no key value. */
export function rowKeyIdAt(
  session: KpsSession,
  tableName: string,
  stageId: string,
  rowIndex: number,
): string | undefined {
  return stageRowKeyIds(session, tableName, stageId)[rowIndex];
}

/**
 * The row with `keyId` in every stage of the table, in discovery order.
 * Rows are matched the same way as row-order sync: by the table's key column,
 * duplicates by occurrence.
 */
export function collectRowAcrossStages(
  session: KpsSession,
  tableName: string,
  keyId: string,
): KpsRowStageEntry[] {
  const table = session.tables[tableName];
  if (!table) {
    return [];
  }
  return session.stageIds.map((stageId): KpsRowStageEntry => {
    const stage = table.stages[stageId];
    if (!stage || stage.status === 'missing') {
      return { stageId, status: 'missing' };
    }
    if (stage.status === 'error') {
      return { stageId, status: 'error', parseError: stage.parseError };
    }
    const rowIndex = stageRowKeyIds(session, tableName, stageId).indexOf(keyId);
    if (rowIndex === -1) {
      return { stageId, status: 'absent' };
    }
    return { stageId, status: 'present', rowIndex, row: stage.rows[rowIndex] };
  });
}

/** Human-readable key value of a key id (`"a"#0` → `a`). */
export function keyIdLabel(keyId: string): string {
  const hash = keyId.lastIndexOf('#');
  const raw = hash === -1 ? keyId : keyId.slice(0, hash);
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return raw;
  }
}
