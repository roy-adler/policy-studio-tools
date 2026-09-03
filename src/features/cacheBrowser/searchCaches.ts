import type { ParsedCache } from './types';

export function searchCaches(caches: ParsedCache[], query: string): ParsedCache[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return caches;
  }
  return caches.filter((cache) => {
    const haystacks = [
      cache.name,
      cache.kind,
      cache.entityType,
      ...Object.keys(cache.fields),
      ...Object.values(cache.fields),
    ];
    return haystacks.some((part) => part.toLowerCase().includes(needle));
  });
}
