/**
 * Minimal, dependency-free YAML helper scoped to the ENV values editor's
 * document shape: nested block mappings with scalar leaves (string / number
 * / boolean / null), literal/folded block scalars (`|` / `>`), plus enough
 * sequence support to detect (and round-trip) the non-editable array paths
 * the editor warns about and skips.
 *
 * This intentionally does not implement the full YAML spec (no anchors,
 * tags, non-empty flow collections, or multi-document streams). Unsupported
 * constructs throw a descriptive error, which callers surface as a per-stage
 * parse error rather than silently producing wrong data.
 */

import type {
  EnvListIndentStyle,
  EnvScalarQuoteStyle,
  EnvYamlStyle,
} from './types';

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
  /** True for whitespace-only / empty lines (kept for block scalars). */
  blank: boolean;
}

interface ParsedScalar {
  value: string | number | boolean | null;
  quote: EnvScalarQuoteStyle;
}

const BLOCK_SCALAR_INDICATOR = /^([|>])([-+])?(\d+)?$/;

export function emptyYamlStyle(): EnvYamlStyle {
  return { documentStart: false, quotes: {}, listItemQuotes: {}, lists: {} };
}

function detectDocumentStart(text: string): boolean {
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const trimmed = raw.trim();
    if (trimmed === '') {
      continue;
    }
    return trimmed === '---';
  }
  return false;
}

function joinPath(prefix: string, key: string): string {
  return prefix ? `${prefix}.${key}` : key;
}

export function parseMappingYaml(text: string): {
  data: Record<string, unknown>;
  error?: string;
  style?: EnvYamlStyle;
} {
  const style = emptyYamlStyle();
  style.documentStart = detectDocumentStart(text);
  try {
    const root = parseYamlDocument(text, style);
    if (root === null || root === undefined) {
      return { data: {}, error: 'Root must be a YAML mapping', style };
    }
    if (!isPlainObject(root)) {
      return { data: {}, error: 'Root must be a YAML mapping', style };
    }
    return { data: root as Record<string, unknown>, style };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { data: {}, error: message, style };
  }
}

export function dumpMappingYaml(data: Record<string, unknown>, style?: EnvYamlStyle): string {
  const effective = style ?? emptyYamlStyle();
  if (Object.keys(data).length === 0) {
    // Prefer a marker-only / empty file over `{}` so removed keys leave no stub.
    return effective.documentStart ? '---\n' : '';
  }
  const lines: string[] = [];
  if (effective.documentStart) {
    lines.push('---');
  }
  serializeMapping(data as Record<string, YamlValue>, 0, lines, '', effective);
  return `${lines.join('\n')}\n`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseYamlDocument(text: string, style: EnvYamlStyle): YamlValue {
  const lines = tokenizeLines(text);
  let start = skipBlanks(lines, 0);
  if (start >= lines.length) {
    return null;
  }

  const first = lines[start];

  if (lines.length - start === 1 && first.content === '{}') {
    return {};
  }
  if (lines.length - start === 1 && first.content === '[]') {
    return [];
  }

  let value: YamlValue;
  let nextPos: number;

  if (isListItem(first.content)) {
    [value, nextPos] = parseSequence(lines, start, first.indent, '', style, 'indented');
  } else if (findTopLevelColonIndex(stripInlineComment(first.content)) !== -1) {
    [value, nextPos] = parseMapping(lines, start, first.indent, '', style);
  } else {
    if (skipBlanks(lines, start + 1) < lines.length) {
      throw new Error(`Unexpected content at line ${lines[skipBlanks(lines, start + 1)].lineNo}`);
    }
    const parsed = parseScalar(stripInlineComment(first.content).trim(), first.lineNo);
    value = parsed.value;
    nextPos = start + 1;
  }

  nextPos = skipBlanks(lines, nextPos);
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
    // Do not strip `#` comments here — block scalar content treats `#` as literal.
    // Structural parsers strip comments when reading keys / plain scalars.
    const trimmedRight = withoutLeading.replace(/\s+$/, '');

    if (trimmedRight === '---' || trimmedRight === '...') {
      continue;
    }

    if (trimmedRight === '') {
      lines.push({ indent: leading.length, content: '', lineNo, blank: true });
      continue;
    }

    lines.push({ indent: leading.length, content: trimmedRight, lineNo, blank: false });
  }

  // Drop trailing blank lines so document end detection stays simple.
  while (lines.length > 0 && lines[lines.length - 1].blank) {
    lines.pop();
  }

  return lines;
}

