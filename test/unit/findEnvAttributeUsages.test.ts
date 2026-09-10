import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  collectEnvLeafPaths,
  findEnvKeyOccurrences,
  listSiblingPolicyProjects,
  NO_SIBLING_POLICY_PROJECT_WARNING,
  scanEnvAttributeUsages,
} from '../../src/features/envValuesEditor/findEnvAttributeUsages';
import { loadEnvValuesSession } from '../../src/features/envValuesEditor/loadEnvValuesSession';

const usagesEnvRoot = path.join(
  __dirname,
  '..',
  'fixtures',
  'env-values-editor',
  'usages',
  'ENV',
);

describe('findEnvKeyOccurrences', () => {
  it('finds the key inside {{path.attributeValue}}', () => {
    const content = 'cert: "{{Service.Health.serviceCert.attributeValue}}"';
    const found = findEnvKeyOccurrences(content, 'Service.Health.serviceCert');
    expect(found).toHaveLength(1);
    expect(content.slice(found[0].startOffset, found[0].endOffset)).toBe(
      'Service.Health.serviceCert',
    );
  });

  it('finds the key without braces', () => {
    const content = 'see Service.Health.serviceCert in docs';
    const found = findEnvKeyOccurrences(content, 'Service.Health.serviceCert');
    expect(found).toHaveLength(1);
    expect(content.slice(found[0].startOffset, found[0].endOffset)).toBe(
      'Service.Health.serviceCert',
    );
  });

  it('finds every occurrence', () => {
    const content = '{{A.AA.attributeValue}} then {{B.BB}} and A.AA';
    const found = findEnvKeyOccurrences(content, 'A.AA');
    expect(found).toHaveLength(2);
  });

  it('does not treat A.AAA as A.AA', () => {
    expect(findEnvKeyOccurrences('A.AAA', 'A.AA')).toEqual([]);
  });

  it('does not treat id as a usage of A.AA', () => {
    expect(findEnvKeyOccurrences('path: "{{id}}"', 'A.AA')).toEqual([]);
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
  it('indexes YAML, XML, and bare text by ENV leaf path', async () => {
    const model = loadEnvValuesSession(usagesEnvRoot);
    const keys = collectEnvLeafPaths(model.tree);
    const scan = await scanEnvAttributeUsages(usagesEnvRoot, keys);
    expect(scan.projectCount).toBe(1);
    expect(scan.warnings).toEqual([]);
    expect(scan.byKey['A.AA']).toHaveLength(5);
    expect(scan.byKey['B.BB'] ?? []).toEqual([]);
    expect(scan.byKey['id']).toBeUndefined();
    const relatives = scan.byKey['A.AA'].map((usage) => usage.relativePath).sort();
    expect(relatives).toEqual([
      'Policies/Used Circuit.yaml',
      'Policies/Used Circuit.yaml',
      'Policies/Used Circuit.yaml',
      'Policies/Used Circuit.yaml',
      'Policies/legacy.xml',
    ]);
    expect(scan.byKey['A.AA'][0].line).toBeGreaterThan(0);
    expect(scan.byKey['A.AA'][0].range.start.line).toBe(scan.byKey['A.AA'][0].line - 1);
  });

  it('warns when no sibling policy project exists', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-scan-none-'));
    const envRoot = path.join(tmp, 'ENV');
    fs.mkdirSync(envRoot);
    const scan = await scanEnvAttributeUsages(envRoot, ['A.AA']);
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
