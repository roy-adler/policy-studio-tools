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
  | { kind: 'list'; values: EnvScalar[] }
  | { kind: 'missing' }
  | { kind: 'conflict'; detail: string };

export interface EnvTreeNode {
  name: string;
  path: string;
  children?: EnvTreeNode[];
  /** Present only on leaves */
  cells?: Record<string, EnvCellState>;
}

/** How a scalar was written in the original YAML (used on save). */
export type EnvScalarQuoteStyle = 'plain' | 'single' | 'double' | 'literal' | 'folded';

/** How a sequence was indented relative to its key. */
export type EnvListIndentStyle = 'compact' | 'indented';

export interface EnvYamlStyle {
  documentStart: boolean;
  /** Dotted path → quote style for scalar leaves */
  quotes: Record<string, EnvScalarQuoteStyle>;
  /** Dotted path → quote style for list items (`path[0]`, `path[1]`, …) */
  listItemQuotes: Record<string, EnvScalarQuoteStyle>;
  /** Dotted path → list indentation style */
  lists: Record<string, EnvListIndentStyle>;
}

export interface EnvStageDocument {
  stageId: string;
  filePath: string;
  /** Nested plain object; maps only + scalar leaves */
  data: Record<string, unknown>;
  /** Original YAML formatting hints for write-back */
  style?: EnvYamlStyle;
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

export interface EnvTextRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface EnvAttributePlaceholder {
  envKey: string;
  startOffset: number;
  endOffset: number;
}

export interface EnvAttributeUsage {
  envKey: string;
  absolutePath: string;
  relativePath: string;
  /** 1-based line for display */
  line: number;
  range: EnvTextRange;
}

export interface EnvUsageScan {
  byKey: Record<string, EnvAttributeUsage[]>;
  warnings: string[];
  projectCount: number;
}
