import type { EnvAttributePlaceholder } from './types';

export const NO_SIBLING_POLICY_PROJECT_WARNING =
  'No Policy Studio project found next to this ENV folder; policy usages were not scanned.';

const ATTRIBUTE_VALUE_PLACEHOLDER = /\{\{\s*([^{}]*?)\.attributeValue\s*\}\}/g;

export function extractEnvAttributePlaceholders(content: string): EnvAttributePlaceholder[] {
  const found: EnvAttributePlaceholder[] = [];
  const pattern = new RegExp(ATTRIBUTE_VALUE_PLACEHOLDER.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const envKey = match[1].trim();
    if (!envKey) {
      continue;
    }
    found.push({
      envKey,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    });
  }
  return found;
}
