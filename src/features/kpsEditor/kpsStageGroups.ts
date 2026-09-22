import type { KpsRow, KpsSession, KpsTableModel } from './types';

export interface KpsStageGroup {
  memberIds: string[];
  label: string;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = stableValue(record[key]);
    }
    return sorted;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function rowContent(row: KpsRow): Record<string, unknown> {
  const keys = new Set([...Object.keys(row.cells), ...Object.keys(row.extra)]);
  const content: Record<string, unknown> = {};
  for (const key of keys) {
    const cell = row.cells[key];
    if (cell?.editable) {
      content[key] = cell.value === undefined ? '' : cell.value;
      continue;
    }
    if (key in row.extra) {
      content[key] = row.extra[key];
      continue;
    }
    if (cell && cell.nested !== undefined) {
      content[key] = cell.nested;
    }
  }
  return content;
}

function stageSignature(rows: KpsRow[]): string {
  return rows
    .map((row) => stableStringify(rowContent(row)))
    .sort()
    .join('\n');
}

export function findStageGroups(table: KpsTableModel, stageIds: string[]): KpsStageGroup[] {
  const bySignature = new Map<string, string[]>();
  for (const stageId of stageIds) {
    const stage = table.stages[stageId];
    if (!stage || stage.status !== 'present') {
      continue;
    }
    const signature = stageSignature(stage.rows);
    const members = bySignature.get(signature) ?? [];
    members.push(stageId);
    bySignature.set(signature, members);
  }

  const groups: KpsStageGroup[] = [];
  for (const memberIds of bySignature.values()) {
    if (memberIds.length < 2) {
      continue;
    }
    groups.push({ memberIds: [...memberIds], label: memberIds.join('/') });
  }
  groups.sort(
    (a, b) => stageIds.indexOf(a.memberIds[0]) - stageIds.indexOf(b.memberIds[0]),
  );
  return groups;
}

export type KpsStageTarget =
  | { kind: 'group'; memberIds: string[] }
  | { kind: 'stage'; stageId: string };

function sameMemberSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const ids = new Set(left);
  return right.every((id) => ids.has(id));
}

export function isExactStageGroup(
  table: KpsTableModel,
  stageIds: string[],
  memberIds: string[],
): boolean {
  return findStageGroups(table, stageIds).some((group) =>
    sameMemberSet(group.memberIds, memberIds),
  );
}

export function defaultStageTarget(table: KpsTableModel, stageIds: string[]): KpsStageTarget {
  const groups = findStageGroups(table, stageIds);
  if (groups.length > 0) {
    const ranked = [...groups].sort((a, b) => {
      if (b.memberIds.length !== a.memberIds.length) {
        return b.memberIds.length - a.memberIds.length;
      }
      return stageIds.indexOf(a.memberIds[0]) - stageIds.indexOf(b.memberIds[0]);
    });
    return { kind: 'group', memberIds: [...ranked[0].memberIds] };
  }
  const present = stageIds.find((id) => table.stages[id]?.status === 'present');
  return { kind: 'stage', stageId: present ?? stageIds[0] ?? '' };
}

export function resolveStageTarget(
  current: KpsStageTarget,
  table: KpsTableModel,
  stageIds: string[],
): KpsStageTarget {
  if (current.kind === 'stage') {
    if (stageIds.includes(current.stageId) && table.stages[current.stageId]) {
      return current;
    }
    return defaultStageTarget(table, stageIds);
  }
  const match = findStageGroups(table, stageIds).find((group) =>
    sameMemberSet(group.memberIds, current.memberIds),
  );
  if (match) {
    return { kind: 'group', memberIds: [...match.memberIds] };
  }
  const fallback = stageIds.find((id) => current.memberIds.includes(id));
  if (fallback) {
    return { kind: 'stage', stageId: fallback };
  }
  return defaultStageTarget(table, stageIds);
}

function rowsUnchanged(left: KpsRow[], right: KpsRow[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function applyStageGroupEdit(
  session: KpsSession,
  tableName: string,
  memberIds: string[],
  edit: (stageId: string) => void,
): boolean {
  const table = session.tables[tableName];
  if (!table || !isExactStageGroup(table, session.stageIds, memberIds)) {
    return false;
  }
  const ordered = session.stageIds.filter((id) => memberIds.includes(id));
  const canonicalId = ordered[0];
  const canonical = table.stages[canonicalId];
  const originalRows = canonical.rows;
  const dirtyBefore = canonical.dirty;
  canonical.rows = structuredClone(originalRows);
  try {
    edit(canonicalId);
  } catch (error) {
    canonical.rows = originalRows;
    canonical.dirty = dirtyBefore;
    throw error;
  }
  if (rowsUnchanged(canonical.rows, originalRows) && canonical.dirty === dirtyBefore) {
    canonical.rows = originalRows;
    return true;
  }
  const result = structuredClone(canonical.rows);
  for (const stageId of ordered) {
    table.stages[stageId].rows = structuredClone(result);
    table.stages[stageId].dirty = true;
  }
  return true;
}

export function applyKpsTargetEdit(
  session: KpsSession,
  tableName: string,
  target: KpsStageTarget,
  edit: (stageId: string) => void,
): { applied: boolean; target: KpsStageTarget } {
  const table = session.tables[tableName];
  if (!table) {
    return { applied: false, target };
  }
  if (target.kind === 'stage') {
    edit(target.stageId);
    return {
      applied: true,
      target: resolveStageTarget(target, table, session.stageIds),
    };
  }
  const applied = applyStageGroupEdit(session, tableName, target.memberIds, edit);
  if (!applied) {
    return { applied: false, target };
  }
  return {
    applied: true,
    target: resolveStageTarget(target, table, session.stageIds),
  };
}
