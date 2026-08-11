import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  discoverKpsStages,
  resolveSiblingKpsRoot,
} from '../../src/features/kpsEditor/discoverKpsStages';
import { loadKpsSession } from '../../src/features/kpsEditor/loadKpsSession';
import { buildKpsSession } from '../../src/features/kpsEditor/kpsTableModel';

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

describe('kps session model', () => {
  it('loads sample tables with shared columns and independent rows', () => {
    const session = loadKpsSession(kpsRoot);
    expect(session.tableNames).toContain('T_CC_Sample_WebServices.json');
    const web = session.tables['T_CC_Sample_WebServices.json'];
    expect(web.columns).toEqual(
      expect.arrayContaining(['name', 'description', 'type', 'version', 'createdBy']),
    );
    expect(web.stages.DEVL.status).toBe('present');
    expect(web.stages.DEVL.rows).toHaveLength(2);
    expect(web.stages.DEVL.rows[0].cells.name?.value).toBe('WebService_One_DEVL');
    expect(web.stages.TEST.rows[0].cells.name?.value).toBe('WebService_One_TEST');
  });

  it('marks missing stage files for tables not present in every stage', () => {
    const session = loadKpsSession(kpsRoot);
    const routes = session.tables['T_CC_Sample_Routes.json'];
    expect(routes.stages.DEVL.status).toBe('present');
    expect(routes.stages.TEST.status).toBe('present');
    expect(routes.stages.HUTL.status).toBe('missing');
    expect(routes.stages.HUTL.rows).toEqual([]);
  });

  it('isolates invalid JSON to one stage', () => {
    const discovery = discoverKpsStages(kpsRoot);
    const contents: Record<string, string | null> = {};
    for (const stage of discovery.stages) {
      for (const table of discovery.tableNames) {
        const key = `${stage.id}/${table}`;
        const filePath = path.join(stage.stageDir, table);
        contents[key] = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
      }
    }
    contents['DEVL/T_CC_Sample_WebServices.json'] = '{not-json';

    const session = buildKpsSession(path.resolve(kpsRoot), discovery, contents);
    const web = session.tables['T_CC_Sample_WebServices.json'];
    expect(web.stages.DEVL.status).toBe('error');
    expect(web.stages.DEVL.parseError).toBeTruthy();
    expect(web.stages.TEST.status).toBe('present');
    expect(session.warnings.some((w) => w.includes('DEVL'))).toBe(true);
  });

  it('marks nested non-scalar cells as non-editable', () => {
    const discovery = discoverKpsStages(kpsRoot);
    const contents: Record<string, string | null> = {
      'DEVL/Nested.json': JSON.stringify([{ name: 'a', meta: { nested: true } }]),
      'TEST/Nested.json': null,
      'HUTL/Nested.json': null,
    };
    const nestedDiscovery = {
      ...discovery,
      tableNames: ['Nested.json'],
    };
    const session = buildKpsSession(path.resolve(kpsRoot), nestedDiscovery, contents);
    const table = session.tables['Nested.json'];
    expect(table.columns).toContain('name');
    expect(table.columns).toContain('meta');
    expect(table.stages.DEVL.rows[0].cells.name?.editable).toBe(true);
    expect(table.stages.DEVL.rows[0].cells.meta?.editable).toBe(false);
    expect(table.stages.DEVL.rows[0].extra.meta).toEqual({ nested: true });
  });
});
