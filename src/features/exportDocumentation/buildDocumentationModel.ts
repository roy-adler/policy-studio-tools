import type { CircuitIndex, IndexedPolicyFile, ParsedCircuit, ParsedFilter } from '../circuitSearch/types';
import type {
  AttributeOperation,
  AttributeRef,
  AttributeIndexEntry,
  BackendUrl,
  BuildDocumentationOptions,
  CircuitDoc,
  DocIndices,
  DocumentationModel,
  FilterDoc,
  RoutingPath,
  ScriptDoc,
} from './types';

export const DEFAULT_SCRIPT_LINE_THRESHOLD = 20;

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

const METHOD_PATTERNS = [
  /<method>([^<]+)<\/method>/gi,
  /method\s*=\s*["']([^"']+)["']/gi,
  /<fval\s+name\s*=\s*["']method["'][^>]*>\s*<value>([^<]*)<\/value>/gi,
  /\bmethod\s*:\s*([A-Z]+)\b/gi,
];

const XML_COMMENT_PATTERN = /<!--([\s\S]*?)-->/;
const YAML_COMMENT_PATTERN = /^#\s*(.+)$/m;

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

function extractRoutingPaths(filter: ParsedFilter): RoutingPath[] {
  const paths = collectPatternValues(filter.content, PATH_PATTERNS);
  const methods = collectPatternValues(filter.content, METHOD_PATTERNS);
  const method = methods[0];

  return paths.map((pathValue) => ({
    path: pathValue,
    filterName: filter.name,
    method,
  }));
}

function extractBackendUrls(filter: ParsedFilter): BackendUrl[] {
  const urls = collectPatternValues(filter.content, URL_PATTERNS);
  return urls.map((url) => ({
    url,
    filterName: filter.name,
  }));
}

function inferAttributeOperation(filter: ParsedFilter): AttributeOperation {
  const type = filter.type?.toLowerCase() ?? '';
  if (type.includes('set') || type.includes('change')) {
    return 'set';
  }
  if (type.includes('get')) {
    return 'get';
  }
  return 'unknown';
}

function inferScriptLanguage(filter: ParsedFilter): string | undefined {
  const type = filter.type?.toLowerCase() ?? '';
  if (type.includes('javascript')) {
    return 'javascript';
  }
  if (type.includes('groovy')) {
    return 'groovy';
  }
  return undefined;
}

function buildScriptDoc(
  filter: ParsedFilter,
  sourceFilePath: string,
  threshold: number,
): ScriptDoc | undefined {
  if (!filter.script?.trim()) {
    return undefined;
  }

  const lines = filter.script.split(/\r?\n/);
  const lineCount = lines.length;
  const truncated = lineCount > threshold;
  const content = truncated ? lines.slice(0, threshold).join('\n') : filter.script;

  return {
    filterName: filter.name,
    language: inferScriptLanguage(filter),
    content,
    truncated,
    lineCount,
    sourceFilePath,
  };
}

function extractDescription(file: IndexedPolicyFile, circuit: ParsedCircuit): string | undefined {
  const beforeCircuit = file.content.slice(0, circuit.startOffset);
  const xmlComment = XML_COMMENT_PATTERN.exec(beforeCircuit)?.[1]?.trim();
  if (xmlComment) {
    return xmlComment.split('\n').map((line) => line.trim()).join(' ').trim();
  }

  const yamlComment = YAML_COMMENT_PATTERN.exec(file.content)?.[1]?.trim();
  if (yamlComment) {
    return yamlComment;
  }

  return undefined;
}

function collectReferencedCircuits(filter: ParsedFilter): string[] {
  const refs = [...filter.referencedCircuits];
  if (filter.circuitRef) {
    refs.push(filter.circuitRef);
  }
  return uniqueStrings(refs);
}

function buildFilterDoc(
  filter: ParsedFilter,
  order: number,
  sourceFilePath: string,
  scriptLineThreshold: number,
): FilterDoc {
  return {
    name: filter.name,
    type: filter.type,
    order,
    attributes: filter.attributes.map((name) => ({
      name,
      filterName: filter.name,
      operation: inferAttributeOperation(filter),
    })),
    referencedCircuits: collectReferencedCircuits(filter),
    script: buildScriptDoc(filter, sourceFilePath, scriptLineThreshold),
    routingPaths: extractRoutingPaths(filter),
    backendUrls: extractBackendUrls(filter),
  };
}

function buildCircuitDoc(
  file: IndexedPolicyFile,
  circuit: ParsedCircuit,
  scriptLineThreshold: number,
): CircuitDoc {
  return {
    name: circuit.name,
    sourceFilePath: file.relativePath,
    description: extractDescription(file, circuit),
    startFilter: circuit.startFilter,
    filters: circuit.filters.map((filter, index) =>
      buildFilterDoc(filter, index + 1, file.relativePath, scriptLineThreshold),
    ),
  };
}

function matchesCircuitFilter(circuitName: string, filter?: string[]): boolean {
  if (!filter || filter.length === 0) {
    return true;
  }
  const normalized = circuitName.trim().toLowerCase();
  return filter.some((entry) => entry.trim().toLowerCase() === normalized);
}

function buildReferenceGraphSummary(circuits: CircuitDoc[]): string {
  const references = new Map<string, Set<string>>();

  for (const circuit of circuits) {
    for (const filter of circuit.filters) {
      for (const referenced of filter.referencedCircuits) {
        const targets = references.get(circuit.name) ?? new Set<string>();
        targets.add(referenced);
        references.set(circuit.name, targets);
      }
    }
  }

  if (references.size === 0) {
    return 'No outbound circuit references detected.';
  }

  const lines = [...references.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([source, targets]) => `${source} → ${[...targets].sort().join(', ')}`);

  return lines.join('; ');
}

function buildIndices(circuits: CircuitDoc[]): DocIndices {
  const pathTemplates: DocIndices['pathTemplates'] = [];
  const backendUrls: DocIndices['backendUrls'] = [];
  const attributeMap = new Map<string, AttributeIndexEntry>();

  for (const circuit of circuits) {
    for (const filter of circuit.filters) {
      for (const route of filter.routingPaths) {
        pathTemplates.push({
          path: route.path,
          circuitName: circuit.name,
          filterName: filter.name,
        });
      }

      for (const backend of filter.backendUrls) {
        backendUrls.push({
          url: backend.url,
          circuitName: circuit.name,
          filterName: filter.name,
        });
      }

      for (const attribute of filter.attributes) {
        const existing = attributeMap.get(attribute.name) ?? {
          name: attribute.name,
          occurrences: [],
        };
        existing.occurrences.push({
          circuitName: circuit.name,
          filterName: filter.name,
          operation: attribute.operation,
        });
        attributeMap.set(attribute.name, existing);
      }
    }
  }

  pathTemplates.sort((a, b) => a.path.localeCompare(b.path) || a.circuitName.localeCompare(b.circuitName));
  backendUrls.sort((a, b) => a.url.localeCompare(b.url) || a.circuitName.localeCompare(b.circuitName));

  const attributes = [...attributeMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  return { pathTemplates, backendUrls, attributes };
}

function dedupeBackendUrlsPerCircuit(circuits: CircuitDoc[]): CircuitDoc[] {
  return circuits.map((circuit) => ({
    ...circuit,
    filters: circuit.filters.map((filter) => {
      const seen = new Set<string>();
      const backendUrls = filter.backendUrls.filter((entry) => {
        if (seen.has(entry.url)) {
          return false;
        }
        seen.add(entry.url);
        return true;
      });
      return { ...filter, backendUrls };
    }),
  }));
}

export function buildDocumentationModel(
  index: CircuitIndex,
  options: BuildDocumentationOptions = {},
): DocumentationModel {
  const scriptLineThreshold = options.scriptLineThreshold ?? DEFAULT_SCRIPT_LINE_THRESHOLD;
  const circuits: CircuitDoc[] = [];

  for (const file of index.files) {
    for (const circuit of file.circuits) {
      if (!matchesCircuitFilter(circuit.name, options.circuitNameFilter)) {
        continue;
      }

      circuits.push(buildCircuitDoc(file, circuit, scriptLineThreshold));
    }
  }

  circuits.sort((a, b) => a.name.localeCompare(b.name) || a.sourceFilePath.localeCompare(b.sourceFilePath));

  const dedupedCircuits = dedupeBackendUrlsPerCircuit(circuits);
  const filterCount = dedupedCircuits.reduce((total, circuit) => total + circuit.filters.length, 0);
  const entryPoints = dedupedCircuits
    .filter((circuit) => circuit.startFilter)
    .map((circuit) => `${circuit.name} (${circuit.startFilter})`);

  const warnings = index.invalidFiles.map((filePath) => `Unparseable policy file: ${filePath}`);

  return {
    metadata: {
      projectName: index.project.displayName,
      projectId: index.projectId,
      workspacePath: index.project.rootPath,
      exportedAt: (options.exportedAt ?? new Date()).toISOString(),
      toolVersion: options.toolVersion ?? '0.0.1',
      circuitCount: dedupedCircuits.length,
      filterCount,
      entryPoints,
      referenceGraphSummary: buildReferenceGraphSummary(dedupedCircuits),
    },
    circuits: dedupedCircuits,
    indices: buildIndices(dedupedCircuits),
    warnings,
  };
}