function skipBlanks(lines: LogicalLine[], pos: number): number {
  while (pos < lines.length && lines[pos].blank) {
    pos++;
  }
  return pos;
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
  const structural = stripInlineComment(content).trimEnd();
  const colonIndex = findTopLevelColonIndex(structural);
  if (colonIndex === -1) {
    throw new Error(`Expected "key: value" or "key:" at line ${lineNo}`);
  }

  const rawKey = structural.slice(0, colonIndex);
  const key = unquoteScalarText(rawKey.trim());
  const rest = structural.slice(colonIndex + 1).trim();
  return { key, rest };
}

function parseMapping(
  lines: LogicalLine[],
  startPos: number,
  indent: number,
  pathPrefix: string,
  style: EnvYamlStyle,
): [Record<string, YamlValue>, number] {
  const obj: Record<string, YamlValue> = {};
  let pos = startPos;

  while (pos < lines.length) {
    pos = skipBlanks(lines, pos);
    if (pos >= lines.length) {
      break;
    }
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
    const path = joinPath(pathPrefix, key);
    pos++;

    if (rest === '') {
      pos = skipBlanks(lines, pos);
      if (pos < lines.length && lines[pos].indent > indent) {
        const childIndent = lines[pos].indent;
        if (isListItem(lines[pos].content)) {
          style.lists[path] = 'indented';
          const [value, nextPos] = parseSequence(
            lines,
            pos,
            childIndent,
            path,
            style,
            'indented',
          );
          obj[key] = value;
          pos = nextPos;
        } else {
          const [value, nextPos] = parseNode(lines, pos, childIndent, path, style);
          obj[key] = value;
          pos = nextPos;
        }
      } else if (
        pos < lines.length &&
        lines[pos].indent === indent &&
        isListItem(lines[pos].content)
      ) {
        style.lists[path] = 'compact';
        const [value, nextPos] = parseSequence(lines, pos, indent, path, style, 'compact');
        obj[key] = value;
        pos = nextPos;
      } else {
        obj[key] = null;
        style.quotes[path] = 'plain';
      }
    } else if (rest === '{}') {
      obj[key] = {};
    } else if (rest === '[]') {
      obj[key] = [];
      style.lists[path] = 'indented';
    } else if (BLOCK_SCALAR_INDICATOR.test(rest)) {
      const indicator = rest[0] as '|' | '>';
      style.quotes[path] = indicator === '|' ? 'literal' : 'folded';
      const [value, nextPos] = parseBlockScalar(lines, pos, indent, rest, line.lineNo);
      obj[key] = value;
      pos = nextPos;
    } else {
      const parsed = parseScalar(rest, line.lineNo);
      obj[key] = parsed.value;
      style.quotes[path] = parsed.quote;
    }
  }

  return [obj, pos];
}

function parseSequence(
  lines: LogicalLine[],
  startPos: number,
  indent: number,
  pathPrefix: string,
  style: EnvYamlStyle,
  listStyle: EnvListIndentStyle,
): [YamlValue[], number] {
  const arr: YamlValue[] = [];
  let pos = startPos;
  style.lists[pathPrefix] = listStyle;

  while (pos < lines.length) {
    pos = skipBlanks(lines, pos);
    if (pos >= lines.length) {
      break;
    }
    const line = lines[pos];
    if (line.indent < indent) {
      break;
    }
    if (line.indent > indent) {
      throw new Error(`Unexpected indentation at line ${line.lineNo}`);
    }
    if (!isListItem(line.content)) {
      // Same-indent mapping key ends this sequence and belongs to the parent mapping.
      break;
    }

    const itemContent = line.content === '-' ? '' : line.content.slice(2).trim();
    const itemStructural = stripInlineComment(itemContent).trim();
    const itemPath = `${pathPrefix}[${arr.length}]`;
    pos++;

    if (itemStructural === '') {
      pos = skipBlanks(lines, pos);
      if (pos < lines.length && lines[pos].indent > indent) {
        const childIndent = lines[pos].indent;
        const [value, nextPos] = parseNode(lines, pos, childIndent, itemPath, style);
        arr.push(value);
        pos = nextPos;
      } else {
        arr.push(null);
        style.listItemQuotes[itemPath] = 'plain';
      }
    } else if (itemStructural === '{}') {
      arr.push({});
    } else if (itemStructural === '[]') {
      arr.push([]);
    } else if (BLOCK_SCALAR_INDICATOR.test(itemStructural)) {
      const indicator = itemStructural[0] as '|' | '>';
      style.listItemQuotes[itemPath] = indicator === '|' ? 'literal' : 'folded';
      const [value, nextPos] = parseBlockScalar(lines, pos, indent, itemStructural, line.lineNo);
      arr.push(value);
      pos = nextPos;
    } else if (findTopLevelColonIndex(itemStructural) !== -1) {
      const [value, nextPos] = parseInlineSequenceMapping(
        lines,
        pos,
        indent,
        itemStructural,
        line.lineNo,
        itemPath,
        style,
      );
      arr.push(value);
      pos = nextPos;
    } else {
      const parsed = parseScalar(itemStructural, line.lineNo);
      arr.push(parsed.value);
      style.listItemQuotes[itemPath] = parsed.quote;
    }
  }

  return [arr, pos];
}

