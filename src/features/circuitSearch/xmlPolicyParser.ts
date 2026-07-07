import type { ParsedCircuit, ParsedFilter } from './types';
import { normalizeFilterNodeRef } from './textUtils';

const NAME_ID_PATTERN =
  /<id\s+[^>]*field\s*=\s*["']name["'][^>]*value\s*=\s*["']([^"']+)["'][^>]*\/?>/gi;
const NAME_ID_PATTERN_ALT =
  /<id\s+[^>]*value\s*=\s*["']([^"']+)["'][^>]*field\s*=\s*["']name["'][^>]*\/?>/gi;

const ATTRIBUTE_PATTERNS = [
  /attributeName\s*=\s*["']([^"']+)["']/gi,
  /<fval\s+name\s*=\s*["']attributeName["'][^>]*>\s*<value>([^<]*)<\/value>/gi,
  /<fval\s+name\s*=\s*["']attributeName["'][^>]*>\s*([^<]+)\s*<\/fval>/gi,
];

const CIRCUIT_REF_PATTERNS = [
  /<fval\s+name\s*=\s*["']circuit["'][^>]*>\s*<value>([^<]*)<\/value>/gi,
  /<circuitName>([^<]*)<\/circuitName>/gi,
  /successNode\s*=\s*["']([^"']+)["']/gi,
  /failureNode\s*=\s*["']([^"']+)["']/gi,
];

const SCRIPT_PATTERNS = [
  /<fval\s+name\s*=\s*["']script["'][^>]*>\s*<value>([\s\S]*?)<\/value>/gi,
  /<script>([\s\S]*?)<\/script>/gi,
];

function readFval(content: string, fieldName: string): string | undefined {
  const pattern = new RegExp(
    `<fval\\s+name\\s*=\\s*["']${fieldName}["'][^>]*>\\s*<value>([^<]*)</value>`,
    'i',
  );
  return pattern.exec(content)?.[1]?.trim() || undefined;
}

function readFlowNodeFval(content: string, fieldName: string): string | undefined {
  return normalizeFilterNodeRef(readFval(content, fieldName));
}

function lastPathSegment(value: string): string {
  return value.includes('/') ? (value.split('/').pop() ?? value) : value;
}

export function isWellFormedXml(content: string): boolean {
  const withoutCdata = content.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const tagPattern = /<(\/?)([A-Za-z_][\w.-]*)([^>]*)>/g;
  const stack: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(withoutCdata)) !== null) {
    const closing = match[1] === '/';
    const tagName = match[2];
    const rest = match[3] ?? '';

    if (rest.trimEnd().endsWith('/') || /\s\/\s*$/.test(rest)) {
      continue;
    }

    if (closing) {
      if (stack.length === 0 || stack[stack.length - 1] !== tagName) {
        return false;
      }
      stack.pop();
    } else {
      stack.push(tagName);
    }
  }

  return stack.length === 0;
}

function readAttribute(tag: string, attributeName: string): string | undefined {
  const pattern = new RegExp(`${attributeName}\\s*=\\s*"([^"]*)"`, 'i');
  const singlePattern = new RegExp(`${attributeName}\\s*=\\s*'([^']*)'`, 'i');
  return pattern.exec(tag)?.[1] ?? singlePattern.exec(tag)?.[1];
}

function readElementText(content: string, tagName: string): string | undefined {
  const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i');
  return pattern.exec(content)?.[1]?.trim();
}

function readEntityType(openTag: string): string | undefined {
  return readAttribute(openTag, 'type');
}

function collectNameMatches(content: string, startOffset: number): Array<{ name: string; offset: number }> {
  const names: Array<{ name: string; offset: number }> = [];
  for (const pattern of [NAME_ID_PATTERN, NAME_ID_PATTERN_ALT]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      names.push({
        name: match[1],
        offset: startOffset + match.index,
      });
    }
  }
  return names;
}

function collectPatternMatches(
  content: string,
  patterns: RegExp[],
  startOffset: number,
): Array<{ value: string; offset: number }> {
  const values: Array<{ value: string; offset: number }> = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      values.push({
        value: match[1].trim(),
        offset: startOffset + match.index,
      });
    }
  }
  return values;
}

function findEntityCloseIndex(content: string, openIndex: number): number {
  const entityOpen = /<entity\b[^>]*>/gi;
  const entityClose = /<\/entity>/gi;
  entityOpen.lastIndex = openIndex;
  const firstOpen = entityOpen.exec(content);
  if (!firstOpen || firstOpen.index !== openIndex) {
    return -1;
  }

  let depth = 1;
  let cursor = openIndex + firstOpen[0].length;

  while (depth > 0 && cursor < content.length) {
    entityOpen.lastIndex = cursor;
    entityClose.lastIndex = cursor;
    const nextOpen = entityOpen.exec(content);
    const nextClose = entityClose.exec(content);

    if (!nextClose) {
      return -1;
    }

    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + nextOpen[0].length;
    } else {
      depth -= 1;
      if (depth === 0) {
        return nextClose.index;
      }
      cursor = nextClose.index + nextClose[0].length;
    }
  }

  return -1;
}

function findAllEntityBlocks(content: string): Array<{
  start: number;
  end: number;
  openTag: string;
  body: string;
  type?: string;
}> {
  const blocks: Array<{
    start: number;
    end: number;
    openTag: string;
    body: string;
    type?: string;
  }> = [];
  const opener = /<entity\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = opener.exec(content)) !== null) {
    const start = match.index;
    const openTag = match[0];
    const closeIndex = findEntityCloseIndex(content, start);
    if (closeIndex < 0) {
      continue;
    }
    const end = closeIndex + '</entity>'.length;
    blocks.push({
      start,
      end,
      openTag,
      body: content.slice(start + openTag.length, closeIndex),
      type: readEntityType(openTag),
    });
    opener.lastIndex = end;
  }

  return blocks;
}

