import * as fs from 'fs/promises';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parseTrace } from '../../src/features/traceViewer/parseTrace';
import { searchTrace } from '../../src/features/traceViewer/searchTrace';
import { TRACE_VIEWER_TOOL } from '../../src/features/traceViewer/toolDescriptor';
import type { TraceEntry } from '../../src/features/traceViewer/types';

const fixturesDir = path.join(__dirname, '..', 'fixtures', 'trace-viewer');

async function readFixture(name: string): Promise<string> {
  return fs.readFile(path.join(fixturesDir, name), 'utf8');
}

function entryNames(entries: TraceEntry[]): string[] {
  return entries.map((entry) => entry.name);
}

function findEntry(entries: TraceEntry[], name: string): TraceEntry | undefined {
  for (const entry of entries) {
    if (entry.name === name) {
      return entry;
    }
    const nested = findEntry(entry.children, name);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

describe('parseTrace', () => {
  it('parses a successful trace with headers and bodies', async () => {
    const content = await readFixture('success.trc');
    const doc = parseTrace(content, { fileName: 'success.trc', fileSize: content.length });

    expect(doc.parseError).toBeUndefined();
    expect(doc.metadata.timestamp).toBe('2024-01-01T12:00:00Z');
    expect(doc.metadata.service).toBe('OrderAPI');
    expect(doc.metadata.fileName).toBe('success.trc');
    expect(entryNames(doc.entries)).toEqual(['Receive', 'Validate', 'Route']);
    expect(doc.hasFailures).toBe(false);

    const validate = findEntry(doc.entries, 'Validate');
    expect(validate?.status).toBe('success');
    expect(validate?.duration).toBe(5);
    expect(validate?.requestHeaders).toEqual([
      { name: 'Content-Type', value: 'application/json' },
    ]);
    expect(validate?.requestBody).toBe('{"orderId": 42}');
    expect(validate?.responseBody).toBe('{"valid": true}');
    expect(validate?.attributes).toEqual([{ name: 'user.id', value: '123' }]);
    expect(validate?.failed).toBe(false);
  });

  it('detects failed filters and error messages', async () => {
    const content = await readFixture('failure.trc');
    const doc = parseTrace(content);

    expect(doc.hasFailures).toBe(true);
    const failed = findEntry(doc.entries, 'CheckPolicy');
    expect(failed?.status).toBe('failure');
    expect(failed?.failed).toBe(true);
    expect(failed?.error?.message).toBe('Validation failed: insufficient permissions');

    const skipped = findEntry(doc.entries, 'Respond');
    expect(skipped?.status).toBe('skipped');
    expect(skipped?.failed).toBe(false);
  });

  it('builds a hierarchical tree from nested entries', async () => {
    const content = await readFixture('nested.trc');
    const doc = parseTrace(content);

    expect(entryNames(doc.entries)).toEqual(['MainCircuit']);
    const main = doc.entries[0];
    expect(entryNames(main.children)).toEqual(['AuthCircuit', 'BusinessLogic']);

    const auth = main.children[0];
    expect(entryNames(auth.children)).toEqual(['ValidateToken', 'SetPrincipal']);
    expect(findEntry(doc.entries, 'SetPrincipal')?.attributes[0]).toEqual({
      name: 'principal.name',
      value: 'alice',
    });
  });

  it('parses rich message attributes', async () => {
    const content = await readFixture('attributes.trc');
    const doc = parseTrace(content);

    const enrich = findEntry(doc.entries, 'EnrichMessage');
    expect(enrich?.attributes).toHaveLength(6);
    expect(enrich?.attributes.map((attr) => attr.name)).toContain('correlation.id');
    expect(enrich?.attributes.find((attr) => attr.name === 'user.roles')?.value).toBe(
      'admin,operator',
    );
  });

  it('recovers from partially corrupted traces', async () => {
    const content = await readFixture('corrupt.trc');
    const doc = parseTrace(content);

    expect(entryNames(doc.entries)).toEqual(['GoodFilter']);
    expect(doc.warnings.length).toBeGreaterThan(0);
    expect(doc.warnings.some((warning) => warning.message.length > 0)).toBe(true);
  });

  it('returns an empty document for empty input', () => {
    const doc = parseTrace('');
    expect(doc.entries).toEqual([]);
    expect(doc.parseError).toBeDefined();
  });
});

describe('searchTrace', () => {
  it('finds entries matching a case-insensitive query', async () => {
    const content = await readFixture('success.trc');
    const doc = parseTrace(content);

    const matches = searchTrace(doc, 'oauth');
    expect(matches.map((match) => match.path.at(-1))).toEqual(['Validate']);

    const headerMatches = searchTrace(doc, 'bearer');
    expect(headerMatches).toHaveLength(1);
    expect(headerMatches[0].path).toEqual(['Receive']);
  });

  it('searches nested entries and attribute values', async () => {
    const content = await readFixture('nested.trc');
    const doc = parseTrace(content);

    const matches = searchTrace(doc, 'principal.name');
    expect(matches).toHaveLength(1);
    expect(matches[0].path).toEqual(['MainCircuit', 'AuthCircuit', 'SetPrincipal']);
  });
});

describe('trace viewer tool descriptor', () => {
  it('registers as an available Traces tool', () => {
    expect(TRACE_VIEWER_TOOL.group).toBe('traces');
    expect(TRACE_VIEWER_TOOL.command).toBe('policyStudioTools.openTraceFile');
    expect(TRACE_VIEWER_TOOL.available).toBe(true);
  });
});
