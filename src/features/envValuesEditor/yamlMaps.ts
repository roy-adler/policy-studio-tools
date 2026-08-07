/**
 * Minimal, dependency-free YAML helper scoped to the ENV values editor's
 * document shape: nested block mappings with scalar leaves (string / number
 * / boolean / null), plus enough sequence support to detect (and round-trip)
 * the non-editable array paths the editor warns about and skips.
 *
 * This intentionally does not implement the full YAML spec (no anchors,
 * tags, flow collections with content, multi-line block scalars, or
 * multi-document streams). Unsupported constructs throw a descriptive
 * error, which callers surface as a per-stage parse error rather than
 * silently producing wrong data.
 */

export type YamlValue =
  | string
  | number
  | boolean
  | null
  | YamlValue[]
  | { [key: string]: YamlValue };

interface LogicalLine {
  indent: number;
  content: string;
  lineNo: number;
}

export function parseMappingYaml(text: string): { data: Record<string, unknown>; error?: string } {
  try {
    const root = parseYamlDocument(text);
    if (root === null || root === undefined) {
      return { data: {}, error: 'Root must be a YAML mapping' };
    }
    if (!isPlainObject(root)) {
      return { data: {}, error: 'Root must be a YAML mapping' };
    }
    return { data: root as Record<string, unknown> };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { data: {}, error: message };
  }
}

export function dumpMappingYaml(data: Record<string, unknown>): string {
  if (Object.keys(data).length === 0) {
    return '{}\n';
  }
  const lines: string[] = [];
  serializeMapping(data as Record<string, YamlValue>, 0, lines);
  return `${lines.join('\n')}\n`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseYamlDocument(text: string): YamlValue {
  const lines = tokenizeLines(text);
  if (lines.length === 0) {
    return null;
  }

  const first = lines[0];

  if (lines.length === 1 && first.content === '{}') {
    return {};
  }
  if (lines.length === 1 && first.content === '[]') {
    return [];
  }

  let value: YamlValue;
  let nextPos: number;

  if (isListItem(first.content)) {
    [value, nextPos] = parseSequence(lines, 0, first.indent);
  } else if (findTopLevelColonIndex(first.content) !== -1) {
    [value, nextPos] = parseMapping(lines, 0, first.indent);
  } else {
    if (lines.length > 1) {
      throw new Error(`Unexpected content at line ${lines[1].lineNo}`);
    }
    value = parseScalar(first.content, first.lineNo);
    nextPos = 1;
  }

  if (nextPos !== lines.length) {
    throw new Error(`Unexpected indentation at line ${lines[nextPos].lineNo}`);
  }

  return value;
}

function tokenizeLines(text: string): LogicalLine[] {
  const rawLines = text.split(/\r\n|\r|\n/);
  const lines: LogicalLine[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const lineNo = i + 1;

    const leadingMatch = raw.match(/^[ \t]*/);
    const leading = leadingMatch ? leadingMatch[0] : '';
    if (leading.includes('\t')) {
      throw new Error(`Tabs are not allowed for indentation (line ${lineNo})`);
    }

    const withoutLeading = raw.slice(leading.length);
    const withoutComment = stripInlineComment(withoutLeading);
    const trimmed = withoutComment.replace(/\s+$/, '');

    if (trimmed === '' || trimmed === '---' || trimmed === '...') {
      continue;
    }

    lines.push({ indent: leading.length, content: trimmed, lineNo });
  }

  return lines;
}

function stripInlineComment(content: string): string {
  let quote: '"' | "'" | undefined;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (quote) {
      if (quote === '"' && ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) {
        quote = undefined;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || content[i - 1] === ' ' || content[i - 1] === '\t')) {
      return content.slice(0, i);
    }
  }
  return content;
}

function isListItem(content: string): boolean {
  return content === '-' || content.startsWith('- ');
}

/** Index of the colon that separates a plain (unquoted) key from its value, or -1. */
function findTopLevelColonIndex(content: string): number {
  if (content[0] === '"' || content[0] === "'") {
    const end = findClosingQuote(content, 0);
    if (end === -1) {
      return -1;
    }
    return content[end + 1] === ':' ? end + 1 : -1;
  }

  let idx = content.indexOf(':');
  while (idx !== -1) {
    const next = content[idx + 1];
    if (next === undefined || next === ' ' || next === '\t') {
      return idx;
    }
    idx = content.indexOf(':', idx + 1);
  }
  return -1;
}