function extractFiltersFromEntityBody(
  body: string,
  bodyStartOffset: number,
  circuitName: string,
): ParsedFilter[] {
  const filters: ParsedFilter[] = [];
  const childEntities = findAllEntityBlocks(body);

  for (const child of childEntities) {
    const names = collectNameMatches(child.openTag + child.body, bodyStartOffset + child.start);
    const filterName = names.find((entry) => entry.name !== circuitName)?.name ?? names[0]?.name;
    if (!filterName) {
      continue;
    }

    const filterStart = bodyStartOffset + child.start;
    const filterEnd = bodyStartOffset + child.end;
    const localBody = child.body;

    const attributes = collectPatternMatches(localBody, ATTRIBUTE_PATTERNS, filterStart).map((m) => m.value);
    const referencedCircuits = collectPatternMatches(localBody, CIRCUIT_REF_PATTERNS, filterStart).map(
      (m) => lastPathSegment(m.value.trim()),
    );
    const scripts = collectPatternMatches(localBody, SCRIPT_PATTERNS, filterStart);
    const circuitRefValue = readFval(localBody, 'circuit');

    filters.push({
      name: filterName,
      type: child.type,
      startOffset: filterStart,
      endOffset: filterEnd,
      attributes,
      referencedCircuits,
      script: scripts[0]?.value,
      content: localBody,
      successNode: readFlowNodeFval(localBody, 'successNode'),
      failureNode: readFlowNodeFval(localBody, 'failureNode'),
      circuitRef: circuitRefValue ? lastPathSegment(circuitRefValue) : undefined,
    });
  }

  return filters;
}

