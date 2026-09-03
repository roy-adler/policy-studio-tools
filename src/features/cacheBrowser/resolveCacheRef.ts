import type { ParsedCache } from './types';

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function lastSegment(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function uniqueMatch(
  caches: ParsedCache[],
  predicate: (cache: ParsedCache) => boolean,
): ParsedCache | undefined {
  const matches = caches.filter(predicate);
  return matches.length === 1 ? matches[0] : undefined;
}

export function resolveCacheRef(
  value: string,
  caches: ParsedCache[],
): ParsedCache | undefined {
  const raw = stripQuotes(value);
  if (!raw) {
    return undefined;
  }

  const byPk = uniqueMatch(caches, (cache) => cache.yamlPk === raw);
  if (byPk) {
    return byPk;
  }

  const segment = lastSegment(raw);
  const bySegment = uniqueMatch(
    caches,
    (cache) => cache.name === segment || lastSegment(cache.yamlPk) === segment,
  );
  if (raw.includes('/') || raw.includes('\\') || raw.startsWith('./')) {
    return bySegment;
  }

  return uniqueMatch(caches, (cache) => cache.name === raw);
}
