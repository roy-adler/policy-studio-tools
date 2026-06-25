import type { PolicyStudioProject } from '../projectRegistry/types';
import { buildCircuitIndex } from './circuitIndex';
import {
  buildPreview,
  exactMatch,
  findMatchIndex,
  matchesLiteral,
  normalizeQuery,
  offsetToRange,
  wordBoundaryMatch,
} from './textUtils';
import type {
  CircuitIndex,
  CircuitSearchResponse,
  CircuitSearchResult,
  IndexedPolicyFile,
  MatchKind,
  SearchOptions,
} from './types';
import { DEFAULT_MAX_RESULTS, DEFAULT_PREVIEW_LENGTH } from './types';

function rankForMatch(kind: MatchKind, haystack: string, needle: string): number {
  switch (kind) {
    case 'circuitName':
      if (exactMatch(haystack, needle)) {
        return 1;
      }
      return wordBoundaryMatch(haystack, needle) ? 3 : 4;
    case 'filterName':
      if (exactMatch(haystack, needle)) {
        return 2;
      }
      return wordBoundaryMatch(haystack, needle) ? 3 : 4;
    case 'attribute':
    case 'referencedCircuit':
      return exactMatch(haystack, needle) ? 2 : wordBoundaryMatch(haystack, needle) ? 3 : 4;
    case 'script':
    case 'xmlContent':
      return wordBoundaryMatch(haystack, needle) ? 3 : 4;
  }
}

function addResult(
  results: CircuitSearchResult[],
  seen: Set<string>,
  params: Omit<CircuitSearchResult, 'rank'> & { rank: number },
): void {
  const key = [
    params.projectId,
    params.filePath,
    params.circuitName,
    params.filterName ?? '',
    params.matchKind,
    params.matchPreview,
  ].join('|');
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  results.push(params);
}

function searchIndexedFile(
  project: PolicyStudioProject,
  file: IndexedPolicyFile,
  query: string,
  previewLength: number,
  includeProjectName: boolean,
  results: CircuitSearchResult[],
  seen: Set<string>,
): void {
  for (const circuit of file.circuits) {
    if (matchesLiteral(circuit.name, query)) {
      const matchIndex = findMatchIndex(circuit.name, query);
      addResult(results, seen, {
        projectId: project.id,
        projectDisplayName: includeProjectName ? project.displayName : '',
        filePath: file.relativePath,
        circuitName: circuit.name,
        matchPreview: buildPreview(circuit.name, matchIndex, query.length, previewLength),
        matchKind: 'circuitName',
        jumpTarget: {
          filePath: file.relativePath,
          range: offsetToRange(file.content, circuit.startOffset, circuit.endOffset),
        },
        rank: rankForMatch('circuitName', circuit.name, query),
      });
    }

    for (const filter of circuit.filters) {
      if (matchesLiteral(filter.name, query)) {
        const matchIndex = findMatchIndex(filter.name, query);
        addResult(results, seen, {
          projectId: project.id,
          projectDisplayName: includeProjectName ? project.displayName : '',
          filePath: file.relativePath,
          circuitName: circuit.name,
          filterName: filter.name,
          matchPreview: buildPreview(filter.name, matchIndex, query.length, previewLength),
          matchKind: 'filterName',
          jumpTarget: {
            filePath: file.relativePath,
            range: offsetToRange(file.content, filter.startOffset, filter.endOffset),
          },
          rank: rankForMatch('filterName', filter.name, query),
        });
      }

      for (const attribute of filter.attributes) {
        if (matchesLiteral(attribute, query)) {
          const matchIndex = findMatchIndex(file.content, query);
          addResult(results, seen, {
            projectId: project.id,
            projectDisplayName: includeProjectName ? project.displayName : '',
            filePath: file.relativePath,
            circuitName: circuit.name,
            filterName: filter.name,
            matchPreview: buildPreview(file.content, matchIndex, query.length, previewLength),
            matchKind: 'attribute',
            jumpTarget: {
              filePath: file.relativePath,
              range: offsetToRange(file.content, filter.startOffset, filter.endOffset),
            },
            rank: rankForMatch('attribute', attribute, query),
          });
        }
      }

      for (const referenced of filter.referencedCircuits) {
        if (matchesLiteral(referenced, query)) {
          const matchIndex = findMatchIndex(file.content, query);
          addResult(results, seen, {
            projectId: project.id,
            projectDisplayName: includeProjectName ? project.displayName : '',
            filePath: file.relativePath,
            circuitName: circuit.name,
            filterName: filter.name,
            referencedCircuit: referenced,
            matchPreview: buildPreview(file.content, matchIndex, query.length, previewLength),
            matchKind: 'referencedCircuit',
            jumpTarget: {
              filePath: file.relativePath,
              range: offsetToRange(file.content, filter.startOffset, filter.endOffset),
            },
            rank: rankForMatch('referencedCircuit', referenced, query),
          });
        }
      }

      if (filter.script && matchesLiteral(filter.script, query)) {
        const matchIndex = findMatchIndex(filter.script, query);
        addResult(results, seen, {
          projectId: project.id,
          projectDisplayName: includeProjectName ? project.displayName : '',
          filePath: file.relativePath,
          circuitName: circuit.name,
          filterName: filter.name,
          matchPreview: buildPreview(filter.script, matchIndex, query.length, previewLength),
          matchKind: 'script',
          jumpTarget: {
            filePath: file.relativePath,
            range: offsetToRange(file.content, filter.startOffset, filter.endOffset),
          },
          rank: rankForMatch('script', filter.script, query),
        });
      }

      if (matchesLiteral(filter.content, query)) {
        const matchIndex = findMatchIndex(filter.content, query);
        addResult(results, seen, {
          projectId: project.id,
          projectDisplayName: includeProjectName ? project.displayName : '',
          filePath: file.relativePath,
          circuitName: circuit.name,
          filterName: filter.name,
          matchPreview: buildPreview(filter.content, matchIndex, query.length, previewLength),
          matchKind: 'xmlContent',
          jumpTarget: {
            filePath: file.relativePath,
            range: offsetToRange(file.content, filter.startOffset, filter.endOffset),
          },
          rank: rankForMatch('xmlContent', filter.content, query),
        });
      }
    }
  }
}

