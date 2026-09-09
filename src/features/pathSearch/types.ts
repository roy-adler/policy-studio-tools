export interface TextRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface ServicePathEntry {
  uriPrefix: string;
  projectId: string;
  projectDisplayName: string;
  interfaceName: string;
  httpMethod?: string;
  uriMatcher?: string;
  filterCircuit?: string;
  filePath: string;
  uriPrefixRange: TextRange;
  filenameStem?: string;
}

export interface PathSearchResponse {
  results: ServicePathEntry[];
  warnings: string[];
  projectsScanned: number;
}
