export function offsetToPosition(content: string, offset: number): { line: number; character: number } {
  const before = content.slice(0, Math.max(0, offset));
  const lines = before.split('\n');
  return {
    line: lines.length - 1,
    character: lines[lines.length - 1]?.length ?? 0,
  };
}

export function offsetToRange(
  content: string,
  startOffset: number,
  endOffset: number,
): {
  start: { line: number; character: number };
  end: { line: number; character: number };
} {
  return {
    start: offsetToPosition(content, startOffset),
    end: offsetToPosition(content, endOffset),
  };
}

export function buildPreview(
  content: string,
  matchIndex: number,
  matchLength: number,
  maxLength: number,
): string {
  const half = Math.floor((maxLength - matchLength) / 2);
  const start = Math.max(0, matchIndex - half);
  const end = Math.min(content.length, matchIndex + matchLength + half);
  let excerpt = content.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) {
    excerpt = `...${excerpt}`;
  }
  if (end < content.length) {
    excerpt = `${excerpt}...`;
  }
  return excerpt.slice(0, maxLength);
}

export function normalizeQuery(query: string): string {
  return query.trim();
}

export function matchesLiteral(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function exactMatch(haystack: string, needle: string): boolean {
  return haystack.toLowerCase() === needle.toLowerCase();
}

export function wordBoundaryMatch(haystack: string, needle: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegex(needle)}\\b`, 'i');
  return pattern.test(haystack);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findMatchIndex(haystack: string, needle: string): number {
  return haystack.toLowerCase().indexOf(needle.toLowerCase());
}
