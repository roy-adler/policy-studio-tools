import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { loadKpsSession } from '../../src/features/kpsEditor/loadKpsSession';
import { buildKpsSession } from '../../src/features/kpsEditor/kpsTableModel';
import { moveRow } from '../../src/features/kpsEditor/kpsTableMutations';
import { syncRowOrderAcrossStages } from '../../src/features/kpsEditor/kpsRowOrderSync';
import { applyKpsTargetEdit, findStageGroups } from '../../src/features/kpsEditor/kpsStageGroups';
import type { KpsSession } from '../../src/features/kpsEditor/types';

const TABLE = 'T_Routes.json';

function session(
  stages: Record<string, Array<Record<string, unknown>> | null>,
  readKey?: string,
): KpsSession {
  const ids = Object.keys(stages);
  const contents: Record<string, string | null> = {};
  for (const id of ids) {
    contents[`${id}/${TABLE}`] = stages[id] === null ? null : JSON.stringify(stages[id]);
  }
  return buildKpsSession(
    '/kps',
    {
      kpsRoot: '/kps',
      stages: ids.map((id) => ({ id, stageDir: `/kps/${id}` })),
      tableNames: [TABLE],
      skippedDirs: [],
    },
    contents,
    {},
    {},
    readKey ? { [TABLE]: { storeGroupPath: '/s.yaml', typeGroupPath: '/t.yaml', readKey } } : {},
  );
}

function keys(s: KpsSession, stageId: string, column = 'name'): unknown[] {
  return s.tables[TABLE].stages[stageId].rows.map((row) => row.cells[column]?.value);
}

function rows(names: string[], suffix: string): Array<Record<string, unknown>> {
  return names.map((name) => ({ name, url: `${name}-${suffix}` }));
}

