import * as path from 'path';
import type { KpsStageDiscovery } from './types';
import type {
  KpsCell,
  KpsColumnType,
  KpsRow,
  KpsScalar,
  KpsScalarColumnType,
  KpsSession,
  KpsStageTable,
  KpsTableModel,
} from './types';
import { coerceLoadedScalar, defaultValueForColumnType, listElementMismatch } from './kpsTypeSchema';

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

  return { cells, extra, keyOrder: Object.keys(obj) };
}

function collectColumns(
  schemaColumns: string[],
  stageIds: string[],
  stageTables: Record<string, KpsStageTable>,
): string[] {
  const columns = [...schemaColumns];
  const seen = new Set(columns);

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

  return columns;
}

function applyColumnTypes(
  rows: KpsRow[],
  columnTypes: Record<string, KpsColumnType>,
  listElementTypes: Record<string, KpsScalarColumnType>,
  tableName: string,
  stageId: string,
  warnings: string[],
): void {
  for (const row of rows) {
    for (const [column, columnType] of Object.entries(columnTypes)) {
      if (columnType === 'list') {
        const cell = row.cells[column];
        if (!cell) {
          continue;
        }
        if (Array.isArray(cell.nested) && cell.nested.every(isScalar)) {
          cell.editable = true;
          cell.value = cell.nested as KpsScalar[];
          cell.nested = undefined;
          delete row.extra[column];
          cell.warning = undefined;
          const elementType = listElementTypes[column];
          const mismatch = listElementMismatch(cell.value, elementType);
          if (mismatch) {
            cell.warning = mismatch;
            warnings.push(
              `Could not coerce ${tableName} ${stageId} column "${column}" to ${elementType} list`,
            );
          }
          continue;
        }
        if (cell.nested !== undefined) {
          continue;
        }
        if (cell.editable && !Array.isArray(cell.value)) {
          cell.warning = cell.warning ?? 'Value is not a list';
          warnings.push(`Could not coerce ${tableName} ${stageId} column "${column}" to list`);
        }
        continue;
      }

      const cell = row.cells[column];
      if (!cell?.editable || cell.value === undefined) {
        continue;
      }
      if (Array.isArray(cell.value)) {
        continue;
      }
      const coerced = coerceLoadedScalar(cell.value, columnType);
      if (coerced === undefined) {
        cell.warning = cell.warning ?? `Value is not a valid ${columnType}`;
        warnings.push(
          `Could not coerce ${tableName} ${stageId} column "${column}" to ${columnType}`,
        );
        continue;
      }
      cell.value = coerced;
    }
  }
}

function ensureRowCellsHaveColumns(
  row: KpsRow,
  columns: string[],
  columnTypes: Record<string, KpsColumnType>,
  schemaColumns: string[],
  tableName: string,
  stageId: string,
  warnings: string[],
  warned: Set<string>,
): void {
  const schemaSet = new Set(schemaColumns);

  for (const column of columns) {
    if (!(column in row.cells)) {
      const missingSchema = schemaSet.has(column);
      row.cells[column] = {
        editable: true,
        value: defaultValueForColumnType(columnTypes[column]),
        warning: missingSchema ? 'Missing from JSON' : undefined,
      };
      if (missingSchema) {
        const key = `${tableName}:${stageId}:missing:${column}`;
        if (!warned.has(key)) {
          warned.add(key);
          warnings.push(
            `${tableName} in ${stageId} is missing Type Group property "${column}"`,
          );
        }
      }
      continue;
    }

    if (schemaSet.size > 0 && !schemaSet.has(column)) {
      const cell = row.cells[column];
      cell.warning = cell.warning ?? 'Not in Type Group';
      const key = `${tableName}:${stageId}:extra:${column}`;
      if (!warned.has(key)) {
        warned.add(key);
        warnings.push(
          `${tableName} in ${stageId} has unexpected property "${column}" not in Type Group`,
        );
      }
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
  columnTypesByTable: Record<string, Record<string, KpsColumnType>> = {},
  schemaColumnsByTable: Record<string, string[]> = {},
  schemaFilesByTable: Record<string, { storeGroupPath: string; typeGroupPath: string }> = {},
  listElementTypesByTable: Record<string, Record<string, KpsScalarColumnType>> = {},
): KpsSession {
  const warnings: string[] = [];
  const stageIds = discovery.stages.map((stage) => stage.id);
  const tables: Record<string, KpsTableModel> = {};

  for (const tableName of discovery.tableNames) {
    const stageTables: Record<string, KpsStageTable> = {};
    const columnTypes = columnTypesByTable[tableName] ?? {};
    const listElementTypes = listElementTypesByTable[tableName] ?? {};
    const schemaColumns = schemaColumnsByTable[tableName] ?? [];

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

        applyColumnTypes(rows, columnTypes, listElementTypes, tableName, stage.id, warnings);

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

    const columns = collectColumns(schemaColumns, stageIds, stageTables);
    const warned = new Set<string>();
    for (const stageId of stageIds) {
      const stageTable = stageTables[stageId];
      if (stageTable?.status === 'present') {
        for (const row of stageTable.rows) {
          ensureRowCellsHaveColumns(
            row,
            columns,
            columnTypes,
            schemaColumns,
            tableName,
            stageId,
            warnings,
            warned,
          );
        }
      }
    }

    tables[tableName] = {
      tableName,
      columns,
      schemaColumns,
      columnTypes,
      listElementTypes,
      storeGroupPath: schemaFilesByTable[tableName]?.storeGroupPath,
      typeGroupPath: schemaFilesByTable[tableName]?.typeGroupPath,
      stages: stageTables,
    };
  }

  return {
    kpsRoot,
    stageIds,
    tableNames: [...discovery.tableNames],
    tables,
    warnings,
  };
}
