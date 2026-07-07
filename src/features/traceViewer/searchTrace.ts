import type { TraceDocument, TraceEntry, TraceSearchMatch } from './types';

function entrySearchText(entry: TraceEntry): string {
  const parts = [
    entry.name,
    entry.type ?? '',
    entry.status,
    entry.requestBody ?? '',
    entry.responseBody ?? '',
    entry.error?.message ?? '',
    ...entry.requestHeaders.map((header) => `${header.name} ${header.value}`),
    ...entry.responseHeaders.map((header) => `${header.name} ${header.value}`),
    ...entry.attributes.map((attribute) => `${attribute.name} ${attribute.value}`),
  ];
  return parts.join('\n').toLowerCase();
}

function searchEntries(
  entries: TraceEntry[],
  query: string,
  parentPath: string[],
  matches: TraceSearchMatch[],
): void {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return;
  }

  for (const entry of entries) {
    const path = [...parentPath, entry.name];
    if (entrySearchText(entry).includes(normalized)) {
      matches.push({ entryId: entry.id, path });
    }
    searchEntries(entry.children, query, path, matches);
  }
}

export function searchTrace(document: TraceDocument, query: string): TraceSearchMatch[] {
  const matches: TraceSearchMatch[] = [];
  searchEntries(document.entries, query, [], matches);
  return matches;
}

export function filterTraceEntries(entries: TraceEntry[], query: string): TraceEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return entries;
  }

  const filterNode = (entry: TraceEntry): TraceEntry | undefined => {
    const filteredChildren = entry.children
      .map((child) => filterNode(child))
      .filter((child): child is TraceEntry => child !== undefined);

    const selfMatches = entrySearchText(entry).includes(normalized);
    if (!selfMatches && filteredChildren.length === 0) {
      return undefined;
    }

    return {
      ...entry,
      children: filteredChildren,
    };
  };

  return entries
    .map((entry) => filterNode(entry))
    .filter((entry): entry is TraceEntry => entry !== undefined);
}
