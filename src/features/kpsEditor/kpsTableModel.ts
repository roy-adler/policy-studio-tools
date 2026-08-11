import * as path from 'path';
import type { KpsStageDiscovery } from './types';
import type {
  KpsCell,
  KpsRow,
  KpsScalar,
  KpsSession,
  KpsStageTable,
  KpsTableModel,
} from './types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is KpsScalar {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function parseRow(obj: Record<string, unknown>): KpsRow {
  const cells: Record<string, KpsCell> = {};
  const extra: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (isScalar(value)) {
      cells[key] = { editable: true, value };
    } else {
      cells[key] = {
        editable: false,
        nested: value,
        warning: `Non-scalar value at "${key}" is not editable`,
      };
      extra[key] = value;
    }
  }

  return { cells, extra };
}

function collectColumns(
  stageIds: string[],
  tableName: string,
  stageTables: Record<string, KpsStageTable>,
): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();

  for (const stageId of stageIds) {
    const stageTable = stageTables[stageId];
    if (!stageTable || stageTable.status !== 'present') {
      continue;
    }
    for (const row of stageTable.rows) {
      for (const key of Object.keys(row.cells)) {
        if (!seen.has(key)) {
          seen.add(key);
          columns.push(key);
        }
      }
    }
  }

  // Ensure columns appear even when only referenced later — already covered.
  void tableName;
  return columns;
}

function ensureRowCellsHaveColumns(row: KpsRow, columns: string[]): void {
  for (const column of columns) {
    if (!(column in row.cells)) {
      row.cells[column] = { editable: true, value: '' };
    }
  }
}

/**
 * Build a session from discovery + raw file contents.
 * `fileContents` keys are `${stageId}/${tableName}`; `null` means missing file.
 */
export function buildKpsSession(
  kpsRoot: string,
  discovery: KpsStageDiscovery,
  fileContents: Record<string, string | null>,
): KpsSession {
  const warnings: string[] = [];
  const stageIds = discovery.stages.map((stage) => stage.id);
  const tables: Record<string, KpsTableModel> = {};

  for (const tableName of discovery.tableNames) {
    const stageTables: Record<string, KpsStageTable> = {};

    for (const stage of discovery.stages) {
      const key = `${stage.id}/${tableName}`;
      const filePath = path.join(stage.stageDir, tableName);
      const content = fileContents[key];

      if (content === null || content === undefined) {
        stageTables[stage.id] = {
          stageId: stage.id,
          filePath,
          status: 'missing',
          rows: [],
          dirty: false,
        };
        warnings.push(`Missing ${tableName} in stage ${stage.id}`);
        continue;
      }

      try {
        const parsed: unknown = JSON.parse(content);
        if (!Array.isArray(parsed)) {
          throw new Error('JSON root must be an array');
        }

        const rows: KpsRow[] = [];
        for (const item of parsed) {
          if (!isPlainObject(item)) {
            throw new Error('Array items must be objects');
          }
          rows.push(parseRow(item));
        }

        stageTables[stage.id] = {
          stageId: stage.id,
          filePath,
          status: 'present',
          rows,
          dirty: false,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stageTables[stage.id] = {
          stageId: stage.id,
          filePath,
          status: 'error',
          parseError: message,
          rows: [],
          dirty: false,
        };
        warnings.push(`Invalid JSON for ${tableName} in stage ${stage.id}: ${message}`);
      }
    }

    const columns = collectColumns(stageIds, tableName, stageTables);
    for (const stageId of stageIds) {
      const stageTable = stageTables[stageId];
      if (stageTable?.status === 'present') {
        for (const row of stageTable.rows) {
          ensureRowCellsHaveColumns(row, columns);
        }
      }
    }

    tables[tableName] = { tableName, columns, stages: stageTables };
  }

  return {
    kpsRoot,
    stageIds,
    tableNames: [...discovery.tableNames],
    tables,
    warnings,
  };
}