describe('kps row order sync across stages', () => {
  it('applies a reorder to every stage that has the same keys, with different values', () => {
    const s = session({
      DEVL: rows(['a', 'b', 'c'], 'devl'),
      TEST: rows(['a', 'b', 'c'], 'test'),
      PROD: rows(['a', 'b', 'c'], 'prod'),
    });
    moveRow(s, TABLE, 'TEST', 2, 0);
    const changed = syncRowOrderAcrossStages(s, TABLE, 'TEST');
    expect(changed).toEqual(['DEVL', 'PROD']);
    for (const id of ['DEVL', 'TEST', 'PROD']) {
      expect(keys(s, id)).toEqual(['c', 'a', 'b']);
      expect(s.tables[TABLE].stages[id].dirty).toBe(true);
    }
    expect(keys(s, 'PROD', 'url')).toEqual(['c-prod', 'a-prod', 'b-prod']);
  });

  it('skips missing keys and keeps stage-only rows at their index', () => {
    const s = session({
      DEVL: rows(['a', 'b', 'c', 'd'], 'devl'),
      TEST: rows(['x', 'd', 'b', 'y', 'a'], 'test'),
    });
    // DEVL: a b c d -> d a b c
    moveRow(s, TABLE, 'DEVL', 3, 0);
    syncRowOrderAcrossStages(s, TABLE, 'DEVL');
    // shared slots in TEST are 1,2,4 -> filled with d, a, b
    expect(keys(s, 'TEST')).toEqual(['x', 'd', 'a', 'y', 'b']);
  });

  it('leaves stages whose shared order already matches untouched and not dirty', () => {
    const s = session({
      DEVL: rows(['a', 'b', 'c'], 'devl'),
      TEST: rows(['c', 'a'], 'test'),
    });
    moveRow(s, TABLE, 'DEVL', 2, 0);
    expect(syncRowOrderAcrossStages(s, TABLE, 'DEVL')).toEqual([]);
    expect(s.tables[TABLE].stages.TEST.dirty).toBe(false);
  });

  it('ignores missing and invalid stages', () => {
    const s = session({ DEVL: rows(['a', 'b'], 'devl'), TEST: null });
    moveRow(s, TABLE, 'DEVL', 1, 0);
    expect(syncRowOrderAcrossStages(s, TABLE, 'DEVL')).toEqual([]);
    expect(s.tables[TABLE].stages.TEST.status).toBe('missing');
  });

  it('matches by the Store Group readKey column when it is set', () => {
    const data = (ids: string[], label: string) => ids.map((id) => ({ name: label, id }));
    const s = session({ DEVL: data(['1', '2', '3'], 'same'), TEST: data(['3', '2', '1'], 'same') }, 'id');
    expect(s.tables[TABLE].keyColumn).toBe('id');
    moveRow(s, TABLE, 'DEVL', 0, 2);
    syncRowOrderAcrossStages(s, TABLE, 'DEVL');
    expect(keys(s, 'TEST', 'id')).toEqual(['2', '3', '1']);
  });

  it('falls back to the first column when readKey is empty or not a column', () => {
    expect(session({ DEVL: rows(['a'], 'd') }).tables[TABLE].keyColumn).toBe('name');
    expect(session({ DEVL: rows(['a'], 'd') }, 'nope').tables[TABLE].keyColumn).toBe('name');
  });

  it('matches duplicate keys first-to-first and leaves rows without a key in place', () => {
    const s = session({
      DEVL: [{ name: 'a', n: 1 }, { name: 'a', n: 2 }, { name: 'b', n: 3 }],
      TEST: [{ name: '', n: 0 }, { name: 'a', n: 4 }, { name: 'b', n: 5 }, { name: 'a', n: 6 }],
    });
    moveRow(s, TABLE, 'DEVL', 2, 0); // b a(1) a(2)
    syncRowOrderAcrossStages(s, TABLE, 'DEVL');
    expect(keys(s, 'TEST', 'n')).toEqual([0, 5, 4, 6]);
  });

  it('syncs non-member stages after a group reorder without changing groups', () => {
    const s = session({
      DEVL: rows(['a', 'b', 'c'], 'same'),
      TEST: rows(['a', 'b', 'c'], 'same'),
      PROD: rows(['a', 'b', 'c', 'p'], 'prod'),
    });
    const before = findStageGroups(s.tables[TABLE], s.stageIds);
    const result = applyKpsTargetEdit(s, TABLE, { kind: 'group', memberIds: ['DEVL', 'TEST'] }, (id) =>
      moveRow(s, TABLE, id, 0, 2),
    );
    expect(result.applied).toBe(true);
    expect(syncRowOrderAcrossStages(s, TABLE, 'DEVL', ['DEVL', 'TEST'])).toEqual(['PROD']);
    expect(keys(s, 'TEST')).toEqual(['b', 'c', 'a']);
    expect(keys(s, 'PROD')).toEqual(['b', 'c', 'a', 'p']);
    expect(findStageGroups(s.tables[TABLE], s.stageIds)).toEqual(before);
  });

  it('reads readKey from the Store Group YAML', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-readkey-'));
    const policy = path.join(root, 'POLICY_yaml');
    const stores = path.join(policy, 'Environment Configuration', 'Key Property Stores', 'C');
    fs.mkdirSync(path.join(stores, 'Type Group'), { recursive: true });
    fs.mkdirSync(path.join(stores, 'Store Group'), { recursive: true });
    fs.mkdirSync(path.join(policy, 'Policies'), { recursive: true });
    fs.writeFileSync(path.join(policy, 'values.yaml'), '---\n');
    fs.writeFileSync(
      path.join(stores, 'Type Group', 'R.yaml'),
      `---
type: KPSType
fields:
  name: R
children:
- type: KPSTypeProperty
  fields:
    name: label
    type: java.lang.String
- type: KPSTypeProperty
  fields:
    name: id
    type: java.lang.String
`,
    );
    fs.writeFileSync(
      path.join(stores, 'Store Group', 'R.yaml'),
      `---
type: KPSReadWriteStore
fields:
  aliases: T_R
  type: /Environment Configuration/Key Property Stores/C/Type Group/R
  readKey: id
`,
    );
    fs.mkdirSync(path.join(root, 'KPS', 'DEVL'), { recursive: true });
    fs.writeFileSync(path.join(root, 'KPS', 'DEVL', 'T_R.json'), '[{"label":"x","id":"1"}]');
    const loaded = loadKpsSession(path.join(root, 'KPS'));
    expect(loaded.tables['T_R.json'].keyColumn).toBe('id');
  });
});