/**
 * Parse a sequence item that starts as `- key: value` and may continue with
 * more keys indented past the dash column.
 */
function parseInlineSequenceMapping(
  lines: LogicalLine[],
  pos: number,
  sequenceIndent: number,
  firstPair: string,
  lineNo: number,
  pathPrefix: string,
  style: EnvYamlStyle,
): [Record<string, YamlValue>, number] {
  const obj: Record<string, YamlValue> = {};
  const { key, rest } = splitKeyValue(firstPair, lineNo);
  const path = joinPath(pathPrefix, key);

  if (rest === '') {
    pos = skipBlanks(lines, pos);
    if (pos < lines.length && lines[pos].indent > sequenceIndent) {
      const childIndent = lines[pos].indent;
      if (childIndent > sequenceIndent + 1) {
        const [value, nextPos] = parseNode(lines, pos, childIndent, path, style);
        obj[key] = value;
        pos = nextPos;
      } else {
        obj[key] = null;
        style.quotes[path] = 'plain';
      }
    } else {
      obj[key] = null;
      style.quotes[path] = 'plain';
    }
  } else if (BLOCK_SCALAR_INDICATOR.test(rest)) {
    style.quotes[path] = rest[0] === '|' ? 'literal' : 'folded';
    const [value, nextPos] = parseBlockScalar(lines, pos, sequenceIndent, rest, lineNo);
    obj[key] = value;
    pos = nextPos;
  } else {
    const parsed = parseScalar(rest, lineNo);
    obj[key] = parsed.value;
    style.quotes[path] = parsed.quote;
  }

  while (pos < lines.length) {
    pos = skipBlanks(lines, pos);
    if (pos >= lines.length) {
      break;
    }
    const line = lines[pos];
    if (line.indent <= sequenceIndent || isListItem(line.content)) {
      break;
    }
    const { key: contKey, rest: contRest } = splitKeyValue(line.content, line.lineNo);
    const contPath = joinPath(pathPrefix, contKey);
    pos++;
    if (contRest === '') {
      pos = skipBlanks(lines, pos);
      if (pos < lines.length && lines[pos].indent > line.indent) {
        const [value, nextPos] = parseNode(lines, pos, lines[pos].indent, contPath, style);
        obj[contKey] = value;
        pos = nextPos;
      } else {
        obj[contKey] = null;
        style.quotes[contPath] = 'plain';
      }
    } else if (BLOCK_SCALAR_INDICATOR.test(contRest)) {
      style.quotes[contPath] = contRest[0] === '|' ? 'literal' : 'folded';
      const [value, nextPos] = parseBlockScalar(lines, pos, line.indent, contRest, line.lineNo);
      obj[contKey] = value;
      pos = nextPos;
    } else {
      const parsed = parseScalar(contRest, line.lineNo);
      obj[contKey] = parsed.value;
      style.quotes[contPath] = parsed.quote;
    }
  }

  return [obj, pos];
}

function parseNode(
  lines: LogicalLine[],
  pos: number,
  indent: number,
  pathPrefix: string,
  style: EnvYamlStyle,
): [YamlValue, number] {
  pos = skipBlanks(lines, pos);
  if (pos >= lines.length) {
    throw new Error('Unexpected end of document');
  }
  const line = lines[pos];
  if (line.indent !== indent) {
    throw new Error(`Unexpected indentation at line ${line.lineNo}`);
  }
  if (isListItem(line.content)) {
    return parseSequence(lines, pos, indent, pathPrefix, style, 'indented');
  }
  return parseMapping(lines, pos, indent, pathPrefix, style);
}

/**
 * Parse a YAML block scalar starting after the `key: |` / `key: >` line.
 * `parentIndent` is the indent of that key line; content must be more indented.
 */
