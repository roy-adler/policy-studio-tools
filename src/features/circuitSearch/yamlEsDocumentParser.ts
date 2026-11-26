import { isMap, isScalar, isSeq, parseAllDocuments, type Node, type Pair, type YAMLMap } from 'yaml';
import type { ParsedCircuit, ParsedFilter } from './types';
import { normalizeFilterNodeRef } from './textUtils';

/**
 * Parses an Axway YAML entity-store policy file with a real YAML parser.
 *
 * The line-based parser in `yamlPolicyParser.ts` guesses structure from
 * indentation and key prefixes, which breaks on perfectly valid exports:
 * quoted keys, values on the next line, `logging:` blocks whose
 * `success:`/`failure:` messages look like routing links, filters that have
 * their own nested `children:` (switch cases, compare criteria), CRLF files.
 * This parser reads the document tree instead, so `fields.start`,
 * `routing.success` and `routing.failure` are always taken from where Policy
 * Studio writes them.
 *
 * Returns `undefined` when the content is not valid YAML, so the caller can
 * fall back to the tolerant line parser.
 */
export function parseYamlEsDocuments(content: string): ParsedCircuit[] | undefined {
  let documents;
  try {
    documents = parseAllDocuments(content, { prettyErrors: false });
  } catch {
    return undefined;
  }
  if (!Array.isArray(documents)) {
    return undefined;
  }

  const circuits: ParsedCircuit[] = [];
  for (const document of documents) {
    if (document.errors.length > 0) {
      return undefined;
    }
    const root = document.contents;
    if (!isMap(root)) {
      continue;
    }
    const circuit = readCircuit(root, content, document.range[0], document.range[2]);
    if (circuit) {
      circuits.push(circuit);
    }
  }
  return circuits;
}

/** True when the document declares an entity type other than FilterCircuit. */
export function declaresNonCircuitType(content: string): boolean {
  try {
    const documents = parseAllDocuments(content, { prettyErrors: false });
    if (!Array.isArray(documents) || documents.length === 0) {
      return false;
    }
    return documents.every((document) => {
      const root = document.contents;
      if (!isMap(root)) {
        return false;
      }
      const type = entityType(root);
      return type !== undefined && type !== 'FilterCircuit';
    });
  } catch {
    return false;
  }
}

function readCircuit(
  root: YAMLMap,
  content: string,
  documentStart: number,
  documentEnd: number,
): ParsedCircuit | undefined {
  const type = entityType(root);
  if (type !== undefined && type !== 'FilterCircuit') {
    return undefined;
  }

  const fields = mapValue(root, 'fields');
  const name = scalarValue(fields, 'name') ?? scalarValue(root, 'name');
  if (!name) {
    return undefined;
  }

  const childrenNode = root.get('children', true) as Node | undefined;
  if (type === undefined && !childrenNode && scalarValue(fields, 'start') === undefined) {
    // Untyped document without any circuit shape — not a policy.
    return undefined;
  }

  const filters = readChildren(childrenNode, content);
  const startRaw = scalarValue(fields, 'start') ?? scalarValue(root, 'start');

  const typePair = findPair(root, 'type') ?? findPair(mapValue(root, 'meta'), 'type');
  const typeOffset = (typePair?.key as Node | undefined)?.range?.[0];
  const circuitStart = lineStart(content, typeOffset ?? firstContentOffset(root) ?? documentStart);

  return {
    name,
    startOffset: circuitStart,
    endOffset: Math.max(documentEnd, circuitStart),
    filters,
    startFilter: normalizeFilterNodeRef(startRaw),
  };
}

function readChildren(node: Node | undefined, content: string): ParsedFilter[] {
  const filters: ParsedFilter[] = [];
  if (isSeq(node)) {
    for (const item of node.items) {
      if (isMap(item)) {
        const filter = readFilter(item, undefined, content, item.range?.[0], item.range?.[2]);
        if (filter) {
          filters.push(filter);
        }
      }
    }
  } else if (isMap(node)) {
    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : undefined;
      if (!isMap(pair.value)) {
        continue;
      }
      const keyNode = pair.key as Node | undefined;
      const filter = readFilter(
        pair.value,
        key,
        content,
        keyNode?.range?.[0] ?? pair.value.range?.[0],
        pair.value.range?.[2],
      );
      if (filter) {
        filters.push(filter);
      }
    }
  }
  return filters;
}

