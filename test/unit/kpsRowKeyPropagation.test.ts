import { describe, expect, it } from 'vitest';
import { buildKpsSession } from '../../src/features/kpsEditor/kpsTableModel';
import { addRow, setCell } from '../../src/features/kpsEditor/kpsTableMutations';
import { addKeyRowToOtherStages } from '../../src/features/kpsEditor/kpsRowKeyPropagation';
import { applyKpsTargetEdit } from '../../src/features/kpsEditor/kpsStageGroups';
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

function rows(s: KpsSession, stageId: string): Array<Record<string, unknown>> {
  return s.tables[TABLE].stages[stageId].rows.map((row) =>
    Object.fromEntries(Object.entries(row.cells).map(([column, cell]) => [column, cell.value])),
  );
}

function addAndKey(s: KpsSession, stageId: string, key: string, column = 'name'): string[] {
  addRow(s, TABLE, stageId);
  const index = s.tables[TABLE].stages[stageId].rows.length - 1;
  setCell(s, TABLE, stageId, index, column, key);
  return addKeyRowToOtherStages(s, TABLE, stageId, index, [stageId]);
}

describe('new KPS row key added to every stage', () => {
  it('adds a row with only the key to every other present stage', () => {
    const s = session({
      DEVL: [{ name: 'a', url: 'a-devl' }],
      TEST: [{ name: 'a', url: 'a-test' }],
      PROD: [{ name: 'a', url: 'a-prod' }],
      UAT: null,
    });
    const changed = addAndKey(s, 'DEVL', 'new');
    expect(changed).toEqual(['TEST', 'PROD']);
    expect(rows(s, 'TEST')).toEqual([
      { name: 'a', url: 'a-test' },
      { name: 'new', url: '' },
    ]);
    expect(s.tables[TABLE].stages.TEST.dirty).toBe(true);
    expect(s.tables[TABLE].stages.UAT.status).toBe('missing');
  });

  it('skips a stage that already has that key value', () => {
    const s = session({
      DEVL: [{ name: 'a', url: '1' }],
      TEST: [{ name: 'x', url: '2' }],
    });
    expect(addAndKey(s, 'DEVL', 'x')).toEqual([]);
    expect(rows(s, 'TEST')).toEqual([{ name: 'x', url: '2' }]);
    expect(s.tables[TABLE].stages.TEST.dirty).toBe(false);
  });

  it('places the row after the nearest preceding key the stage has', () => {
    const s = session({
      DEVL: [
        { name: 'a', url: '' },
        { name: 'b', url: '' },
        { name: '', url: '' },
        { name: 'c', url: '' },
      ],
      TEST: [
        { name: 'c', url: '' },
        { name: 'a', url: '' },
        { name: 'z', url: '' },
      ],
    });
    setCell(s, TABLE, 'DEVL', 2, 'name', 'new');
    addKeyRowToOtherStages(s, TABLE, 'DEVL', 2, ['DEVL']);
    expect(rows(s, 'TEST').map((row) => row.name)).toEqual(['c', 'a', 'new', 'z']);
  });

  it('places the row before the nearest following key when none precedes it', () => {
    const s = session({
      DEVL: [
        { name: '', url: '' },
        { name: 'b', url: '' },
      ],
      TEST: [
        { name: 'x', url: '' },
        { name: 'b', url: '' },
      ],
    });
    setCell(s, TABLE, 'DEVL', 0, 'name', 'new');
    addKeyRowToOtherStages(s, TABLE, 'DEVL', 0, ['DEVL']);
    expect(rows(s, 'TEST').map((row) => row.name)).toEqual(['x', 'new', 'b']);
  });

  it('matches duplicate neighbour keys by occurrence', () => {
    const s = session({
      DEVL: [
        { name: 'a', url: '1' },
        { name: '', url: '' },
        { name: 'a', url: '2' },
      ],
      TEST: [
        { name: 'a', url: '3' },
        { name: 'a', url: '4' },
      ],
    });
    setCell(s, TABLE, 'DEVL', 1, 'name', 'new');
    addKeyRowToOtherStages(s, TABLE, 'DEVL', 1, ['DEVL']);
    expect(rows(s, 'TEST').map((row) => row.url)).toEqual(['3', '', '4']);
  });

  it('uses the Store Group readKey column and copies the key value as stored', () => {
    const s = session(
      {
        DEVL: [{ name: 'a', id: 1 }],
        TEST: [{ name: 'a', id: 1 }],
      },
      'id',
    );
    addRow(s, TABLE, 'DEVL');
    setCell(s, TABLE, 'DEVL', 1, 'id', '7');
    expect(addKeyRowToOtherStages(s, TABLE, 'DEVL', 1, ['DEVL'])).toEqual(['TEST']);
    expect(rows(s, 'TEST')[1]).toEqual({ name: '', id: rows(s, 'DEVL')[1].id });
    expect(rows(s, 'TEST')[1].id).toBe('7');
  });

  it('does nothing for a row without a key value', () => {
    const s = session({ DEVL: [{ name: 'a', url: '' }], TEST: [] });
    addRow(s, TABLE, 'DEVL');
    expect(addKeyRowToOtherStages(s, TABLE, 'DEVL', 1, ['DEVL'])).toEqual([]);
  });

  it('skips group members the edit already wrote and fills the other stages', () => {
    const s = session({
      DEVL: [{ name: 'a', url: '1' }],
      TEST: [{ name: 'a', url: '1' }],
      PROD: [{ name: 'a', url: '2' }],
    });
    const group = { kind: 'group' as const, memberIds: ['DEVL', 'TEST'] };
    applyKpsTargetEdit(s, TABLE, group, (id) => addRow(s, TABLE, id));
    applyKpsTargetEdit(s, TABLE, group, (id) => setCell(s, TABLE, id, 1, 'name', 'new'));
    expect(addKeyRowToOtherStages(s, TABLE, 'DEVL', 1, ['DEVL', 'TEST'])).toEqual(['PROD']);
    expect(rows(s, 'TEST').map((row) => row.name)).toEqual(['a', 'new']);
    expect(rows(s, 'PROD').map((row) => row.name)).toEqual(['a', 'new']);
  });
});