function parseBlockScalar(
  lines: LogicalLine[],
  startPos: number,
  parentIndent: number,
  indicator: string,
  indicatorLineNo: number,
): [string, number] {
  const match = BLOCK_SCALAR_INDICATOR.exec(indicator);
  if (!match) {
    throw new Error(`Invalid block scalar indicator at line ${indicatorLineNo}`);
  }
  const style = match[1] as '|' | '>';
  const chompFlag = match[2];
  const explicitIndent = match[3] ? Number.parseInt(match[3], 10) : undefined;

  let pos = startPos;
  let contentIndent = explicitIndent !== undefined ? parentIndent + explicitIndent : undefined;
  const rawContentLines: string[] = [];

  while (pos < lines.length) {
    const line = lines[pos];

    if (line.blank) {
      if (contentIndent === undefined) {
        // Leading blank lines before the first content line — keep as empty
        // once content indent is known; for now record and continue.
        rawContentLines.push('');
        pos++;
        continue;
      }
      rawContentLines.push('');
      pos++;
      continue;
    }

    if (line.indent <= parentIndent) {
      break;
    }

    if (contentIndent === undefined) {
      contentIndent = line.indent;
    }

    if (line.indent < contentIndent) {
      break;
    }

    const extraIndent = line.indent - contentIndent;
    rawContentLines.push(`${' '.repeat(extraIndent)}${line.content}`);
    pos++;
  }

  // Drop leading blanks that appeared before content indent was established
  // only when we never found content (empty block).
  if (contentIndent === undefined) {
    return [applyChomping('', chompFlag), pos];
  }

  // Trim leading recorded blanks that were captured before first content —
  // those were pushed with contentIndent still undefined; they sit at the
  // front as '' entries that should become leading newlines in the scalar.
  // They are already correct as '' entries in rawContentLines.

  let text: string;
  if (style === '|') {
    text = rawContentLines.join('\n');
  } else {
    text = foldBlockLines(rawContentLines);
  }

  return [applyChomping(text, chompFlag), pos];
}

function foldBlockLines(lines: string[]): string {
  // YAML folded style: consecutive non-empty lines joined by space;
  // blank lines become newlines.
  const parts: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      parts.push(paragraph.join(' '));
      paragraph = [];
    }
  };

  for (const line of lines) {
    if (line === '') {
      flushParagraph();
      parts.push('');
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();

  // Join with newline: empty string entries produce blank lines between paragraphs.
  let result = '';
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      result += '\n';
    }
    result += parts[i];
  }
  return result;
}

function applyChomping(text: string, chompFlag: string | undefined): string {
  // Default clip: keep a single trailing newline if content is non-empty.
  // Strip (-): remove all trailing newlines.
  // Keep (+): keep all trailing newlines as produced (we join without a final
  // newline unless the last content line was followed by blanks — raw join
  // doesn't add a final newline after the last line, so add one for clip/keep
  // when there was content).
  if (text === '') {
    return chompFlag === '+' ? '\n' : '';
  }

  if (chompFlag === '-') {
    return text.replace(/\n+$/, '');
  }

  // Ensure at least one trailing newline for clip/keep when content exists.
  if (!text.endsWith('\n')) {
    text += '\n';
  }

  if (chompFlag === '+') {
    return text;
  }

  // clip: exactly one trailing newline
  return `${text.replace(/\n+$/, '')}\n`;
}

const RESERVED_UNQUOTED = new Set(['~', 'null', 'Null', 'NULL']);
const TRUE_UNQUOTED = new Set(['true', 'True', 'TRUE']);
const FALSE_UNQUOTED = new Set(['false', 'False', 'FALSE']);
const INT_PATTERN = /^[-+]?\d+$/;
const FLOAT_PATTERN = /^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/;

