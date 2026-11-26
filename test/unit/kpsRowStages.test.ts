import { describe, expect, it } from 'vitest';
import { buildKpsSession } from '../../src/features/kpsEditor/kpsTableModel';
import { setCell } from '../../src/features/kpsEditor/kpsTableMutations';
import {
  collectRowAcrossStages,
  keyIdLabel,
  rowKeyIdAt,
} from '../../src/features/kpsEditor/kpsRowStages';
import {
  buildKpsCellPatch,
  renderKpsEditorHtml,
  renderKpsRowDetail,
} from '../../src/features/kpsEditor/kpsPanelHtml';
import type { KpsSession } from '../../src/features/kpsEditor/types';

const TABLE = 'T_Routes.json';

function session(stages: Record<string, Array<Record<string, unknown>> | null | string>): KpsSession {
  const ids = Object.keys(stages);
  const contents: Record<string, string | null> = {};
  for (const id of ids) {
    const value = stages[id];
    contents[`${id}/${TABLE}`] =
      value === null ? null : typeof value === 'string' ? value : JSON.stringify(value);
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
    {},
  );
}

function sample(): KpsSession {
  return session({
    DEVL: [
      { name: 'a', url: 'a-devl' },
      { name: 'b', url: 'b-devl' },
    ],
    TEST: [
      { name: 'b', url: 'b-test' },
      { name: 'a', url: 'a-test' },
    ],
    PROD: [{ name: 'b', url: 'b-prod' }],
    UAT: null,
    BROKEN: '{not json',
  });
}

describe('kps row across stages', () => {
  it('finds the key in every stage and says why it is not in the others', () => {
    const s = sample();
    const keyId = rowKeyIdAt(s, TABLE, 'DEVL', 0)!;
    expect(keyIdLabel(keyId)).toBe('a');
    const entries = collectRowAcrossStages(s, TABLE, keyId);
    expect(entries.map((entry) => [entry.stageId, entry.status])).toEqual([
      ['DEVL', 'present'],
      ['TEST', 'present'],
      ['PROD', 'absent'],
      ['UAT', 'missing'],
      ['BROKEN', 'error'],
    ]);
    const test = entries[1];
    expect(test.status === 'present' && test.rowIndex).toBe(1);
    expect(test.status === 'present' && test.row.cells.url.value).toBe('a-test');
  });

  it('matches duplicate keys by occurrence', () => {
    const s = session({
      DEVL: [
        { name: 'a', url: '1' },
        { name: 'a', url: '2' },
      ],
      TEST: [
        { name: 'x', url: '0' },
        { name: 'a', url: '3' },
        { name: 'a', url: '4' },
      ],
    });
    const second = rowKeyIdAt(s, TABLE, 'DEVL', 1)!;
    const entry = collectRowAcrossStages(s, TABLE, second)[1];
    expect(entry.status === 'present' && entry.rowIndex).toBe(2);
  });

  it('has no key for a row with an empty key value', () => {
    const s = session({ DEVL: [{ name: '', url: 'x' }] });
    expect(rowKeyIdAt(s, TABLE, 'DEVL', 0)).toBeUndefined();
  });
});

describe('kps grid row numbers and all-stages panel', () => {
  it('numbers every row by its position in the stage file', () => {
    const html = renderKpsEditorHtml(sample(), {
      cspSource: 'x',
      stageTarget: { kind: 'stage', stageId: 'TEST' },
    });
    const numbers = [...html.matchAll(/<span class="row-num">(\d+)<\/span>/g)].map((m) => m[1]);
    expect(numbers).toEqual(['1', '2']);
    expect(html).toContain('class="row-expand" aria-expanded="false"');
  });

  it('disables the expander for a row without a key value', () => {
    const html = renderKpsEditorHtml(session({ DEVL: [{ name: '', url: 'x' }] }), { cspSource: 'x' });
    expect(html).toMatch(/<button class="row-expand" disabled/);
  });

  it('renders the open panel under its row with editable values per stage', () => {
    const s = sample();
    const keyId = rowKeyIdAt(s, TABLE, 'DEVL', 0)!;
    const html = renderKpsEditorHtml(s, {
      cspSource: 'x',
      stageTarget: { kind: 'stage', stageId: 'DEVL' },
      expandedRowKeys: [keyId],
    });
    const rowStart = html.indexOf('<tr data-row-index="0"');
    const detailStart = html.indexOf('<tr class="row-detail"');
    const nextRow = html.indexOf('<tr data-row-index="1"');
    expect(rowStart).toBeGreaterThan(-1);
    expect(detailStart).toBeGreaterThan(rowStart);
    expect(nextRow).toBeGreaterThan(detailStart);
    expect(html).toContain('aria-expanded="true"');

    const detail = renderKpsRowDetail(s, TABLE, keyId, 'DEVL');
    expect(detail).toContain('2 of 5 stages have this key');
    expect(detail).toMatch(/data-stage="TEST" data-stage-row="1" data-column="url" value="a-test"/);
    expect(detail).toContain('No row with this key in this stage');
    expect(detail).toContain('Table file missing in this stage');
    expect(detail).toContain('Invalid JSON');
    expect(detail).toContain('stage-line present current');
    // The panel's inputs are not grid inputs, so grid edits never pick them up.
    expect(detail).not.toContain('grid-input');
  });

  it('patches the other stage values when one stage is edited from the panel', () => {
    const s = sample();
    setCell(s, TABLE, 'TEST', 1, 'url', 'a-test-2');
    const patch = buildKpsCellPatch(
      s,
      TABLE,
      { kind: 'stage', stageId: 'DEVL' },
      { rowIndex: 1, column: 'url', stageId: 'TEST', fromDetail: true },
    )!;
    expect(s.tables[TABLE].stages.TEST.dirty).toBe(true);
    expect(s.tables[TABLE].stages.DEVL.dirty).toBe(false);
    expect(patch.stageValues?.values).toEqual([
      { stageId: 'DEVL', rowIndex: 0, value: 'a-devl', warning: undefined },
      { stageId: 'TEST', rowIndex: 1, value: 'a-test-2', warning: undefined },
    ]);
    expect(patch.cell?.rowIndex).toBe(0);
    expect(patch.detailAnchor).toEqual({ keyId: rowKeyIdAt(s, TABLE, 'TEST', 1), stageId: 'TEST', column: 'url' });
  });
});