function parseSimplifiedPolicyXml(content: string): ParsedCircuit[] {
  const circuits: ParsedCircuit[] = [];
  const circuitPattern = /<Circuit\b([^>]*)>([\s\S]*?)<\/Circuit>/gi;
  let circuitMatch: RegExpExecArray | null;

  while ((circuitMatch = circuitPattern.exec(content)) !== null) {
    const circuitTag = circuitMatch[1] ?? '';
    const circuitBody = circuitMatch[2] ?? '';
    const circuitName = readAttribute(`<Circuit ${circuitTag}>`, 'name');
    if (!circuitName) {
      continue;
    }

    const circuitStart = circuitMatch.index;
    const circuitEnd = circuitMatch.index + circuitMatch[0].length;
    const filters: ParsedFilter[] = [];
    const filterPattern = /<Filter\b([^>]*)>([\s\S]*?)<\/Filter>/gi;
    let filterMatch: RegExpExecArray | null;

    while ((filterMatch = filterPattern.exec(circuitBody)) !== null) {
      const filterTag = filterMatch[1] ?? '';
      const filterBody = filterMatch[2] ?? '';
      const filterName = readAttribute(`<Filter ${filterTag}>`, 'name') ?? 'UnnamedFilter';
      const filterType = readAttribute(`<Filter ${filterTag}>`, 'type');
      const filterStart = circuitStart + (filterMatch.index ?? 0);
      const filterEnd = filterStart + filterMatch[0].length;

      const attributes = collectPatternMatches(filterBody, ATTRIBUTE_PATTERNS, filterStart).map((m) => m.value);
      const referencedCircuits = collectPatternMatches(filterBody, CIRCUIT_REF_PATTERNS, filterStart).map(
        (m) => m.value,
      );
      const scripts = collectPatternMatches(filterBody, SCRIPT_PATTERNS, filterStart);
      const circuitRefValue =
        readElementText(filterBody, 'circuitName') ?? readFval(filterBody, 'circuit');

      filters.push({
        name: filterName,
        type: filterType,
        startOffset: filterStart,
        endOffset: filterEnd,
        attributes,
        referencedCircuits,
        script: scripts[0]?.value ?? readElementText(filterBody, 'script'),
        content: filterBody,
        successNode: normalizeFilterNodeRef(readAttribute(`<Filter ${filterTag}>`, 'successNode')),
        failureNode: normalizeFilterNodeRef(readAttribute(`<Filter ${filterTag}>`, 'failureNode')),
        circuitRef: circuitRefValue ? lastPathSegment(circuitRefValue) : undefined,
      });
    }

    circuits.push({
      name: circuitName,
      startOffset: circuitStart,
      endOffset: circuitEnd,
      filters,
      startFilter: normalizeFilterNodeRef(readAttribute(`<Circuit ${circuitTag}>`, 'start')),
    });
  }

  return circuits;
}

function parseAxwayEntityStoreXml(content: string): ParsedCircuit[] {
  const circuits: ParsedCircuit[] = [];
  const entities = findAllEntityBlocks(content);

  for (const entity of entities) {
    if (entity.type !== 'FilterCircuit') {
      continue;
    }

    const names = collectNameMatches(entity.openTag + entity.body, entity.start);
    const circuitName = names[0]?.name;
    if (!circuitName) {
      continue;
    }

    const bodyStart = entity.start + entity.openTag.length;
    const filters = extractFiltersFromEntityBody(entity.body, bodyStart, circuitName);

    // Read circuit-level fields from the body with child entities removed so a
    // child filter's fields are not mistaken for the circuit's.
    let circuitOwnBody = entity.body;
    for (const child of findAllEntityBlocks(entity.body)) {
      circuitOwnBody =
        circuitOwnBody.slice(0, child.start) +
        ' '.repeat(child.end - child.start) +
        circuitOwnBody.slice(child.end);
    }

    circuits.push({
      name: circuitName,
      startOffset: entity.start,
      endOffset: entity.end,
      filters,
      startFilter: readFlowNodeFval(circuitOwnBody, 'start'),
    });
  }

  return circuits;
}

function mergeCircuits(primary: ParsedCircuit[], secondary: ParsedCircuit[]): ParsedCircuit[] {
  const byName = new Map<string, ParsedCircuit>();
  for (const circuit of [...primary, ...secondary]) {
    const existing = byName.get(circuit.name);
    if (!existing || circuit.filters.length > existing.filters.length) {
      byName.set(circuit.name, circuit);
    }
  }
  return [...byName.values()];
}

export function parsePolicyXml(content: string): { circuits: ParsedCircuit[]; error?: string } {
  const simplified = parseSimplifiedPolicyXml(content);
  const axway = parseAxwayEntityStoreXml(content);
  const circuits = mergeCircuits(simplified, axway);
  const malformed = !isWellFormedXml(content);

  if (circuits.length > 0) {
    return { circuits, error: malformed ? 'Malformed XML' : undefined };
  }

  if (malformed) {
    return { circuits: [], error: 'Malformed XML' };
  }

  return { circuits };
}
