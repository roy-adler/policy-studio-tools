export type EnvScalar = string | number | boolean | null;

export interface EnvStage {
  id: string;
  valuesFilePath: string;
}

export interface EnvStageDiscovery {
  envRoot: string;
  stages: EnvStage[];
  skippedDirs: string[];
}

export type EnvCellState =
  | { kind: 'value'; value: EnvScalar }
  | { kind: 'missing' }
  | { kind: 'conflict'; detail: string };

export interface EnvTreeNode {
  name: string;
  path: string;
  children?: EnvTreeNode[];
  /** Present only on leaves */
  cells?: Record<string, EnvCellState>;
}

export interface EnvStageDocument {
  stageId: string;
  filePath: string;
  /** Nested plain object; maps only + scalar leaves */
  data: Record<string, unknown>;
  parseError?: string;
  dirty: boolean;
}

export interface EnvValuesModel {
  envRoot: string;
  stages: EnvStage[];
  documents: Record<string, EnvStageDocument>;
  tree: EnvTreeNode[];
  warnings: string[];
}
