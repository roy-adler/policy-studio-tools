import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  discoverKpsStages,
  resolveSiblingKpsRoot,
} from '../../src/features/kpsEditor/discoverKpsStages';

const sampleRoot = path.join(__dirname, '..', 'fixtures', 'kps-editor', 'sample');
const policyRoot = path.join(sampleRoot, 'POLICY_yaml');
const kpsRoot = path.join(sampleRoot, 'KPS');

describe('kps discovery', () => {
  it('resolves sibling KPS next to the policy project', () => {
    expect(resolveSiblingKpsRoot(policyRoot)).toBe(kpsRoot);
  });

  it('discovers stages with json and unions table basenames', () => {
    const result = discoverKpsStages(kpsRoot);
    expect(result.kpsRoot).toBe(path.resolve(kpsRoot));
    expect(result.stages.map((s) => s.id).sort()).toEqual(['DEVL', 'HUTL', 'TEST']);
    expect(result.tableNames.sort()).toEqual([
      'T_CC_Sample_Routes.json',
      'T_CC_Sample_WebServices.json',
    ]);
    expect(result.stages.every((s) => fs.existsSync(s.stageDir))).toBe(true);
  });

  it('returns empty stages when KPS has no stage json files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-empty-'));
    const emptyKps = path.join(tmp, 'KPS');
    fs.mkdirSync(emptyKps);
    fs.mkdirSync(path.join(emptyKps, 'EMPTY'));
    const result = discoverKpsStages(emptyKps);
    expect(result.stages).toEqual([]);
    expect(result.tableNames).toEqual([]);
    expect(result.skippedDirs).toContain('EMPTY');
  });
});