function readFilter(
  entity: YAMLMap,
  mapKey: string | undefined,
  content: string,
  rawStart: number | undefined,
  rawEnd: number | undefined,
): ParsedFilter | undefined {
  const fields = mapValue(entity, 'fields');
  const routing = mapValue(entity, 'routing');
  const name = scalarValue(fields, 'name') ?? mapKey;
  if (!name) {
    return undefined;
  }

  const startOffset = lineStart(content, rawStart ?? 0);
  const endOffset = nextLineStart(content, rawEnd ?? startOffset);

  const success =
    scalarValue(routing, 'success') ??
    scalarValue(routing, 'successNode') ??
    scalarValue(fields, 'successNode');
  const failure =
    scalarValue(routing, 'failure') ??
    scalarValue(routing, 'failureNode') ??
    scalarValue(fields, 'failureNode');

  const circuitRefs: string[] = [];
  const attributes: string[] = [];
  const scripts: string[] = [];
  collectFieldValues(entity, (key, value) => {
    if (key === 'circuit') {
      circuitRefs.push(lastSegment(value));
    } else if (key === 'attributeName') {
      attributes.push(value);
    } else if (key === 'script' || key === 'body') {
      scripts.push(value);
    }
  });

  return {
    name,
    type: entityType(entity),
    startOffset,
    endOffset,
    attributes,
    referencedCircuits: circuitRefs,
    script: scripts[0]?.trim(),
    content: content.slice(startOffset, endOffset).replace(/\r?\n$/, ''),
    successNode: normalizeFilterNodeRef(success),
    failureNode: normalizeFilterNodeRef(failure),
    circuitRef: circuitRefs[0],
  };
}

/** Walks `fields` (and nested children) but never `logging` or `routing`. */
function collectFieldValues(node: unknown, visit: (key: string, value: string) => void): void {
  if (isMap(node)) {
    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : undefined;
      if (key === 'logging' || key === 'routing' || key === 'meta') {
        continue;
      }
      if (key && isScalar(pair.value) && pair.value.value !== null && pair.value.value !== undefined) {
        visit(key, String(pair.value.value));
      } else {
        collectFieldValues(pair.value, visit);
      }
    }
  } else if (isSeq(node)) {
    for (const item of node.items) {
      collectFieldValues(item, visit);
    }
  }
}

function entityType(entity: YAMLMap | undefined): string | undefined {
  return scalarValue(entity, 'type') ?? scalarValue(mapValue(entity, 'meta'), 'type');
}

function findPair(map: YAMLMap | undefined, key: string): Pair | undefined {
  if (!map) {
    return undefined;
  }
  return map.items.find((pair) => isScalar(pair.key) && String(pair.key.value) === key) as
    | Pair
    | undefined;
}

function mapValue(map: YAMLMap | undefined, key: string): YAMLMap | undefined {
  const value = findPair(map, key)?.value;
  return isMap(value) ? value : undefined;
}

function scalarValue(map: YAMLMap | undefined, key: string): string | undefined {
  const value = findPair(map, key)?.value;
  if (!isScalar(value) || value.value === null || value.value === undefined) {
    return undefined;
  }
  return String(value.value);
}

function firstContentOffset(root: YAMLMap): number | undefined {
  const first = root.items[0]?.key as Node | undefined;
  return first?.range?.[0];
}

function lastSegment(value: string): string {
  const trimmed = value.trim();
  return trimmed.includes('/') ? (trimmed.split('/').pop() ?? trimmed) : trimmed;
}

function lineStart(content: string, offset: number): number {
  const clamped = Math.max(0, Math.min(offset, content.length));
  return content.lastIndexOf('\n', clamped - 1) + 1;
}

function nextLineStart(content: string, offset: number): number {
  const clamped = Math.max(0, Math.min(offset, content.length));
  if (clamped === 0 || content[clamped - 1] === '\n') {
    return clamped;
  }
  const newline = content.indexOf('\n', clamped);
  return newline < 0 ? content.length : newline + 1;
}
