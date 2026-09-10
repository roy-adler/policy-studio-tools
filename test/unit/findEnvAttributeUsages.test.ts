import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  extractEnvAttributePlaceholders,
  listSiblingPolicyProjects,
  NO_SIBLING_POLICY_PROJECT_WARNING,
  scanEnvAttributeUsages,
  usagesForEnvKey,
} from '../../src/features/envValuesEditor/findEnvAttributeUsages';
import type { EnvAttributeUsage } from '../../src/features/envValuesEditor/types';

const usagesEnvRoot = path.join(
  __dirname,
  '..',
  'fixtures',
  'env-values-editor',
  'usages',
  'ENV',
);

describe('extractEnvAttributePlaceholders', () => {
  it('maps {{path.attributeValue}} to the full inner name and match offsets', () => {
    const content = 'cert: "{{Service.Health.serviceCert.attributeValue}}"';
    const found = extractEnvAttributePlaceholders(content);
    expect(found).toHaveLength(1);
    expect(found[0].envKey).toBe('Service.Health.serviceCert.attributeValue');
    expect(content.slice(found[0].startOffset, found[0].endOffset)).toBe(
      '{{Service.Health.serviceCert.attributeValue}}',
    );
  });

  it('maps {{path}} without a suffix to the ENV key', () => {
    const content = 'cert: "{{Service.Health.serviceCert}}"';
    const found = extractEnvAttributePlaceholders(content);
    expect(found).toHaveLength(1);
    expect(found[0].envKey).toBe('Service.Health.serviceCert');
    expect(content.slice(found[0].startOffset, found[0].endOffset)).toBe(
      '{{Service.Health.serviceCert}}',
    );
  });

  it('trims whitespace inside the braces', () => {
    const content = '{{  A.AA.attributeValue  }}';
    const found = extractEnvAttributePlaceholders(content);
    expect(found).toHaveLength(1);
    expect(found[0].envKey).toBe('A.AA.attributeValue');
    expect(content.slice(found[0].startOffset, found[0].endOffset)).toBe(content);
  });

  it('keeps every match in the same string', () => {
    const content =
      '{{A.AA.attributeValue}} then {{B.BB.attributeValue}} and {{A.AA}}';
    const keys = extractEnvAttributePlaceholders(content).map((item) => item.envKey);
    expect(keys).toEqual(['A.AA.attributeValue', 'B.BB.attributeValue', 'A.AA']);
  });

  it('still extracts unrelated placeholder names (they are not usages of a different ENV key)', () => {
    const content = 'path: "{{id}}" selector: "{{request.headers.host}}"';
    const keys = extractEnvAttributePlaceholders(content).map((item) => item.envKey);
    expect(keys).toEqual(['id', 'request.headers.host']);
  });
});

describe('usagesForEnvKey', () => {
  const usage = (envKey: string): EnvAttributeUsage => ({
    envKey,
    absolutePath: '/x.yaml',
    relativePath: 'x.yaml',
    line: 1,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
  });

  it('includes the whole key and that key plus a dotted suffix', () => {
    const byKey = {
      'A.AA': [usage('A.AA')],
      'A.AA.attributeValue': [usage('A.AA.attributeValue')],
      'A.AAA': [usage('A.AAA')],
      id: [usage('id')],
    };
    const keys = usagesForEnvKey(byKey, 'A.AA').map((item) => item.envKey);
    expect(keys.sort()).toEqual(['A.AA', 'A.AA.attributeValue']);
  });
});

describe('listSiblingPolicyProjects', () => {
  it('finds the sibling YAML project next to ENV', () => {
    const projects = listSiblingPolicyProjects(usagesEnvRoot);
    expect(projects).toHaveLength(1);
    expect(projects[0].projectType).toBe('yaml');
    expect(path.basename(projects[0].rootPath)).toBe('POLICY_yaml');
  });

  it('returns none when the parent has no policy project', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-no-policy-'));
    const envRoot = path.join(tmp, 'ENV');
    fs.mkdirSync(envRoot);
    expect(listSiblingPolicyProjects(envRoot)).toEqual([]);
  });
});

describe('scanEnvAttributeUsages', () => {
  it('indexes YAML and XML interpolations by whole ENV key, with or without a suffix', async () => {
    const scan = await scanEnvAttributeUsages(usagesEnvRoot);
    expect(scan.projectCount).toBe(1);
    expect(scan.warnings).toEqual([]);
    const used = usagesForEnvKey(scan.byKey, 'A.AA');
    expect(used).toHaveLength(4);
    expect(usagesForEnvKey(scan.byKey, 'B.BB')).toEqual([]);
    expect(usagesForEnvKey(scan.byKey, 'id')).toHaveLength(1);
    const relatives = used.map((usage) => usage.relativePath).sort();
    expect(relatives).toEqual([
      'Policies/Used Circuit.yaml',
      'Policies/Used Circuit.yaml',
      'Policies/Used Circuit.yaml',
      'Policies/legacy.xml',
    ]);
    expect(used[0].line).toBeGreaterThan(0);
    expect(used[0].range.start.line).toBe(used[0].line - 1);
  });

  it('warns when no sibling policy project exists', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-scan-none-'));
    const envRoot = path.join(tmp, 'ENV');
    fs.mkdirSync(envRoot);
    const scan = await scanEnvAttributeUsages(envRoot);
    expect(scan.projectCount).toBe(0);
    expect(scan.byKey).toEqual({});
    expect(scan.warnings).toEqual([NO_SIBLING_POLICY_PROJECT_WARNING]);
  });

  it('records a warning and continues when a policy file cannot be read', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-scan-missing-'));
    const policy = path.join(tmp, 'POLICY_yaml');
    const envRoot = path.join(tmp, 'ENV');
    fs.mkdirSync(path.join(policy, 'Policies'), { recursive: true });
    fs.writeFileSync(path.join(policy, 'values.yaml'), 'name: tmp\n');
    const gone = path.join(policy, 'Policies', 'gone.yaml');
    fs.writeFileSync(gone, 'x: "{{A.AA.attributeValue}}"\n');
    fs.mkdirSync(envRoot);

    const { scanPolicyFileForUsages } = await import(
      '../../src/features/envValuesEditor/findEnvAttributeUsages'
    );
    const result = await scanPolicyFileForUsages({
      absolutePath: gone + '.missing',
      relativePath: 'Policies/gone.yaml',
    });
    expect(result.usages).toEqual([]);
    expect(result.warning).toMatch(/gone\.yaml/);
  });
});
