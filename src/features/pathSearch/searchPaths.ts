import type { ServicePathEntry } from './types';

function haystacks(entry: ServicePathEntry): string[] {
  return [
    entry.uriPrefix,
    entry.projectDisplayName,
    entry.interfaceName,
    entry.httpMethod ?? '',
    entry.uriMatcher ?? '',
    entry.filterCircuit ?? '',
    entry.filenameStem ?? '',
  ];
}

export function searchPaths(entries: ServicePathEntry[], query: string): ServicePathEntry[] {
  const needle = query.trim().toLowerCase();
  const filtered = !needle
    ? [...entries]
    : entries.filter((entry) =>
        haystacks(entry).some((h) => h.toLowerCase().includes(needle)),
      );
  return filtered.sort((a, b) => {
    const byPath = a.uriPrefix.localeCompare(b.uriPrefix);
    if (byPath !== 0) return byPath;
    const byProject = a.projectDisplayName.localeCompare(b.projectDisplayName);
    if (byProject !== 0) return byProject;
    return a.filePath.localeCompare(b.filePath);
  });
}
