export type DiffSourceKind = 'directory' | 'fileSet' | 'git';

export interface DiffSourceDirectory {
  kind: 'directory';
  path: string;
}

export interface DiffSourceFileSet {
  kind: 'fileSet';
  files: string[];
  rootPath: string;
}

/** Git integration deferred — shape reserved for future adapters. */
export interface DiffSourceGit {
  kind: 'git';
  repoPath: string;
  leftRef: string;
  rightRef: string;
}

export type DiffSource = DiffSourceDirectory | DiffSourceFileSet | DiffSourceGit;

export interface SemanticFilter {
  name: string;
  type?: string;
  order: number;
  script?: string;
  attributes: string[];
  referencedCircuits: string[];
  pathTemplates: string[];
  backendUrls: string[];
}

export interface SemanticCircuit {
  name: string;
  sourceFilePath: string;
  startFilter?: string;
  filters: SemanticFilter[];
}

export interface PolicySnapshot {
  label: string;
  rootPath: string;
  projectType: 'xml' | 'yaml';
  circuits: SemanticCircuit[];
  policyFiles: string[];
  unparseableFiles: string[];
}

export type ChangeKind = 'added' | 'removed' | 'modified' | 'reordered';

export interface CircuitChange {
  circuitName: string;
  sourceFilePath: string;
}

export interface CircuitRenameChange {
  sourceFilePath: string;
  beforeName: string;
  afterName: string;
}

export interface FilterChange {
  kind: ChangeKind;
  circuitName: string;
  filterName: string;
  sourceFilePath: string;
}

export interface ScriptChange {
  circuitName: string;
  filterName: string;
  sourceFilePath: string;
  before: string;
  after: string;
}

export interface PathTemplateChange {
  circuitName: string;
  filterName: string;
  sourceFilePath: string;
  before: string;
  after: string;
}

export interface BackendUrlChange {
  circuitName: string;
  filterName: string;
  sourceFilePath: string;
  before: string;
  after: string;
}

export interface ReferenceChange {
  circuitName: string;
  filterName: string;
  sourceFilePath: string;
  before: string[];
  after: string[];
}

export interface ModifiedCircuitChange {
  circuitName: string;
  sourceFilePath: string;
  filterChanges: FilterChange[];
  scriptChanges: ScriptChange[];
  pathChanges: PathTemplateChange[];
  urlChanges: BackendUrlChange[];
  referenceChanges: ReferenceChange[];
  startFilterChange?: { before?: string; after?: string };
}

export interface DiffSummary {
  addedCircuits: number;
  removedCircuits: number;
  modifiedCircuits: number;
  renamedCircuits: number;
  addedFilters: number;
  removedFilters: number;
  modifiedFilters: number;
  reorderedFilters: number;
  scriptChanges: number;
  pathChanges: number;
  urlChanges: number;
  referenceChanges: number;
  leftOnlyFiles: number;
  rightOnlyFiles: number;
  unparseableLeft: number;
  unparseableRight: number;
}

export interface PolicyDiffReport {
  leftLabel: string;
  rightLabel: string;
  summary: DiffSummary;
  addedCircuits: CircuitChange[];
  removedCircuits: CircuitChange[];
  renamedCircuits: CircuitRenameChange[];
  modifiedCircuits: ModifiedCircuitChange[];
  leftOnlyFiles: string[];
  rightOnlyFiles: string[];
  unparseableLeft: string[];
  unparseableRight: string[];
  formattingOnlyNote: string;
  identical: boolean;
}
