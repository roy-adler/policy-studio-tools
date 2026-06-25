import type { ParsedCircuit, ParsedFilter } from './types';

export function isWellFormedXml(content: string): boolean {
  const tagPattern = /<(\/?)([A-Za-z_][\w.-]*)([^>]*)>/g;
  const stack: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(content)) !== null) {
    const closing = match[1] === '/';
    const tagName = match[2];
    const rest = match[3] ?? '';

    if (rest.endsWith('/') || rest.includes('/>')) {
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

export function parsePolicyXml(content: string): { circuits: ParsedCircuit[]; error?: string } {
  if (!isWellFormedXml(content)) {
    return { circuits: [], error: 'Malformed XML' };
  }

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

      const attributes: string[] = [];
      const attributePattern = /attributeName\s*=\s*"([^"]+)"/gi;
      let attributeMatch: RegExpExecArray | null;
      while ((attributeMatch = attributePattern.exec(filterBody)) !== null) {
        attributes.push(attributeMatch[1]);
      }

      const referencedCircuits: string[] = [];
      const circuitNameText = readElementText(filterBody, 'circuitName');
      if (circuitNameText) {
        referencedCircuits.push(circuitNameText);
      }
      const circuitRefAttr = readAttribute(filterBody, 'circuit');
      if (circuitRefAttr) {
        referencedCircuits.push(circuitRefAttr);
      }

      const script = readElementText(filterBody, 'script');

      filters.push({
        name: filterName,
        type: filterType,
        startOffset: filterStart,
        endOffset: filterEnd,
        attributes,
        referencedCircuits,
        script,
        content: filterBody,
      });
    }

    circuits.push({
      name: circuitName,
      startOffset: circuitStart,
      endOffset: circuitEnd,
      filters,
    });
  }

  return { circuits };
}
