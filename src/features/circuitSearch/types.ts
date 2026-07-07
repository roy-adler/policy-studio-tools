import type { PolicyStudioProject } from '../projectRegistry/types';

export type MatchKind =
  | 'circuitName'
  | 'filterName'
  | 'attribute'
  | 'xmlContent'
  | 'script'
  | 'referencedCircuit';

export interface TextRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface JumpTarget {
  filePath: string;
  range: TextRange;
}

export interface CircuitSearchResult {
  projectId: string;
  projectDisplayName: string;
  filePath: string;
  circuitName: string;
  filterName?: string;
  matchPreview: string;
  matchKind: MatchKind;
  referencedCircuit?: string;
  jumpTarget: JumpTarget;
  rank: number;
}

export interface SearchSummary {
  totalMatches: number;
  filesScanned: number;
  filesSkipped: number;
  durationMs: number;
  emptyQuery?: boolean;
  invalidFiles: string[];
}

export interface CircuitSearchResponse {
  results: CircuitSearchResult[];
  summary: SearchSummary;
}

export interface ParsedFilter {
  name: string;
  type?: string;
  startOffset: number;
  endOffset: number;
  attributes: string[];
  referencedCircuits: string[];
  script?: string;
  content: string;
  /** Filter name the success path links to. */
  successNode?: string;
  /** Filter name the failure path links to. */
  failureNode?: string;
  /** Circuit name referenced by delegation filters (e.g. Policy Shortcut). */
  circuitRef?: string;
}

export interface ParsedCircuit {
  name: string;
  startOffset: number;
  endOffset: number;
  filters: ParsedFilter[];
  /** Name of the filter the circuit starts with, when declared. */
  startFilter?: string;
}

export interface IndexedPolicyFile {
  absolutePath: string;
  relativePath: string;
  content: string;
  circuits: ParsedCircuit[];
  parseError?: string;
}

export interface CircuitDefinition {
  circuitName: string;
  filePath: string;
  absolutePath: string;
  range: TextRange;
}

export interface CircuitIndex {
  projectId: string;
  project: PolicyStudioProject;
  files: IndexedPolicyFile[];
  circuitByName: Map<string, CircuitDefinition[]>;
  invalidFiles: string[];
  filesScanned: number;
  builtAt: Date;
}

export interface SearchOptions {
  maxResults?: number;
  previewLength?: number;
  cachedIndex?: CircuitIndex;
}

export const DEFAULT_MAX_RESULTS = 100;
export const DEFAULT_PREVIEW_LENGTH = 120;