function findClosingQuote(content: string, startIndex: number): number {
  const quote = content[startIndex];
  let i = startIndex + 1;
  while (i < content.length) {
    const ch = content[i];
    if (quote === '"' && ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) {
      if (quote === "'" && content[i + 1] === "'") {
        i += 2;
        continue;
      }
      return i;
    }
    i++;
  }
  return -1;
}

function splitKeyValue(content: string, lineNo: number): { key: string; rest: string } {
  const colonIndex = findTopLevelColonIndex(content);
  if (colonIndex === -1) {
    throw new Error(`Expected "key: value" or "key:" at line ${lineNo}`);
  }

  const rawKey = content.slice(0, colonIndex);
  const key = unquoteScalarText(rawKey.trim());
  const rest = content.slice(colonIndex + 1).trim();
  return { key, rest };
}

function parseMapping(
  lines: LogicalLine[],
  startPos: number,
  indent: number,
): [Record<string, YamlValue>, number] {
  const obj: Record<string, YamlValue> = {};
  let pos = startPos;

  while (pos < lines.length) {
    const line = lines[pos];
    if (line.indent < indent) {
      break;
    }
    if (line.indent > indent) {
      throw new Error(`Unexpected indentation at line ${line.lineNo}`);
    }
    if (isListItem(line.content)) {
      throw new Error(`Cannot mix mapping and sequence entries at line ${line.lineNo}`);
    }

    const { key, rest } = splitKeyValue(line.content, line.lineNo);
    pos++;

    if (rest === '') {
      if (pos < lines.length && lines[pos].indent > indent) {
        const childIndent = lines[pos].indent;
        const [value, nextPos] = parseNode(lines, pos, childIndent);
        obj[key] = value;
        pos = nextPos;
      } else {
        obj[key] = null;
      }
    } else if (rest === '{}') {
      obj[key] = {};
    } else if (rest === '[]') {
      obj[key] = [];
    } else {
      obj[key] = parseScalar(rest, line.lineNo);
    }
  }

  return [obj, pos];
}

function parseSequence(lines: LogicalLine[], startPos: number, indent: number): [YamlValue[], number] {
  const arr: YamlValue[] = [];
  let pos = startPos;

  while (pos < lines.length) {
    const line = lines[pos];
    if (line.indent < indent) {
      break;
    }
    if (line.indent > indent) {
      throw new Error(`Unexpected indentation at line ${line.lineNo}`);
    }
    if (!isListItem(line.content)) {
      throw new Error(`Cannot mix mapping and sequence entries at line ${line.lineNo}`);
    }

    const itemContent = line.content === '-' ? '' : line.content.slice(2).trim();
    pos++;

    if (itemContent === '') {
      if (pos < lines.length && lines[pos].indent > indent) {
        const childIndent = lines[pos].indent;
        const [value, nextPos] = parseNode(lines, pos, childIndent);
        arr.push(value);
        pos = nextPos;
      } else {
        arr.push(null);
      }
    } else if (itemContent === '{}') {
      arr.push({});
    } else if (itemContent === '[]') {
      arr.push([]);
    } else if (findTopLevelColonIndex(itemContent) !== -1) {
      throw new Error(
        `Sequence items with inline mapping keys are not supported at line ${line.lineNo}`,
      );
    } else {
      arr.push(parseScalar(itemContent, line.lineNo));
    }
  }

  return [arr, pos];
}

function parseNode(lines: LogicalLine[], pos: number, indent: number): [YamlValue, number] {
  const line = lines[pos];
  if (line.indent !== indent) {
    throw new Error(`Unexpected indentation at line ${line.lineNo}`);
  }
  if (isListItem(line.content)) {
    return parseSequence(lines, pos, indent);
  }
  return parseMapping(lines, pos, indent);
}

const RESERVED_UNQUOTED = new Set(['~', 'null', 'Null', 'NULL']);
const TRUE_UNQUOTED = new Set(['true', 'True', 'TRUE']);
const FALSE_UNQUOTED = new Set(['false', 'False', 'FALSE']);
const INT_PATTERN = /^[-+]?\d+$/;
const FLOAT_PATTERN = /^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/;

