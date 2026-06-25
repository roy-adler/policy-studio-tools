import type { ParsedCircuit, ParsedFilter } from './types';

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

export function parsePolicyYaml(content: string): { circuits: ParsedCircuit[]; error?: string } {
  try {
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
      const startOffset = lines.slice(0, currentFilter.startOffset ?? 0).join('\n').length;
      const endOffset = lines.slice(0, endLine + 1).join('\n').length;
      filters.push({
        name: currentFilter.name,
        type: currentFilter.type,
        startOffset,
        endOffset,
        attributes: currentFilter.attributes ?? [],
        referencedCircuits: currentFilter.referencedCircuits ?? [],
        script: currentFilter.script,
        content: lines.slice(currentFilter.startOffset ?? 0, endLine + 1).join('\n'),
      });
      currentFilter = undefined;
    };

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('name:') && !inFilters) {
        circuitName = trimmed.slice('name:'.length).trim();
        circuitStart = lines.slice(0, i).join('\n').length;
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
          startOffset: i,
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
      return { circuits: [] };
    }

    const circuitEnd = content.length;
    circuits.push({
      name: circuitName,
      startOffset: circuitStart,
      endOffset: circuitEnd,
      filters,
    });

    return { circuits };
  } catch (error) {
    return {
      circuits: [],
      error: error instanceof Error ? error.message : 'YAML parse error',
    };
  }
}
