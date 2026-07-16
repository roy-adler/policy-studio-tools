import type { ParsedCircuit, ParsedFilter } from './types';
import { normalizeFilterNodeRef } from './textUtils';

function readScalarBlock(lines: string[], startIndex: number): { value: string; endIndex: number } {
  const firstLine = lines[startIndex]?.trim() ?? '';
  if (!firstLine.endsWith('|') && !firstLine.endsWith('>')) {
    const colon = firstLine.indexOf(':');
    if (colon >= 0) {
      return { value: firstLine.slice(colon + 1).trim(), endIndex: startIndex };
    }
  }

  const indent = lines[startIndex + 1]?.match(/^\s*/)?.[0]?.length ?? 0;
  const parts: string[] = [];
  let i = startIndex + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      parts.push('');
      i += 1;
      continue;
    }
    const lineIndent = line.match(/^\s*/)?.[0]?.length ?? 0;
    if (lineIndent < indent) {
      break;
    }
    parts.push(line.slice(indent));
    i += 1;
  }
  return { value: parts.join('\n').trim(), endIndex: i - 1 };
}

function offsetAtLine(lines: string[], lineIndex: number): number {
  return lines.slice(0, lineIndex).join('\n').length + (lineIndex > 0 ? 1 : 0);
}

const STRUCTURAL_CHILD_KEYS = new Set(['fields', 'meta', 'routing']);

function parseFlowLinkKey(
  trimmed: string,
): { kind: 'success' | 'failure'; value: string } | undefined {
  if (trimmed.startsWith('successNode:')) {
    return { kind: 'success', value: trimmed.slice('successNode:'.length) };
  }
  if (trimmed.startsWith('failureNode:')) {
    return { kind: 'failure', value: trimmed.slice('failureNode:'.length) };
  }
  // Primary Policy Studio export: routing.success / routing.failure
  if (trimmed.startsWith('success:')) {
    return { kind: 'success', value: trimmed.slice('success:'.length) };
  }
  if (trimmed.startsWith('failure:')) {
    return { kind: 'failure', value: trimmed.slice('failure:'.length) };
  }
  return undefined;
}