function searchPlainTextFallback(
  project: PolicyStudioProject,
  file: IndexedPolicyFile,
  query: string,
  previewLength: number,
  includeProjectName: boolean,
  results: CircuitSearchResult[],
  seen: Set<string>,
): void {
  if (!matchesLiteral(file.content, query)) {
    return;
  }

  let matchIndex = findMatchIndex(file.content, query);
  let circuitName = 'N/A';
  let filterName: string | undefined;
  let rangeStart = matchIndex;
  let rangeEnd = Math.min(file.content.length, matchIndex + query.length);

  for (const circuit of file.circuits) {
    if (matchIndex >= circuit.startOffset && matchIndex < circuit.endOffset) {
      circuitName = circuit.name;
      for (const filter of circuit.filters) {
        if (matchIndex >= filter.startOffset && matchIndex < filter.endOffset) {
          filterName = filter.name;
          rangeStart = filter.startOffset;
          rangeEnd = filter.endOffset;
          break;
        }
      }
      break;
    }
  }

  addResult(results, seen, {
    projectId: project.id,
    projectDisplayName: includeProjectName ? project.displayName : '',
    filePath: file.relativePath,
    circuitName,
    filterName,
    matchPreview: buildPreview(file.content, matchIndex, query.length, previewLength),
    matchKind: 'xmlContent',
    jumpTarget: {
      filePath: file.relativePath,
      range: offsetToRange(file.content, rangeStart, rangeEnd),
    },
    rank: 4,
  });
}

export async function searchCircuits(
  projects: PolicyStudioProject[],
  query: string,
  options: SearchOptions = {},
): Promise<CircuitSearchResponse> {
  const started = Date.now();
  const normalized = normalizeQuery(query);

  if (!normalized) {
    return {
      results: [],
      summary: {
        totalMatches: 0,
        filesScanned: 0,
        filesSkipped: 0,
        durationMs: Date.now() - started,
        emptyQuery: true,
        invalidFiles: [],
      },
    };
  }

  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const previewLength = options.previewLength ?? DEFAULT_PREVIEW_LENGTH;
  const includeProjectName = projects.length > 1;
  const results: CircuitSearchResult[] = [];
  const seen = new Set<string>();
  let filesScanned = 0;
  let filesSkipped = 0;
  const invalidFiles: string[] = [];

  for (const project of projects) {
    const index: CircuitIndex =
      options.cachedIndex && options.cachedIndex.projectId === project.id
        ? options.cachedIndex
        : await buildCircuitIndex(project);

    filesScanned += index.filesScanned;
    invalidFiles.push(...index.invalidFiles);
    filesSkipped += index.invalidFiles.length;

    for (const file of index.files) {
      const resultsBeforeFile = results.length;

      searchIndexedFile(
        project,
        file,
        normalized,
        previewLength,
        includeProjectName,
        results,
        seen,
      );

      if (results.length === resultsBeforeFile || file.parseError) {
        searchPlainTextFallback(
          project,
          file,
          normalized,
          previewLength,
          includeProjectName,
          results,
          seen,
        );
      }
    }
  }

  results.sort((a, b) => a.rank - b.rank || a.filePath.localeCompare(b.filePath));
  const limited = results.slice(0, maxResults);

  return {
    results: limited,
    summary: {
      totalMatches: limited.length,
      filesScanned,
      filesSkipped,
      durationMs: Date.now() - started,
      invalidFiles: [...new Set(invalidFiles)],
    },
  };
}
