export type KpsColumnType = 'string' | 'boolean' | 'integer' | 'number';
export type KpsScalar = string | number | boolean | null;

export interface KpsStage {
  id: string;
  stageDir: string;
}

export interface KpsStageDiscovery {
  kpsRoot: string;
  stages: KpsStage[];
  tableNames: string[];
  skippedDirs: string[];
}

export interface KpsCell {
  editable: boolean;
  value?: KpsScalar;
  nested?: unknown;
  warning?: string;
}

export interface KpsRow {
  cells: Record<string, KpsCell>;
  /** Non-scalar / unknown keys preserved for write-back. */
  extra: Record<string, unknown>;
  /** Original JSON key order; new keys are appended on write. */
  keyOrder: string[];
}

export type KpsStageTableStatus = 'present' | 'missing' | 'error';

export interface KpsStageTable {
  stageId: string;
  filePath: string;
  status: KpsStageTableStatus;
  parseError?: string;
  rows: KpsRow[];
  dirty: boolean;
}

export interface KpsTableModel {
  tableName: string;
  columns: string[];
  schemaColumns: string[];
  columnTypes: Record<string, KpsColumnType>;
  storeGroupPath?: string;
  typeGroupPath?: string;
  stages: Record<string, KpsStageTable>;
}

export interface KpsSession {
  kpsRoot: string;
  stageIds: string[];
  tableNames: string[];
  tables: Record<string, KpsTableModel>;
  warnings: string[];
  editWarning?: string;
}
