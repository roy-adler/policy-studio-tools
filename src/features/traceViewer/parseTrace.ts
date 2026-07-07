import type {
  TraceAttribute,
  TraceDocument,
  TraceEntry,
  TraceEntryStatus,
  TraceError,
  TraceHeader,
  TraceMetadata,
  TraceParseWarning,
} from './types';

const TRACE_ROOT_PATTERN = /<trace\b([^>]*)>([\s\S]*)<\/trace>/i;
const ATTRIBUTE_PATTERN = /(\w[\w.-]*)\s*=\s*["']([^"']*)["']/g;
const ENTRY_OPEN_PATTERN = /<entry\b([^>]*)>/gi;

interface ParseOptions {
  fileName?: string;
  fileSize?: number;
}

interface TagBlock {
  attributes: Record<string, string>;
  innerContent: string;
}

export function parseTrace(content: string, options: ParseOptions = {}): TraceDocument {
  const metadata: TraceMetadata = {
    fileName: options.fileName,
    fileSize: options.fileSize ?? content.length,
  };
  const warnings: TraceParseWarning[] = [];

  const trimmed = content.trim();
  if (!trimmed) {
    return {
      metadata,
      entries: [],
      warnings,
      parseError: 'Trace file is empty.',
      hasFailures: false,
    };
  }

  const rootMatch = TRACE_ROOT_PATTERN.exec(trimmed);
  if (!rootMatch) {
    return recoverPartialTrace(trimmed, metadata, warnings, options);
  }

  const rootAttributes = parseAttributes(rootMatch[1] ?? '');
  metadata.timestamp = rootAttributes.timestamp;
  metadata.service = rootAttributes.service;

  const inner = rootMatch[2] ?? '';
  const { entries, warnings: entryWarnings } = parseEntryBlocks(inner, 'entry');
  warnings.push(...entryWarnings);

  const hasFailures = countFailures(entries) > 0;
  return { metadata, entries, warnings, hasFailures };
}

function recoverPartialTrace(
  content: string,
  metadata: TraceMetadata,
  warnings: TraceParseWarning[],
  options: ParseOptions,
): TraceDocument {
  const openTrace = /<trace\b([^>]*)>/i.exec(content);
  if (!openTrace) {
    return {
      metadata,
      entries: [],
      warnings,
      parseError: 'Unrecognized trace format: missing <trace> root element.',
      hasFailures: false,
    };
  }

  const rootAttributes = parseAttributes(openTrace[1] ?? '');
  metadata.timestamp = rootAttributes.timestamp;
  metadata.service = rootAttributes.service;

  const innerStart = openTrace.index! + openTrace[0].length;
  const inner = content.slice(innerStart);
  const { entries, warnings: entryWarnings } = parseEntryBlocks(inner, 'entry', true);
  warnings.push(...entryWarnings);
  warnings.push({
    message: 'Trace file is truncated or malformed; showing recoverable entries only.',
  });

  return {
    metadata: { ...metadata, fileName: options.fileName, fileSize: options.fileSize ?? content.length },
    entries,
    warnings,
    hasFailures: countFailures(entries) > 0,
  };
}

function parseEntryBlocks(
  parentContent: string,
  tagName: string,
  lenient = false,
): { entries: TraceEntry[]; warnings: TraceParseWarning[] } {
  const entries: TraceEntry[] = [];
  const warnings: TraceParseWarning[] = [];
  let searchFrom = 0;
  let entryIndex = 0;

  while (searchFrom < parentContent.length) {
    const openPattern = new RegExp(`<${tagName}\\b([^>]*)>`, 'gi');
    openPattern.lastIndex = searchFrom;
    const openMatch = openPattern.exec(parentContent);
    if (!openMatch) {
      break;
    }

    const depthBefore = nestingDepth(parentContent, openMatch.index);
    if (depthBefore !== 0) {
      searchFrom = openMatch.index + openMatch[0].length;
      continue;
    }

    const block = extractTagBlock(parentContent, tagName, openMatch.index, lenient);
    if (!block) {
      warnings.push({
        message: `Skipped malformed <${tagName}> block near offset ${openMatch.index}.`,
      });
      searchFrom = openMatch.index + openMatch[0].length;
      continue;
    }

    const attributes = { ...parseAttributes(openMatch[1] ?? ''), ...block.attributes };
    const entry = buildEntry(attributes, block.innerContent, `entry-${entryIndex}`, lenient);
    entries.push(entry);
    warnings.push(...entry.childWarnings);
    entryIndex += 1;
    searchFrom = block.endIndex;
  }

  return { entries, warnings };
}

