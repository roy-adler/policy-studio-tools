export type CacheKind = 'local' | 'distributed' | 'other';

export type CacheUsageKind = 'cache-field' | 'caching-filter';

export interface ParsedCache {
  name: string;
  kind: CacheKind;
  entityType: string;
  fields: Record<string, string>;
  yamlPk: string;
  filePath: string;
  startOffset: number;
  endOffset: number;
  projectId: string;
  projectDisplayName: string;
}

export interface CacheUsage {
  cacheId: string;
  cacheName: string;
  usageKind: CacheUsageKind;
  filePath: string;
  circuitName?: string;
  filterName?: string;
  filterType?: string;
  fieldName?: string;
  matchPreview: string;
  startOffset: number;
  projectId: string;
  projectDisplayName: string;
}

export interface CacheSession {
  caches: ParsedCache[];
  usages: CacheUsage[];
  warnings: string[];
  projectLabel: string;
}
