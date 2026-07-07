import type { IndexedPolicyFile, ParsedCircuit, ParsedFilter } from '../circuitSearch/types';
import type { PolicySnapshot, SemanticCircuit, SemanticFilter } from './types';

const PATH_PATTERNS = [
  /<path>([^<]+)<\/path>/gi,
  /path\s*=\s*["']([^"']+)["']/gi,
  /<fval\s+name\s*=\s*["']path["'][^>]*>\s*<value>([^<]*)<\/value>/gi,
  /\bpath\s*:\s*(\/[^\n\r]+)/gi,
];

const URL_PATTERNS = [
  /<url>([^<]+)<\/url>/gi,
  /url\s*=\s*["']([^"']+)["']/gi,
  /<fval\s+name\s*=\s*["']url["'][^>]*>\s*<value>([^<]*)<\/value>/gi,
  /\burl\s*:\s*(https?:\/\/[^\n\r]+)/gi,
  /(https?:\/\/[^\s"'<>]+)/gi,
];

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function collectPatternValues(content: string, patterns: RegExp[]): string[] {
  const values: string[] = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      values.push(match[1].trim());
    }
  }
  return uniqueStrings(values);
}

function collectReferencedCircuits(filter: ParsedFilter): string[] {
  const refs = [...filter.referencedCircuits];
  if (filter.circuitRef) {
    refs.push(filter.circuitRef);
  }
  return uniqueStrings(refs);
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function normalizeScript(script: string | undefined): string | undefined {
  if (script === undefined) {
    return undefined;
  }
  const normalized = decodeXmlEntities(script).replace(/\r\n/g, '\n');
  return normalized
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim()
    .replace(/[ \t]+/g, ' ');
}

function buildSemanticFilter(filter: ParsedFilter, order: number): SemanticFilter {
  return {
    name: filter.name,
    type: filter.type,
    order,
    script: normalizeScript(filter.script),
    attributes: uniqueStrings(filter.attributes),
    referencedCircuits: collectReferencedCircuits(filter),
    pathTemplates: collectPatternValues(filter.content, PATH_PATTERNS),
    backendUrls: collectPatternValues(filter.content, URL_PATTERNS),
  };
}

function buildSemanticCircuit(file: IndexedPolicyFile, circuit: ParsedCircuit): SemanticCircuit {
  return {
    name: circuit.name,
    sourceFilePath: file.relativePath,
    startFilter: circuit.startFilter,
    filters: circuit.filters.map((filter, index) => buildSemanticFilter(filter, index + 1)),
  };
}

export function buildSemanticModelFromIndexedFiles(
  files: IndexedPolicyFile[],
  options: {
    label: string;
    rootPath: string;
    projectType: 'xml' | 'yaml';
    policyFiles: string[];
    unparseableFiles: string[];
  },
): PolicySnapshot {
  const circuits: SemanticCircuit[] = [];

  for (const file of files) {
    for (const circuit of file.circuits) {
      circuits.push(buildSemanticCircuit(file, circuit));
    }
  }

  circuits.sort(
    (a, b) => a.sourceFilePath.localeCompare(b.sourceFilePath) || a.name.localeCompare(b.name),
  );

  return {
    label: options.label,
    rootPath: options.rootPath,
    projectType: options.projectType,
    circuits,
    policyFiles: [...options.policyFiles].sort(),
    unparseableFiles: [...options.unparseableFiles].sort(),
  };
}

export function circuitKey(circuit: SemanticCircuit): string {
  return `${circuit.sourceFilePath}::${circuit.name}`;
}

export function filtersFingerprint(filters: SemanticFilter[]): string {
  return filters
    .map(
      (filter) =>
        [
          filter.name,
          filter.type ?? '',
          filter.script ?? '',
          filter.attributes.join(','),
          filter.referencedCircuits.join(','),
          filter.pathTemplates.join(','),
          filter.backendUrls.join(','),
        ].join('|'),
    )
    .join(';;');
}

export function filtersEqual(left: SemanticFilter, right: SemanticFilter): boolean {
  return (
    left.name === right.name &&
    (left.type ?? '') === (right.type ?? '') &&
    (left.script ?? '') === (right.script ?? '') &&
    left.attributes.join(',') === right.attributes.join(',') &&
    left.referencedCircuits.join(',') === right.referencedCircuits.join(',') &&
    left.pathTemplates.join(',') === right.pathTemplates.join(',') &&
    left.backendUrls.join(',') === right.backendUrls.join(',')
  );
}

export function circuitsSemanticallyEqual(left: SemanticCircuit, right: SemanticCircuit): boolean {
  if ((left.startFilter ?? '') !== (right.startFilter ?? '')) {
    return false;
  }
  if (left.filters.length !== right.filters.length) {
    return false;
  }
  for (let index = 0; index < left.filters.length; index += 1) {
    if (left.filters[index].name !== right.filters[index].name) {
      return false;
    }
    if (!filtersEqual(left.filters[index], right.filters[index])) {
      return false;
    }
  }
  return true;
}
