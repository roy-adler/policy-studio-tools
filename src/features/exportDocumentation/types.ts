export interface DocMetadata {
  projectName: string;
  projectId: string;
  workspacePath: string;
  exportedAt: string;
  toolVersion: string;
  circuitCount: number;
  filterCount: number;
  entryPoints: string[];
  referenceGraphSummary: string;
}

export type AttributeOperation = 'get' | 'set' | 'unknown';

export interface AttributeRef {
  name: string;
  filterName: string;
  operation: AttributeOperation;
}

export interface ScriptDoc {
  filterName: string;
  language?: string;
  content: string;
  truncated: boolean;
  lineCount: number;
  sourceFilePath: string;
}

export interface RoutingPath {
  method?: string;
  path: string;
  filterName: string;
}

export interface BackendUrl {
  url: string;
  filterName: string;
}

export interface FilterDoc {
  name: string;
  type?: string;
  order: number;
  attributes: AttributeRef[];
  referencedCircuits: string[];
  script?: ScriptDoc;
  routingPaths: RoutingPath[];
  backendUrls: BackendUrl[];
}

export interface CircuitDoc {
  name: string;
  sourceFilePath: string;
  description?: string;
  startFilter?: string;
  filters: FilterDoc[];
}

export interface PathTemplateIndexEntry {
  path: string;
  circuitName: string;
  filterName: string;
}

export interface BackendUrlIndexEntry {
  url: string;
  circuitName: string;
  filterName: string;
}

export interface AttributeIndexEntry {
  name: string;
  occurrences: Array<{
    circuitName: string;
    filterName: string;
    operation: AttributeOperation;
  }>;
}

export interface DocIndices {
  pathTemplates: PathTemplateIndexEntry[];
  backendUrls: BackendUrlIndexEntry[];
  attributes: AttributeIndexEntry[];
}

export interface DocumentationModel {
  metadata: DocMetadata;
  circuits: CircuitDoc[];
  indices: DocIndices;
  warnings: string[];
}

export interface BuildDocumentationOptions {
  circuitNameFilter?: string[];
  scriptLineThreshold?: number;
  toolVersion?: string;
  exportedAt?: Date;
}

export interface ExportDocumentationResult {
  filesWritten: string[];
  circuitsDocumented: number;
  warnings: string[];
}
