export type TraceEntryStatus = 'success' | 'failure' | 'skipped' | 'unknown';

export interface TraceHeader {
  name: string;
  value: string;
}

export interface TraceAttribute {
  name: string;
  value: string;
}

export interface TraceError {
  message: string;
}

export interface TraceEntry {
  id: string;
  name: string;
  type?: string;
  status: TraceEntryStatus;
  duration?: number;
  requestHeaders: TraceHeader[];
  responseHeaders: TraceHeader[];
  requestBody?: string;
  responseBody?: string;
  attributes: TraceAttribute[];
  error?: TraceError;
  children: TraceEntry[];
  failed: boolean;
}

export interface TraceMetadata {
  fileName?: string;
  fileSize?: number;
  timestamp?: string;
  service?: string;
}

export interface TraceParseWarning {
  message: string;
}

export interface TraceDocument {
  metadata: TraceMetadata;
  entries: TraceEntry[];
  warnings: TraceParseWarning[];
  parseError?: string;
  hasFailures: boolean;
}

export interface TraceSearchMatch {
  entryId: string;
  path: string[];
}