function parseYamlEsPolicy(content: string): ParsedCircuit[] {
  const lines = content.split('\n');
  let circuitName: string | undefined;
  let circuitStartFilter: string | undefined;
  let circuitStart = 0;
  let inChildren = false;
  let currentChild: Partial<ParsedFilter> | undefined;
  const filters: ParsedFilter[] = [];
  let childrenKeyIndent = 0;
  let childIndent = 0;

  const flushChild = (endLine: number) => {
    if (!currentChild?.name) {
      currentChild = undefined;
      return;
    }
    const startOffset = currentChild.startOffset ?? 0;
    const endOffset = offsetAtLine(lines, endLine + 1);
    filters.push({
      name: currentChild.name,
      type: currentChild.type,
      startOffset,
      endOffset,
      attributes: currentChild.attributes ?? [],
      referencedCircuits: currentChild.referencedCircuits ?? [],
      script: currentChild.script,
      content: lines.slice(
        lines.findIndex((_, idx) => offsetAtLine(lines, idx) >= startOffset),
        endLine + 1,
      ).join('\n'),
      successNode: currentChild.successNode,
      failureNode: currentChild.failureNode,
      circuitRef: currentChild.circuitRef,
    });
    currentChild = undefined;
  };

  const unquote = (value: string): string => value.trim().replace(/^["']|["']$/g, '');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = line.match(/^\s*/)?.[0]?.length ?? 0;

    if (trimmed === 'type: FilterCircuit' || trimmed === 'type: "FilterCircuit"') {
      circuitStart = offsetAtLine(lines, i);
    }

    if (!inChildren && /^name:\s*.+/.test(trimmed) && indent <= 2) {
      circuitName = trimmed.replace(/^name:\s*/, '').replace(/^["']|["']$/g, '');
      if (circuitStart === 0) {
        circuitStart = offsetAtLine(lines, i);
      }
    }

    if (!inChildren && trimmed.startsWith('fields:')) {
      continue;
    }

    if (!inChildren && trimmed.startsWith('name:') && indent >= 2) {
      circuitName = trimmed.slice('name:'.length).trim().replace(/^["']|["']$/g, '');
    }

    if (!inChildren && trimmed.startsWith('start:')) {
      circuitStartFilter = normalizeFilterNodeRef(unquote(trimmed.slice('start:'.length)));
    }

    if (trimmed === 'children:') {
      inChildren = true;
      childrenKeyIndent = indent;
      childIndent = indent + 2;
      continue;
    }

    if (!inChildren) {
      continue;
    }

    // End of children block when a non-nested top-level key appears.
    if (
      indent <= childrenKeyIndent &&
      trimmed !== '' &&
      !trimmed.startsWith('#') &&
      !trimmed.startsWith('-')
    ) {
      flushChild(i - 1);
      inChildren = false;
      i -= 1;
      continue;
    }

    // List-style children: "- type: PathParameterFilter"
    const listTypeMatch = trimmed.match(/^- type:\s*(.*)$/);
    if (listTypeMatch && indent >= childrenKeyIndent) {
      flushChild(i - 1);
      currentChild = {
        type: unquote(listTypeMatch[1]),
        startOffset: offsetAtLine(lines, i),
        attributes: [],
        referencedCircuits: [],
      };
      continue;
    }

    // Map-style children: "Set Message:" — never treat structural keys as filters.
    if (inChildren && indent === childIndent && trimmed.endsWith(':') && !trimmed.startsWith('-')) {
      const childName = trimmed.slice(0, -1).trim();
      if (!STRUCTURAL_CHILD_KEYS.has(childName)) {
        flushChild(i - 1);
        currentChild = {
          name: childName,
          startOffset: offsetAtLine(lines, i),
          attributes: [],
          referencedCircuits: [],
        };
      }
      continue;
    }

    if (!currentChild) {
      continue;
    }

    if (trimmed.startsWith('type:')) {
      currentChild.type = trimmed.slice('type:'.length).trim().replace(/^["']|["']$/g, '');
    } else if (trimmed.startsWith('name:')) {
      currentChild.name = trimmed.slice('name:'.length).trim().replace(/^["']|["']$/g, '');
    } else if (trimmed.startsWith('circuit:')) {
      const value = trimmed.slice('circuit:'.length).trim().replace(/^["']|["']$/g, '');
      const shortName = value.includes('/') ? (value.split('/').pop() ?? value) : value;
      currentChild.referencedCircuits = [
        ...(currentChild.referencedCircuits ?? []),
        shortName,
      ];
      currentChild.circuitRef = shortName;
    } else {
      const flowLink = parseFlowLinkKey(trimmed);
      if (flowLink) {
        const normalized = normalizeFilterNodeRef(unquote(flowLink.value));
        if (flowLink.kind === 'success') {
          currentChild.successNode = normalized;
        } else {
          currentChild.failureNode = normalized;
        }
      } else if (trimmed.startsWith('attributeName:')) {
        currentChild.attributes = [
          ...(currentChild.attributes ?? []),
          trimmed.slice('attributeName:'.length).trim().replace(/^["']|["']$/g, ''),
        ];
      } else if (trimmed.startsWith('script:') || trimmed === 'body:') {
        const { value, endIndex } = readScalarBlock(lines, i);
        currentChild.script = value;
        i = endIndex;
      }
    }
  }

  flushChild(lines.length - 1);

  if (!circuitName) {
    return [];
  }

  return [
    {
      name: circuitName,
      startOffset: circuitStart,
      endOffset: content.length,
      filters,
      startFilter: circuitStartFilter,
    },
  ];
}

function parseLegacyYamlPolicy(content: string): ParsedCircuit[] {
  const circuits: ParsedCircuit[] = [];
  const lines = content.split('\n');

  let circuitName: string | undefined;
  let circuitStart = 0;
  let inFilters = false;
  let currentFilter: Partial<ParsedFilter> | undefined;
  const filters: ParsedFilter[] = [];

  const flushFilter = (endLine: number) => {
    if (!currentFilter?.name) {
      currentFilter = undefined;
      return;
    }
    const startOffset = currentFilter.startOffset ?? 0;
    const endOffset = offsetAtLine(lines, endLine + 1);
    filters.push({
      name: currentFilter.name,
      type: currentFilter.type,
      startOffset,
      endOffset,
      attributes: currentFilter.attributes ?? [],
      referencedCircuits: currentFilter.referencedCircuits ?? [],
      script: currentFilter.script,
      content: lines.slice(
        lines.findIndex((_, idx) => offsetAtLine(lines, idx) >= startOffset),
        endLine + 1,
      ).join('\n'),
    });
    currentFilter = undefined;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('name:') && !inFilters) {
      circuitName = trimmed.slice('name:'.length).trim();
      circuitStart = offsetAtLine(lines, i);
    }

    if (trimmed === 'filters:') {
      inFilters = true;
      continue;
    }

    if (!inFilters) {
      continue;
    }

    if (trimmed.startsWith('- name:')) {
      flushFilter(i - 1);
      currentFilter = {
        name: trimmed.slice('- name:'.length).trim(),
        startOffset: offsetAtLine(lines, i),
        attributes: [],
        referencedCircuits: [],
      };
      continue;
    }

    if (!currentFilter) {
      continue;
    }

    if (trimmed.startsWith('type:')) {
      currentFilter.type = trimmed.slice('type:'.length).trim();
    } else if (trimmed.startsWith('circuitName:')) {
      currentFilter.referencedCircuits = [
        ...(currentFilter.referencedCircuits ?? []),
        trimmed.slice('circuitName:'.length).trim(),
      ];
    } else if (trimmed.startsWith('script:')) {
      const { value, endIndex } = readScalarBlock(lines, i);
      currentFilter.script = value;
      i = endIndex;
    } else if (trimmed === 'attributes:') {
      const attrs: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const attrLine = lines[j]?.trim() ?? '';
        if (!attrLine.startsWith('- ')) {
          break;
        }
        attrs.push(attrLine.slice(2).trim());
        j += 1;
      }
      currentFilter.attributes = attrs;
      i = j - 1;
    }
  }

  flushFilter(lines.length - 1);

  if (!circuitName) {
    return [];
  }

  circuits.push({
    name: circuitName,
    startOffset: circuitStart,
    endOffset: content.length,
    filters,
  });

  return circuits;
}

// Mirrors XML isWellFormedXml: narrow check for unclosed quoted scalars only.
function isMalformedYaml(content: string): boolean {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    if (/:\s*"([^"\\]|\\.)*$/.test(trimmed) || /:\s*'([^'\\]|\\.)*$/.test(trimmed)) {
      return true;
    }
  }
  return false;
}

export function parsePolicyYaml(content: string): { circuits: ParsedCircuit[]; error?: string } {
  try {
    const malformed = isMalformedYaml(content);
    const yamlEs = parseYamlEsPolicy(content);
    if (yamlEs.length > 0) {
      return { circuits: yamlEs, error: malformed ? 'Malformed YAML' : undefined };
    }
    const legacy = parseLegacyYamlPolicy(content);
    if (legacy.length > 0) {
      return { circuits: legacy, error: malformed ? 'Malformed YAML' : undefined };
    }
    if (malformed) {
      return { circuits: [], error: 'Malformed YAML' };
    }
    return { circuits: legacy };
  } catch (error) {
    return {
      circuits: [],
      error: error instanceof Error ? error.message : 'YAML parse error',
    };
  }
}
