import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  discoverEnvStages,
  resolveSiblingEnvRoot,
} from '../../src/features/envValuesEditor/discoverEnvStages';

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