function parseScalar(rest: string, lineNo: number): ParsedScalar {
  if (rest[0] === '"') {
    const end = findClosingQuote(rest, 0);
    if (end !== rest.length - 1) {
      throw new Error(`Unterminated or malformed double-quoted string at line ${lineNo}`);
    }
    return { value: unescapeDoubleQuoted(rest.slice(1, end)), quote: 'double' };
  }
  if (rest[0] === "'") {
    const end = findClosingQuote(rest, 0);
    if (end !== rest.length - 1) {
      throw new Error(`Unterminated or malformed single-quoted string at line ${lineNo}`);
    }
    return { value: rest.slice(1, end).replace(/''/g, "'"), quote: 'single' };
  }

  if (rest[0] === '{' || rest[0] === '[') {
    throw new Error(`Flow collections are only supported when empty ({} / []) at line ${lineNo}`);
  }
  if (rest[0] === '&' || rest[0] === '*' || rest[0] === '!') {
    throw new Error(`Anchors, aliases, and tags are not supported at line ${lineNo}`);
  }

  if (rest === '') {
    return { value: null, quote: 'plain' };
  }
  if (RESERVED_UNQUOTED.has(rest)) {
    return { value: null, quote: 'plain' };
  }
  if (TRUE_UNQUOTED.has(rest)) {
    return { value: true, quote: 'plain' };
  }
  if (FALSE_UNQUOTED.has(rest)) {
    return { value: false, quote: 'plain' };
  }
  if (INT_PATTERN.test(rest)) {
    return { value: parseInt(rest, 10), quote: 'plain' };
  }
  if (FLOAT_PATTERN.test(rest)) {
    return { value: parseFloat(rest), quote: 'plain' };
  }

  return { value: rest, quote: 'plain' };
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

function serializeMapping(
  obj: Record<string, YamlValue>,
  indentLevel: number,
  lines: string[],
  pathPrefix: string,
  style: EnvYamlStyle,
): void {
  const pad = '  '.repeat(indentLevel);
  for (const [key, value] of Object.entries(obj)) {
    const formattedKey = formatKey(key);
    const path = joinPath(pathPrefix, key);
    if (isPlainObject(value)) {
      const entries = Object.keys(value);
      if (entries.length === 0) {
        lines.push(`${pad}${formattedKey}: {}`);
      } else {
        lines.push(`${pad}${formattedKey}:`);
        serializeMapping(value as Record<string, YamlValue>, indentLevel + 1, lines, path, style);
      }
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${pad}${formattedKey}: []`);
      } else {
        lines.push(`${pad}${formattedKey}:`);
        const listStyle = style.lists[path] ?? 'compact';
        // compact: items share the key's indent; indented: one level deeper
        const itemIndent = listStyle === 'compact' ? indentLevel : indentLevel + 1;
        serializeSequence(value, itemIndent, lines, path, style);
      }
    } else if (typeof value === 'string' && (value.includes('\n') || style.quotes[path] === 'literal' || style.quotes[path] === 'folded')) {
      serializeBlockScalar(formattedKey, value, indentLevel, lines, style.quotes[path]);
    } else {
      lines.push(`${pad}${formattedKey}: ${formatScalar(value, style.quotes[path])}`);
    }
  }
}

function serializeBlockScalar(
  formattedKey: string,
  value: string,
  indentLevel: number,
  lines: string[],
  quote?: EnvScalarQuoteStyle,
): void {
  const pad = '  '.repeat(indentLevel);
  const contentPad = '  '.repeat(indentLevel + 1);
  const indicator = quote === 'folded' ? '>' : '|';
  const chomp = value.endsWith('\n') ? '' : '-';
  const body = value.endsWith('\n') ? value.slice(0, -1) : value;
  lines.push(`${pad}${formattedKey}: ${indicator}${chomp}`);
  if (body === '') {
    return;
  }
  for (const line of body.split('\n')) {
    lines.push(`${contentPad}${line}`);
  }
}

function serializeSequence(
  arr: YamlValue[],
  indentLevel: number,
  lines: string[],
  pathPrefix: string,
  style: EnvYamlStyle,
): void {
  const pad = '  '.repeat(indentLevel);
  arr.forEach((item, index) => {
    const itemPath = `${pathPrefix}[${index}]`;
    if (isPlainObject(item)) {
      const entries = Object.keys(item);
      if (entries.length === 0) {
        lines.push(`${pad}- {}`);
      } else {
        lines.push(`${pad}-`);
        serializeMapping(item as Record<string, YamlValue>, indentLevel + 1, lines, itemPath, style);
      }
    } else if (Array.isArray(item)) {
      if (item.length === 0) {
        lines.push(`${pad}- []`);
      } else {
        lines.push(`${pad}-`);
        serializeSequence(item, indentLevel + 1, lines, itemPath, style);
      }
    } else {
      lines.push(`${pad}- ${formatScalar(item, style.listItemQuotes[itemPath])}`);
    }
  });
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

function formatScalar(
  value: string | number | boolean | null,
  preferred?: EnvScalarQuoteStyle,
): string {
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
    return preferred === 'single' ? "''" : '""';
  }

  const needsQuotes =
    RESERVED_WORDS.test(value) ||
    INT_PATTERN.test(value) ||
    FLOAT_PATTERN.test(value) ||
    NEEDS_QUOTING.test(value);

  if (preferred === 'single') {
    return `'${value.replace(/'/g, "''")}'`;
  }
  if (preferred === 'double' || needsQuotes) {
    return JSON.stringify(value);
  }
  return value;
}