function parseScalar(rest: string, lineNo: number): string | number | boolean | null {
  if (rest[0] === '"') {
    const end = findClosingQuote(rest, 0);
    if (end !== rest.length - 1) {
      throw new Error(`Unterminated or malformed double-quoted string at line ${lineNo}`);
    }
    return unescapeDoubleQuoted(rest.slice(1, end));
  }
  if (rest[0] === "'") {
    const end = findClosingQuote(rest, 0);
    if (end !== rest.length - 1) {
      throw new Error(`Unterminated or malformed single-quoted string at line ${lineNo}`);
    }
    return rest.slice(1, end).replace(/''/g, "'");
  }

  if (rest[0] === '{' || rest[0] === '[') {
    throw new Error(`Flow collections are only supported when empty ({} / []) at line ${lineNo}`);
  }
  if (rest[0] === '|' || rest[0] === '>') {
    throw new Error(`Block scalars (| and >) are not supported at line ${lineNo}`);
  }
  if (rest[0] === '&' || rest[0] === '*' || rest[0] === '!') {
    throw new Error(`Anchors, aliases, and tags are not supported at line ${lineNo}`);
  }

  if (rest === '') {
    return null;
  }
  if (RESERVED_UNQUOTED.has(rest)) {
    return null;
  }
  if (TRUE_UNQUOTED.has(rest)) {
    return true;
  }
  if (FALSE_UNQUOTED.has(rest)) {
    return false;
  }
  if (INT_PATTERN.test(rest)) {
    return parseInt(rest, 10);
  }
  if (FLOAT_PATTERN.test(rest)) {
    return parseFloat(rest);
  }

  return rest;
}

function unquoteScalarText(text: string): string {
  if (text[0] === '"' && text[text.length - 1] === '"' && text.length >= 2) {
    return unescapeDoubleQuoted(text.slice(1, -1));
  }
  if (text[0] === "'" && text[text.length - 1] === "'" && text.length >= 2) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return text;
}

function unescapeDoubleQuoted(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      const next = text[i + 1];
      switch (next) {
        case 'n':
          out += '\n';
          break;
        case 't':
          out += '\t';
          break;
        case 'r':
          out += '\r';
          break;
        case '"':
          out += '"';
          break;
        case '\\':
          out += '\\';
          break;
        case '/':
          out += '/';
          break;
        default:
          out += next ?? '';
      }
      i++;
    } else {
      out += ch;
    }
  }
  return out;
}

function serializeMapping(obj: Record<string, YamlValue>, indentLevel: number, lines: string[]): void {
  const pad = '  '.repeat(indentLevel);
  for (const [key, value] of Object.entries(obj)) {
    const formattedKey = formatKey(key);
    if (isPlainObject(value)) {
      const entries = Object.keys(value);
      if (entries.length === 0) {
        lines.push(`${pad}${formattedKey}: {}`);
      } else {
        lines.push(`${pad}${formattedKey}:`);
        serializeMapping(value as Record<string, YamlValue>, indentLevel + 1, lines);
      }
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${pad}${formattedKey}: []`);
      } else {
        lines.push(`${pad}${formattedKey}:`);
        serializeSequence(value, indentLevel + 1, lines);
      }
    } else {
      lines.push(`${pad}${formattedKey}: ${formatScalar(value)}`);
    }
  }
}

function serializeSequence(arr: YamlValue[], indentLevel: number, lines: string[]): void {
  const pad = '  '.repeat(indentLevel);
  for (const item of arr) {
    if (isPlainObject(item)) {
      const entries = Object.keys(item);
      if (entries.length === 0) {
        lines.push(`${pad}- {}`);
      } else {
        lines.push(`${pad}-`);
        serializeMapping(item as Record<string, YamlValue>, indentLevel + 1, lines);
      }
    } else if (Array.isArray(item)) {
      if (item.length === 0) {
        lines.push(`${pad}- []`);
      } else {
        lines.push(`${pad}-`);
        serializeSequence(item, indentLevel + 1, lines);
      }
    } else {
      lines.push(`${pad}- ${formatScalar(item)}`);
    }
  }
}

const SAFE_PLAIN_KEY = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

function formatKey(key: string): string {
  if (SAFE_PLAIN_KEY.test(key)) {
    return key;
  }
  return JSON.stringify(key);
}

const RESERVED_WORDS = /^(true|false|null|~|yes|no|on|off)$/i;
const NEEDS_QUOTING = /^[\s]|[\s]$|^[-?:,[\]{}#&*!|>'"%@`]|: |:$| #|\n/;

function formatScalar(value: string | number | boolean | null): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (value === '') {
    return '""';
  }
  if (
    RESERVED_WORDS.test(value) ||
    INT_PATTERN.test(value) ||
    FLOAT_PATTERN.test(value) ||
    NEEDS_QUOTING.test(value)
  ) {
    return JSON.stringify(value);
  }
  return value;
}