function extractTagBlock(
  content: string,
  tagName: string,
  startIndex: number,
  lenient: boolean,
): (TagBlock & { endIndex: number }) | undefined {
  const openPattern = new RegExp(`<${tagName}\\b([^>]*)>`, 'gi');
  openPattern.lastIndex = startIndex;
  const openMatch = openPattern.exec(content);
  if (!openMatch || openMatch.index !== startIndex) {
    return undefined;
  }

  let depth = 1;
  let cursor = openMatch.index + openMatch[0].length;
  const openTag = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  const closeTag = new RegExp(`</${tagName}>`, 'gi');

  while (cursor < content.length && depth > 0) {
    openTag.lastIndex = cursor;
    closeTag.lastIndex = cursor;
    const nextOpen = openTag.exec(content);
    const nextClose = closeTag.exec(content);

    if (!nextClose) {
      return undefined;
    }

    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + nextOpen[0].length;
      continue;
    }

    depth -= 1;
    if (depth === 0) {
      return {
        attributes: parseAttributes(openMatch[1] ?? ''),
        innerContent: content.slice(openMatch.index + openMatch[0].length, nextClose.index),
        endIndex: nextClose.index + nextClose[0].length,
      };
    }
    cursor = nextClose.index + nextClose[0].length;
  }

  return undefined;
}

function nestingDepth(content: string, index: number): number {
  const slice = content.slice(0, index);
  const opens = (slice.match(/<entry\b[^>]*>/gi) ?? []).length;
  const closes = (slice.match(/<\/entry>/gi) ?? []).length;
  return opens - closes;
}

function stripNestedEntryBlocks(content: string): string {
  let result = content;
  let previous = '';
  while (result !== previous) {
    previous = result;
    result = result.replace(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi, '');
  }
  return result;
}

function buildEntry(
  attributes: Record<string, string>,
  innerContent: string,
  id: string,
  lenient: boolean,
): TraceEntry & { childWarnings: TraceParseWarning[] } {
  const ownContent = stripNestedEntryBlocks(innerContent);
  const requestHeaders = parseNamedElements(ownContent, 'requestHeader');
  const responseHeaders = parseNamedElements(ownContent, 'responseHeader');
  const traceAttributes = parseNamedElements(ownContent, 'attribute');
  const requestBody = parseTextElement(ownContent, 'requestBody');
  const responseBody = parseTextElement(ownContent, 'responseBody');
  const error = parseError(ownContent);

  const status = normalizeStatus(attributes.status);
  const failed = status === 'failure' || Boolean(error);

  const childResult = parseEntryBlocks(innerContent, 'entry', lenient);
  const entry: TraceEntry & { childWarnings: TraceParseWarning[] } = {
    id,
    name: attributes.name ?? '(unnamed)',
    type: attributes.type,
    status: failed && status === 'unknown' ? 'failure' : status,
    duration: parseDuration(attributes.duration),
    requestHeaders,
    responseHeaders,
    requestBody,
    responseBody,
    attributes: traceAttributes,
    error,
    children: childResult.entries.map((child, index) => ({
      ...child,
      id: `${id}-${index}`,
    })),
    failed,
    childWarnings: childResult.warnings,
  };

  for (const child of entry.children) {
    if (child.failed) {
      entry.failed = true;
    }
  }

  return entry;
}

function parseAttributes(attributeText: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = new RegExp(ATTRIBUTE_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(attributeText)) !== null) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

function parseNamedElements(content: string, tagName: string): TraceHeader[] {
  const pattern = new RegExp(`<${tagName}\\s+name\\s*=\\s*["']([^"']+)["']\\s*>([\\s\\S]*?)</${tagName}>`, 'gi');
  const items: TraceHeader[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    items.push({ name: match[1], value: match[2].trim() });
  }
  return items;
}

function parseTextElement(content: string, tagName: string): string | undefined {
  const pattern = new RegExp(`<${tagName}\\s*>([\\s\\S]*?)</${tagName}>`, 'i');
  const match = pattern.exec(content);
  return match?.[1]?.trim() || undefined;
}

function parseError(content: string): TraceError | undefined {
  const pattern = /<error\s+message\s*=\s*["']([^"']*)["']\s*\/?>/i;
  const match = pattern.exec(content);
  if (!match) {
    return undefined;
  }
  return { message: match[1] };
}

function normalizeStatus(value: string | undefined): TraceEntryStatus {
  switch ((value ?? '').toLowerCase()) {
    case 'success':
      return 'success';
    case 'failure':
    case 'failed':
    case 'error':
      return 'failure';
    case 'skipped':
    case 'skip':
      return 'skipped';
    default:
      return 'unknown';
  }
}

function parseDuration(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function countFailures(entries: TraceEntry[]): number {
  let count = 0;
  for (const entry of entries) {
    if (entry.failed) {
      count += 1;
    }
    count += countFailures(entry.children);
  }
  return count;
}

export function flattenTraceEntries(entries: TraceEntry[]): TraceEntry[] {
  const flat: TraceEntry[] = [];
  const visit = (list: TraceEntry[]) => {
    for (const entry of list) {
      flat.push(entry);
      visit(entry.children);
    }
  };
  visit(entries);
  return flat;
}
