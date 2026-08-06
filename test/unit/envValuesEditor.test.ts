import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  discoverEnvStages,
  resolveSiblingEnvRoot,
} from '../../src/features/envValuesEditor/discoverEnvStages';
import { loadEnvValuesSession } from '../../src/features/envValuesEditor/loadEnvValuesSession';
import { parseEnvValuesYaml } from '../../src/features/envValuesEditor/envValuesModel';

const sampleRoot = path.join(__dirname, '..', 'fixtures', 'env-values-editor', 'sample');
const policyRoot = path.join(sampleRoot, 'POLICY_yaml');
const envRoot = path.join(sampleRoot, 'ENV');

describe('env values discovery', () => {
  it('resolves sibling ENV next to the policy project', () => {
    expect(resolveSiblingEnvRoot(policyRoot)).toBe(envRoot);
  });

  it('discovers stages that contain values.yaml and skips KPS', () => {
    const result = discoverEnvStages(envRoot);
    expect(result.envRoot).toBe(envRoot);
    expect(result.stages.map((s) => s.id).sort()).toEqual(['DEVL', 'TEST']);
    expect(result.stages.every((s) => s.valuesFilePath.endsWith(`${path.sep}values.yaml`))).toBe(
      true,
    );
    expect(result.skippedDirs).toContain('KPS');
  });

  it('returns empty stages when ENV has no stage values.yaml files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-empty-'));
    const emptyEnv = path.join(tmp, 'ENV');
    fs.mkdirSync(emptyEnv);
    const result = discoverEnvStages(emptyEnv);
    expect(result.stages).toEqual([]);
  });
});

describe('env values model', () => {
  it('treats empty string as present value, not missing', () => {
    const parsed = parseEnvValuesYaml('A:\n  AA: ""\n');
    expect(parsed.error).toBeUndefined();
    expect(parsed.data).toEqual({ A: { AA: '' } });
  });

  it('rejects null or empty YAML root but accepts empty mapping', () => {
    expect(parseEnvValuesYaml('').error).toBeTruthy();
    expect(parseEnvValuesYaml('null').error).toBeTruthy();
    expect(parseEnvValuesYaml('~').error).toBeTruthy();
    const empty = parseEnvValuesYaml('{}\n');
    expect(empty.error).toBeUndefined();
    expect(empty.data).toEqual({});
  });

  it('warns when a stage contains a non-editable array path', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-array-'));
    const arrayEnv = path.join(tmp, 'ENV');
    fs.mkdirSync(path.join(arrayEnv, 'DEVL'), { recursive: true });
    fs.mkdirSync(path.join(arrayEnv, 'TEST'), { recursive: true });
    fs.writeFileSync(
      path.join(arrayEnv, 'DEVL', 'values.yaml'),
      'items:\n  - one\n  - two\nA:\n  AA: ok\n',
    );
    fs.writeFileSync(path.join(arrayEnv, 'TEST', 'values.yaml'), 'A:\n  AA: ok\n');
    const model = loadEnvValuesSession(arrayEnv);
    expect(model.warnings.some((w) => w.includes('items') && w.toLowerCase().includes('array'))).toBe(
      true,
    );
  });

  it('marks BAB missing in TEST but present in DEVL', () => {
    const model = loadEnvValuesSession(envRoot);
    const bab = findLeaf(model.tree, 'B.BA.BAB');
    expect(bab?.cells?.DEVL).toEqual({ kind: 'value', value: 'Inhalt3' });
    expect(bab?.cells?.TEST).toEqual({ kind: 'missing' });
    expect(model.warnings.some((w) => w.includes('B.BA.BAB') && w.includes('TEST'))).toBe(true);
  });

  it('loads AA values for both stages', () => {
    const model = loadEnvValuesSession(envRoot);
    const aa = findLeaf(model.tree, 'A.AA');
    expect(aa?.cells?.DEVL).toEqual({ kind: 'value', value: 'Inhalt' });
    expect(aa?.cells?.TEST).toEqual({ kind: 'value', value: 'Inhalt-test' });
  });

  it('isolates invalid YAML to one stage', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-bad-'));
    const badEnv = path.join(tmp, 'ENV');
    fs.mkdirSync(path.join(badEnv, 'DEVL'), { recursive: true });
    fs.mkdirSync(path.join(badEnv, 'TEST'), { recursive: true });
    fs.writeFileSync(path.join(badEnv, 'DEVL', 'values.yaml'), 'A:\n  AA: ok\n');
    fs.writeFileSync(path.join(badEnv, 'TEST', 'values.yaml'), 'A: [\n');
    const model = loadEnvValuesSession(badEnv);
    expect(model.documents.TEST.parseError).toBeTruthy();
    expect(model.documents.DEVL.parseError).toBeUndefined();
    const aa = findLeaf(model.tree, 'A.AA');
    expect(aa?.cells?.DEVL).toEqual({ kind: 'value', value: 'ok' });
  });

  it('warns on map vs scalar structural conflict', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-conflict-'));
    const conflictEnv = path.join(tmp, 'ENV');
    fs.mkdirSync(path.join(conflictEnv, 'DEVL'), { recursive: true });
    fs.mkdirSync(path.join(conflictEnv, 'TEST'), { recursive: true });
    fs.writeFileSync(path.join(conflictEnv, 'DEVL', 'values.yaml'), 'A:\n  AA: scalar\n');
    fs.writeFileSync(path.join(conflictEnv, 'TEST', 'values.yaml'), 'A:\n  AA:\n    nested: x\n');
    const model = loadEnvValuesSession(conflictEnv);
    expect(model.warnings.some((w) => w.toLowerCase().includes('conflict'))).toBe(true);
    expect(collectNodesWithCellsAndChildren(model.tree)).toEqual([]);
  });
});

function collectNodesWithCellsAndChildren(
  nodes: import('../../src/features/envValuesEditor/types').EnvTreeNode[],
): string[] {
  const violations: string[] = [];
  for (const node of nodes) {
    if (node.cells && node.children && node.children.length > 0) {
      violations.push(node.path);
    }
    if (node.children) {
      violations.push(...collectNodesWithCellsAndChildren(node.children));
    }
  }
  return violations;
}

function findLeaf(
  nodes: import('../../src/features/envValuesEditor/types').EnvTreeNode[],
  dotted: string,
): import('../../src/features/envValuesEditor/types').EnvTreeNode | undefined {
  const parts = dotted.split('.');
  let current = nodes;
  let node: import('../../src/features/envValuesEditor/types').EnvTreeNode | undefined;
  for (const part of parts) {
    node = current.find((n) => n.name === part);
    if (!node) {
      return undefined;
    }
    current = node.children ?? [];
  }
  return node;
}
