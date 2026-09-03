import * as path from 'path';
import type { CacheKind, ParsedCache } from './types';

const KNOWN_FILTERS = new Set(['cacheattribute', 'iscached', 'removecachedattribute']);
const CACHE_FIELDS = new Set(['cache', 'cachetouse']);

export function classifyCacheKind(entityType: string): CacheKind {
  const normalized = entityType.trim().toLowerCase();
  if (normalized === 'cache') {
    return 'local';
  }
  if (normalized === 'distributedcache') {
    return 'distributed';
  }
  return 'other';
}

export function isKnownCachingFilterType(entityType: string): boolean {
  return KNOWN_FILTERS.has(entityType.trim().toLowerCase().replace(/filter$/, ''));
}

export function isCacheFieldName(fieldName: string): boolean {
  return CACHE_FIELDS.has(fieldName.trim().toLowerCase());
}

export function toYamlPk(projectRoot: string, filePath: string): string {
  const relative = path.relative(projectRoot, filePath).replace(/\\/g, '/');
  return `/${relative.replace(/\.(ya?ml)$/i, '')}`;
}

export function cacheId(cache: ParsedCache): string {
  return `${cache.projectId}::${cache.filePath}::${cache.startOffset}`;
}

export function cacheListHint(cache: ParsedCache): string {
  if ((cache.fields.eternal ?? '').toLowerCase() === 'true') {
    return 'eternal';
  }
  const ttl = cache.fields.timeToLiveSeconds;
  return ttl ? `TTL ${ttl}s` : '';
}

export function scalarFieldMap(fields: unknown): Record<string, string> {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = String(value);
    }
  }
  return out;
}
