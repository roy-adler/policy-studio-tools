import type { ExtractedPathTemplate } from './types';
import { ROUTING_PATH_FIELD_NAMES } from './types';

const ROUTING_FIELD_PATTERN = ROUTING_PATH_FIELD_NAMES.join('|');

function addMatch(
  results: ExtractedPathTemplate[],
  content: string,
  template: string,
  valueStart: number,
): void {
  if (template.length === 0) {
    results.push({
      template,
      startOffset: valueStart,
      endOffset: valueStart,
    });
    return;
  }

  results.push({
    template,
    startOffset: valueStart,
    endOffset: valueStart + template.length,
  });
}

function extractYamlTemplates(content: string): ExtractedPathTemplate[] {
  const results: ExtractedPathTemplate[] = [];
  const pattern = new RegExp(
    `(?:^|[\\n\\r])\\s*(?:${ROUTING_FIELD_PATTERN})\\s*:\\s*(?:` +
      `'([^']*)'|` +
      `"([^"]*)"|` +
      `([^\\s#\\n\\r]+)` +
      `)`,
    'gim',
  );

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const template = match[1] ?? match[2] ?? match[3] ?? '';
    const fullMatch = match[0];
    const valueOffsetInMatch = fullMatch.indexOf(template);
    const valueStart = match.index + valueOffsetInMatch;
    addMatch(results, content, template, valueStart);
  }

  return results;
}

function extractXmlFvalTemplates(content: string): ExtractedPathTemplate[] {
  const results: ExtractedPathTemplate[] = [];
  const pattern = new RegExp(
    `<fval\\s+name="(?:${ROUTING_FIELD_PATTERN})"[^>]*>\\s*` +
      `(?:<value><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></value>|<value>([^<]*)</value>)`,
    'gi',
  );

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const rawValue = match[1] ?? match[2] ?? '';
    const template = rawValue;
    const fullMatch = match[0];
    const valueOffsetInMatch = fullMatch.indexOf(rawValue);
    const valueStart = match.index + valueOffsetInMatch;
    addMatch(results, content, template, valueStart);
  }

  return results;
}

function extractXmlAttributeTemplates(content: string): ExtractedPathTemplate[] {
  const results: ExtractedPathTemplate[] = [];
  const pattern = new RegExp(
    `(?:${ROUTING_FIELD_PATTERN})\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    'gi',
  );

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const template = match[1] ?? match[2] ?? '';
    const quoted = match[0].includes('"') ? `"${template}"` : `'${template}'`;
    const valueOffsetInMatch = match[0].indexOf(quoted);
    const valueStart = match.index + valueOffsetInMatch + 1;
    addMatch(results, content, template, valueStart);
  }

  return results;
}

function dedupeByRange(templates: ExtractedPathTemplate[]): ExtractedPathTemplate[] {
  const seen = new Set<string>();
  const unique: ExtractedPathTemplate[] = [];

  for (const entry of templates) {
    const key = `${entry.startOffset}:${entry.endOffset}:${entry.template}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(entry);
  }

  return unique.sort((a, b) => a.startOffset - b.startOffset);
}

export function extractPathTemplates(content: string): ExtractedPathTemplate[] {
  const combined = [
    ...extractYamlTemplates(content),
    ...extractXmlFvalTemplates(content),
    ...extractXmlAttributeTemplates(content),
  ];
  return dedupeByRange(combined);
}
