# KPS Stage Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When two or more stages of a KPS table hold the same rows, show a group badge that edits those stages together, while every stage stays individually selectable.

**Architecture:** A pure module computes equality groups from the in-memory table and applies a group edit by cloning the first member's rows, running the existing cell/row mutation on that clone, and copying the result onto every member only when the mutation succeeds. The webview service stores the current target (`group` or `stage`) and the panel renders group badges plus the existing stage badges. Groups are never stored on `KpsSession`.

**Tech Stack:** TypeScript, Vitest, VS Code webview (existing KPS editor). Tests run with `npx vitest run`.

## Global Constraints

- Groups are recomputed from current row content after load and after every edit. Nothing stores a separate link between stages.
- Only stages whose file is present and parsed can join. Missing and error stages stay individual badges.
- Equality is a multiset of rows. Row order does not matter. Duplicate rows count. Element order inside a list matters. Cell warnings and JSON key order do not matter.
- Each equivalence class of two or more stages is one group. A stage that matches nobody has no group badge.
- Badge text is member ids in discovery order joined by `/`. The grid shows the first member's row order.
- On open and on every table switch, the largest group becomes active. A tie goes to the group whose first member appears earliest in discovery order. With no group, select the first present stage, otherwise the first stage. Switching tables does not keep the previous table's stage or group.
- While a group is active, that group badge and its member badges are highlighted. A stage click selects only that stage. Group badges stay visible.
- A group edit clones the first member's rows, runs the existing mutation (including list parsing), and on success replaces every member with a deep copy and marks each dirty. A rejected edit changes no member.
- A single-stage edit changes only that stage. Selection stays on that stage when it leaves or joins a group.
- If the active group's exact member set no longer exists, selection falls back to the first of those members as a single stage.
- Create missing leaves selection on the stage that was created.
- Save still writes only dirty stage files. In a group view, Open JSON opens the first member's file. Reload, Switch KPS, and dirty-discard confirms stay as they are.
- Update `specs/012-kps-editor.md` so matching stages are edited together. Diff highlighting of unequal tables stays out of scope.
- Do not link stages whose rows differ, edit a missing or error stage through a group, add a per-item list control, or change pretty-print rules.

---

### Task 1: Stage equality groups

**Files:**
- Modify: `specs/012-kps-editor.md`
- Create: `src/features/kpsEditor/kpsStageGroups.ts`
- Test: `test/unit/kpsEditor.test.ts`

**Interfaces:**
- Consumes: `KpsTableModel`, `KpsRow`, `KpsSession` from `src/features/kpsEditor/types.ts`; `loadKpsSession`.
- Produces:
  - `export interface KpsStageGroup { memberIds: string[]; label: string }`
  - `export function findStageGroups(table: KpsTableModel, stageIds: string[]): KpsStageGroup[]`
  - Test helper `writeStageGroupFixture(root: string): { kpsRoot: string; tableName: string }` in `test/unit/kpsEditor.test.ts`. Stages, in `localeCompare` order: `BAD`, `DEVL`, `HUTL`, `LONE`, `MISS`, `NEST`, `PROD`, `QA`, `SCALAR`, `TEST`. Table name `T_Tags.json`. `DEVL` and `TEST` share one multiset. `PROD` and `QA` share another. `HUTL` differs by list element order. `NEST` differs by nested `meta`. `SCALAR` has a string in the list column. `MISS` has no `T_Tags.json`. `BAD` has invalid JSON.

- [ ] **Step 1: Update the feature spec**

In `specs/012-kps-editor.md`, replace item 7 under **Model**:

```markdown
7. Rows may differ per stage. When two or more present stages contain the same rows as a multiset, they form a stage group (see Stage groups).
```

Replace the **Add row** and **Remove row** bullets under **Editor UI** with:

```markdown
- **Stage groups:** For the selected table, present stages with the same row multiset form a group badge labeled with their ids in discovery order joined by `/` (example: `DEVL/TEST`). Row order and JSON key order do not matter. Duplicate rows count. List element order matters. Nested values matter. Cell warnings do not. Missing and error stages are never members. The stage bar shows every group badge first (ordered by each group's first member), then every stage badge. On open and on every table switch, the largest group is selected; a tie goes to the group whose first member appears earliest. With no group, the first present stage is selected, otherwise the first stage. Switching tables does not keep the previous selection. While a group is selected, its badge and its member badges are highlighted, and the grid shows the first member's row order. Edits in that view write that one row list to every member. A stage badge selects only that stage; a later edit that makes it differ removes it from the group, and a later edit that makes stages match creates or grows a group, without moving the current selection. If the selected group's exact member set disappears, selection falls back to the first of those members. **Create missing** leaves selection on that stage. An empty file joins a group of other empty stages on the next compute. A rejected cell edit changes no member of a group. **Open JSON** in a group view opens the first member's file.
- **Add row:** In a single-stage view, appends a row to that stage only. In a group view, appends the same new row to every member. Columns with a schema default to `""` (string), `false` (boolean), `0` (integer/number), or `[]` (list); columns without a schema default to `""`.
- **Remove row:** In a single-stage view, removes that row from that stage only (confirm for v1). In a group view, one confirm removes that row index from the shared row list and writes the result to every member.
```

Replace the non-goal `Cross-stage row sync or equality/diff highlighting` with:

```markdown
- Diff highlighting between stages whose rows differ
- Keeping stages linked after their rows diverge
```

Add this acceptance criterion after the layout B criterion:

```markdown
- [ ] A table whose present stages share the same rows shows a group badge (for example `DEVL/TEST`) that edits those stages together, highlights the member badges, and still allows selecting one stage on its own. Stages that differ, and missing or invalid stages, stay individual.
```

Add this note under **Notes**:

```markdown
- Stage groups: `docs/superpowers/specs/2026-09-22-kps-stage-groups-design.md`
```

- [ ] **Step 2: Write the failing tests**

Append this helper and describe block to `test/unit/kpsEditor.test.ts`. Import `findStageGroups` from `../../src/features/kpsEditor/kpsStageGroups`.

```ts
function writeStageGroupFixture(root: string): { kpsRoot: string; tableName: string } {
  const policyRoot = path.join(root, 'POLICY_yaml');
  const typeDir = path.join(
    policyRoot,
    'Environment Configuration',
    'Key Property Stores',
    'JWT_Collection',
    'Type Group',
  );
  const storeDir = path.join(
    policyRoot,
    'Environment Configuration',
    'Key Property Stores',
    'JWT_Collection',
    'Store Group',
  );
  fs.mkdirSync(typeDir, { recursive: true });
  fs.mkdirSync(storeDir, { recursive: true });
  fs.mkdirSync(path.join(policyRoot, 'Policies'), { recursive: true });
  fs.writeFileSync(path.join(policyRoot, 'values.yaml'), '---\n');
  fs.writeFileSync(
    path.join(typeDir, 'Tags.yaml'),
    `---
type: KPSType
fields:
  name: Tags
children:
- type: KPSTypeProperty
  fields:
    name: name
    type: java.lang.String
    key: ""
    value: ""
- type: KPSTypeProperty
  fields:
    name: enabled
    type: java.lang.Boolean
    key: ""
    value: ""
- type: KPSTypeProperty
  fields:
    name: codes
    type: java.util.List
    key: ""
    value: java.lang.Integer
`,
  );
  fs.writeFileSync(
    path.join(storeDir, 'Tags.yaml'),
    `---
type: KPSReadWriteStore
fields:
  aliases: T_Tags
  type: Environment Configuration/Key Property Stores/JWT_Collection/Type Group/Tags.yaml
`,
  );
  const shared = [
    { name: 'a', enabled: true, codes: [1, 2], meta: { n: 1 } },
    { name: 'b', enabled: true, codes: [3] },
  ];
  const files: Record<string, string> = {
    DEVL: JSON.stringify(shared),
    TEST: JSON.stringify([
      { codes: [3], enabled: true, name: 'b' },
      { meta: { n: 1 }, codes: [1, 2], enabled: true, name: 'a' },
    ]),
    HUTL: JSON.stringify([
      { name: 'a', enabled: true, codes: [2, 1], meta: { n: 1 } },
      { name: 'b', enabled: true, codes: [3] },
    ]),
    NEST: JSON.stringify([
      { name: 'a', enabled: true, codes: [1, 2], meta: { n: 2 } },
      { name: 'b', enabled: true, codes: [3] },
    ]),
    SCALAR: JSON.stringify([
      { name: 'a', enabled: true, codes: '1,2', meta: { n: 1 } },
      { name: 'b', enabled: true, codes: [3] },
    ]),
    PROD: JSON.stringify([{ name: 'z', enabled: true, codes: [] }]),
    QA: JSON.stringify([{ name: 'z', enabled: true, codes: [] }]),
    LONE: JSON.stringify([{ name: 'only', enabled: true, codes: [9] }]),
    BAD: 'not-json',
  };
  for (const [stageId, body] of Object.entries(files)) {
    const stageDir = path.join(root, 'KPS', stageId);
    fs.mkdirSync(stageDir, { recursive: true });
    fs.writeFileSync(path.join(stageDir, 'T_Tags.json'), body);
  }
  const missDir = path.join(root, 'KPS', 'MISS');
  fs.mkdirSync(missDir, { recursive: true });
  fs.writeFileSync(path.join(missDir, 'T_Other.json'), '[]');
  return { kpsRoot: path.join(root, 'KPS'), tableName: 'T_Tags.json' };
}

describe('kps stage groups', () => {
  function loadGroups(): { session: ReturnType<typeof loadKpsSession>; tableName: string } {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-groups-'));
    const fixture = writeStageGroupFixture(tmp);
    return { session: loadKpsSession(fixture.kpsRoot), tableName: fixture.tableName };
  }

  it('groups stages with the same rows regardless of row and key order', () => {
    const { session, tableName } = loadGroups();
    const groups = findStageGroups(session.tables[tableName], session.stageIds);
    expect(groups.map((group) => group.label)).toEqual(['DEVL/TEST', 'PROD/QA']);
    expect(groups[0].memberIds).toEqual(['DEVL', 'TEST']);
  });

  it('does not group a different list order, nested value, or scalar in a list column', () => {
    const { session, tableName } = loadGroups();
    const members = findStageGroups(session.tables[tableName], session.stageIds).flatMap(
      (group) => group.memberIds,
    );
    expect(members).not.toContain('HUTL');
    expect(members).not.toContain('NEST');
    expect(members).not.toContain('SCALAR');
    expect(members).not.toContain('LONE');
  });

  it('excludes missing and invalid stages', () => {
    const { session, tableName } = loadGroups();
    expect(session.tables[tableName].stages.MISS.status).toBe('missing');
    expect(session.tables[tableName].stages.BAD.status).toBe('error');
    const members = findStageGroups(session.tables[tableName], session.stageIds).flatMap(
      (group) => group.memberIds,
    );
    expect(members).not.toContain('MISS');
    expect(members).not.toContain('BAD');
  });

  it('ignores cell warnings and nested key order', () => {
    const { session, tableName } = loadGroups();
    const table = session.tables[tableName];
    table.stages.DEVL.rows[0].cells.name!.warning = 'cosmetic';
    const devlMeta = table.stages.DEVL.rows.find((row) => row.cells.name?.value === 'a')!;
    const testMeta = table.stages.TEST.rows.find((row) => row.cells.name?.value === 'a')!;
    devlMeta.extra.meta = { n: 1, z: true };
    devlMeta.cells.meta = { editable: false, nested: devlMeta.extra.meta, warning: 'nested' };
    testMeta.extra.meta = { z: true, n: 1 };
    testMeta.cells.meta = { editable: false, nested: testMeta.extra.meta, warning: 'nested' };
    const labels = findStageGroups(table, session.stageIds).map((group) => group.label);
    expect(labels).toContain('DEVL/TEST');
  });

  it('counts duplicate rows in the multiset', () => {
    const { session, tableName } = loadGroups();
    const table = session.tables[tableName];
    table.stages.DEVL.rows.push(structuredClone(table.stages.DEVL.rows[0]));
    expect(
      findStageGroups(table, session.stageIds).some((group) => group.memberIds.includes('DEVL')),
    ).toBe(false);
    const testRowA = table.stages.TEST.rows.find((row) => row.cells.name?.value === 'a')!;
    table.stages.TEST.rows.push(structuredClone(testRowA));
    expect(findStageGroups(table, session.stageIds).map((group) => group.label)).toContain(
      'DEVL/TEST',
    );
  });

  it('groups present stages that are both empty', () => {
    const { session, tableName } = loadGroups();
    const table = session.tables[tableName];
    table.stages.HUTL.rows = [];
    table.stages.LONE.rows = [];
    expect(findStageGroups(table, session.stageIds).map((group) => group.label)).toContain(
      'HUTL/LONE',
    );
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/unit/kpsEditor.test.ts -t "kps stage groups"`

Expected: FAIL because `../../src/features/kpsEditor/kpsStageGroups` cannot be resolved.

- [ ] **Step 4: Implement grouping**

Create `src/features/kpsEditor/kpsStageGroups.ts`:

```ts
import type { KpsRow, KpsTableModel } from './types';

export interface KpsStageGroup {
  memberIds: string[];
  label: string;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = stableValue(record[key]);
    }
    return sorted;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function rowContent(row: KpsRow): Record<string, unknown> {
  const keys = new Set([...Object.keys(row.cells), ...Object.keys(row.extra)]);
  const content: Record<string, unknown> = {};
  for (const key of keys) {
    const cell = row.cells[key];
    if (cell?.editable) {
      content[key] = cell.value === undefined ? '' : cell.value;
      continue;
    }
    if (key in row.extra) {
      content[key] = row.extra[key];
      continue;
    }
    if (cell && cell.nested !== undefined) {
      content[key] = cell.nested;
    }
  }
  return content;
}

function stageSignature(rows: KpsRow[]): string {
  return rows
    .map((row) => stableStringify(rowContent(row)))
    .sort()
    .join('\n');
}

export function findStageGroups(table: KpsTableModel, stageIds: string[]): KpsStageGroup[] {
  const bySignature = new Map<string, string[]>();
  for (const stageId of stageIds) {
    const stage = table.stages[stageId];
    if (!stage || stage.status !== 'present') {
      continue;
    }
    const signature = stageSignature(stage.rows);
    const members = bySignature.get(signature) ?? [];
    members.push(stageId);
    bySignature.set(signature, members);
  }

  const groups: KpsStageGroup[] = [];
  for (const memberIds of bySignature.values()) {
    if (memberIds.length < 2) {
      continue;
    }
    groups.push({ memberIds: [...memberIds], label: memberIds.join('/') });
  }
  groups.sort(
    (a, b) => stageIds.indexOf(a.memberIds[0]) - stageIds.indexOf(b.memberIds[0]),
  );
  return groups;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/unit/kpsEditor.test.ts -t "kps stage groups"`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add specs/012-kps-editor.md src/features/kpsEditor/kpsStageGroups.ts test/unit/kpsEditor.test.ts
git commit -m "feat(kps-editor): detect stages that share the same rows"
```

---

### Task 2: Default selection and dissolved groups

**Files:**
- Modify: `src/features/kpsEditor/kpsStageGroups.ts`
- Test: `test/unit/kpsEditor.test.ts`

**Interfaces:**
- Consumes: `findStageGroups`, `KpsStageGroup`, `writeStageGroupFixture`, `loadKpsSession`.
- Produces:
  - `export type KpsStageTarget = { kind: 'group'; memberIds: string[] } | { kind: 'stage'; stageId: string }`
  - `export function defaultStageTarget(table: KpsTableModel, stageIds: string[]): KpsStageTarget`
  - `export function resolveStageTarget(current: KpsStageTarget, table: KpsTableModel, stageIds: string[]): KpsStageTarget`
  - `export function isExactStageGroup(table: KpsTableModel, stageIds: string[], memberIds: string[]): boolean`

- [ ] **Step 1: Write the failing tests**

Import `defaultStageTarget`, `resolveStageTarget`, and `isExactStageGroup`. Append:

```ts
describe('kps stage group selection', () => {
  function loadGroups(): { session: ReturnType<typeof loadKpsSession>; tableName: string } {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-group-selection-'));
    const fixture = writeStageGroupFixture(tmp);
    return { session: loadKpsSession(fixture.kpsRoot), tableName: fixture.tableName };
  }

  it('selects the largest group, breaking ties by the earliest first member', () => {
    const { session, tableName } = loadGroups();
    expect(defaultStageTarget(session.tables[tableName], session.stageIds)).toEqual({
      kind: 'group',
      memberIds: ['DEVL', 'TEST'],
    });
  });

  it('selects the first present stage when nothing matches', () => {
    const { session, tableName } = loadGroups();
    const table = session.tables[tableName];
    table.stages.TEST.rows[0].cells.name!.value = 'different';
    table.stages.QA.rows[0].cells.name!.value = 'different-too';
    const present = session.stageIds.find((id) => table.stages[id]?.status === 'present');
    expect(defaultStageTarget(table, session.stageIds)).toEqual({
      kind: 'stage',
      stageId: present,
    });
  });

  it('keeps a single-stage selection after that stage leaves its group', () => {
    const { session, tableName } = loadGroups();
    const table = session.tables[tableName];
    table.stages.DEVL.rows[0].cells.name!.value = 'only-devl';
    expect(
      resolveStageTarget({ kind: 'stage', stageId: 'DEVL' }, table, session.stageIds),
    ).toEqual({ kind: 'stage', stageId: 'DEVL' });
    expect(isExactStageGroup(table, session.stageIds, ['DEVL', 'TEST'])).toBe(false);
  });

  it('falls back to the first former member when the selected group dissolves', () => {
    const { session, tableName } = loadGroups();
    const table = session.tables[tableName];
    table.stages.DEVL.rows[0].cells.name!.value = 'only-devl';
    expect(
      resolveStageTarget(
        { kind: 'group', memberIds: ['DEVL', 'TEST'] },
        table,
        session.stageIds,
      ),
    ).toEqual({ kind: 'stage', stageId: 'DEVL' });
  });

  it('keeps a group whose exact member set still exists', () => {
    const { session, tableName } = loadGroups();
    expect(
      resolveStageTarget(
        { kind: 'group', memberIds: ['QA', 'PROD'] },
        session.tables[tableName],
        session.stageIds,
      ),
    ).toEqual({ kind: 'group', memberIds: ['PROD', 'QA'] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/kpsEditor.test.ts -t "kps stage group selection"`

Expected: FAIL because `defaultStageTarget` is not exported.

- [ ] **Step 3: Implement selection**

Append to `src/features/kpsEditor/kpsStageGroups.ts`:

```ts
export type KpsStageTarget =
  | { kind: 'group'; memberIds: string[] }
  | { kind: 'stage'; stageId: string };

function sameMemberSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const ids = new Set(left);
  return right.every((id) => ids.has(id));
}

export function isExactStageGroup(
  table: KpsTableModel,
  stageIds: string[],
  memberIds: string[],
): boolean {
  return findStageGroups(table, stageIds).some((group) =>
    sameMemberSet(group.memberIds, memberIds),
  );
}

export function defaultStageTarget(table: KpsTableModel, stageIds: string[]): KpsStageTarget {
  const groups = findStageGroups(table, stageIds);
  if (groups.length > 0) {
    const ranked = [...groups].sort((a, b) => {
      if (b.memberIds.length !== a.memberIds.length) {
        return b.memberIds.length - a.memberIds.length;
      }
      return stageIds.indexOf(a.memberIds[0]) - stageIds.indexOf(b.memberIds[0]);
    });
    return { kind: 'group', memberIds: [...ranked[0].memberIds] };
  }
  const present = stageIds.find((id) => table.stages[id]?.status === 'present');
  return { kind: 'stage', stageId: present ?? stageIds[0] ?? '' };
}

export function resolveStageTarget(
  current: KpsStageTarget,
  table: KpsTableModel,
  stageIds: string[],
): KpsStageTarget {
  if (current.kind === 'stage') {
    if (stageIds.includes(current.stageId) && table.stages[current.stageId]) {
      return current;
    }
    return defaultStageTarget(table, stageIds);
  }
  const match = findStageGroups(table, stageIds).find((group) =>
    sameMemberSet(group.memberIds, current.memberIds),
  );
  if (match) {
    return { kind: 'group', memberIds: [...match.memberIds] };
  }
  const fallback = stageIds.find((id) => current.memberIds.includes(id));
  if (fallback) {
    return { kind: 'stage', stageId: fallback };
  }
  return defaultStageTarget(table, stageIds);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/unit/kpsEditor.test.ts -t "kps stage group selection"`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/kpsEditor/kpsStageGroups.ts test/unit/kpsEditor.test.ts
git commit -m "feat(kps-editor): choose the largest matching stage group by default"
```

---

### Task 3: Group edits

**Files:**
- Modify: `src/features/kpsEditor/kpsStageGroups.ts`
- Test: `test/unit/kpsEditor.test.ts`

**Interfaces:**
- Consumes: `setCell` from `src/features/kpsEditor/kpsTableMutations.ts`, `isExactStageGroup`, `KpsStageTarget`, `writeStageGroupFixture`.
- Produces:
  - `export function applyStageGroupEdit(session: KpsSession, tableName: string, memberIds: string[], edit: (stageId: string) => void): boolean`
  - `export function applyKpsTargetEdit(session: KpsSession, tableName: string, target: KpsStageTarget, edit: (stageId: string) => void): { applied: boolean; target: KpsStageTarget }`

`applyStageGroupEdit` returns `false` when `memberIds` is not exactly one current group, and does not call `edit`. Otherwise it clones the first member in `stageIds` order, calls `edit` with that stage id, and on success deep-copies the resulting rows onto every member and marks each dirty. A rejected edit restores the canonical stage's previous rows and dirty flag, leaves every other member untouched, and still returns `true` so the caller can re-render the banner warning. A thrown edit restores the canonical stage and rethrows.

`applyKpsTargetEdit` runs `edit` for a stage target, or `applyStageGroupEdit` for a group target. It returns `applied: false` and the original target when the group is stale. Otherwise it returns `applied: true` and `resolveStageTarget` of the target that was edited.

- [ ] **Step 1: Write the failing tests**

Import `applyStageGroupEdit`, `applyKpsTargetEdit`, and `findStageGroups`. Import `addRow` and `removeRow` from `kpsTableMutations` if they are not already imported. Append:

```ts
describe('kps stage group edits', () => {
  function loadGroups(): { session: ReturnType<typeof loadKpsSession>; tableName: string } {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-group-edit-'));
    const fixture = writeStageGroupFixture(tmp);
    return { session: loadKpsSession(fixture.kpsRoot), tableName: fixture.tableName };
  }

  it('writes one row list, including a list cell, to every member', () => {
    const { session, tableName } = loadGroups();
    const applied = applyStageGroupEdit(session, tableName, ['TEST', 'DEVL'], (stageId) => {
      setCell(session, tableName, stageId, 0, 'codes', '[4]');
    });
    expect(applied).toBe(true);
    for (const stageId of ['DEVL', 'TEST']) {
      const stage = session.tables[tableName].stages[stageId];
      expect(stage.dirty).toBe(true);
      expect(stage.rows.map((row) => row.cells.name?.value)).toEqual(['a', 'b']);
      expect(stage.rows[0].cells.codes?.value).toEqual([4]);
    }
    expect(session.tables[tableName].stages.HUTL.dirty).toBe(false);
    const devlCodes = session.tables[tableName].stages.DEVL.rows[0].cells.codes?.value as number[];
    devlCodes.push(9);
    expect(session.tables[tableName].stages.TEST.rows[0].cells.codes?.value).toEqual([4]);
  });

  it('leaves every member unchanged when list text is rejected', () => {
    const { session, tableName } = loadGroups();
    const before = structuredClone(session.tables[tableName].stages.DEVL.rows);
    const applied = applyStageGroupEdit(session, tableName, ['DEVL', 'TEST'], (stageId) => {
      setCell(session, tableName, stageId, 0, 'codes', '{');
    });
    expect(applied).toBe(true);
    expect(session.editWarning).toBe('Could not set "codes" to a list');
    expect(session.tables[tableName].stages.DEVL.dirty).toBe(false);
    expect(session.tables[tableName].stages.TEST.dirty).toBe(false);
    expect(session.tables[tableName].stages.DEVL.rows).toEqual(before);
    expect(session.tables[tableName].stages.TEST.rows[0].cells.name?.value).toBe('b');
  });

  it('leaves every member unchanged when a scalar edit is rejected', () => {
    const { session, tableName } = loadGroups();
    applyStageGroupEdit(session, tableName, ['DEVL', 'TEST'], (stageId) => {
      setCell(session, tableName, stageId, 0, 'enabled', 'nope');
    });
    expect(session.editWarning).toBe('Could not set "enabled" to "nope" as boolean');
    expect(session.tables[tableName].stages.DEVL.dirty).toBe(false);
    expect(session.tables[tableName].stages.TEST.dirty).toBe(false);
    expect(session.tables[tableName].stages.DEVL.rows[0].cells.enabled?.value).toBe(true);
  });

  it('does not edit a stale group', () => {
    const { session, tableName } = loadGroups();
    const applied = applyStageGroupEdit(session, tableName, ['DEVL', 'HUTL'], () => {
      throw new Error('edit should not run');
    });
    expect(applied).toBe(false);
    expect(session.tables[tableName].stages.DEVL.dirty).toBe(false);
  });

  it('keeps a single-stage edit on that stage after the group shrinks', () => {
    const { session, tableName } = loadGroups();
    const result = applyKpsTargetEdit(
      session,
      tableName,
      { kind: 'stage', stageId: 'DEVL' },
      (stageId) => {
        setCell(session, tableName, stageId, 0, 'name', 'only-devl');
      },
    );
    expect(result).toEqual({ applied: true, target: { kind: 'stage', stageId: 'DEVL' } });
    expect(session.tables[tableName].stages.DEVL.rows[0].cells.name?.value).toBe('only-devl');
    expect(session.tables[tableName].stages.TEST.dirty).toBe(false);
    expect(
      findStageGroups(session.tables[tableName], session.stageIds).some((group) =>
        group.memberIds.includes('DEVL'),
      ),
    ).toBe(false);
  });

  it('adds and removes a row on every member', () => {
    const { session, tableName } = loadGroups();
    applyStageGroupEdit(session, tableName, ['DEVL', 'TEST'], (stageId) => {
      addRow(session, tableName, stageId);
    });
    expect(session.tables[tableName].stages.DEVL.rows).toHaveLength(3);
    expect(session.tables[tableName].stages.TEST.rows).toHaveLength(3);
    expect(session.tables[tableName].stages.HUTL.rows).toHaveLength(2);
    applyStageGroupEdit(session, tableName, ['DEVL', 'TEST'], (stageId) => {
      removeRow(session, tableName, stageId, 2);
    });
    expect(session.tables[tableName].stages.DEVL.rows).toHaveLength(2);
    expect(session.tables[tableName].stages.TEST.rows).toHaveLength(2);
  });
});
```

Add `findStageGroups` to the import in this describe's file if it is not already imported.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/kpsEditor.test.ts -t "kps stage group edits"`

Expected: FAIL because `applyStageGroupEdit` is not exported.

- [ ] **Step 3: Implement group edits**

Append to `src/features/kpsEditor/kpsStageGroups.ts`. Import `KpsSession` from `./types`.

```ts
function rowsUnchanged(left: KpsRow[], right: KpsRow[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function applyStageGroupEdit(
  session: KpsSession,
  tableName: string,
  memberIds: string[],
  edit: (stageId: string) => void,
): boolean {
  const table = session.tables[tableName];
  if (!table || !isExactStageGroup(table, session.stageIds, memberIds)) {
    return false;
  }
  const ordered = session.stageIds.filter((id) => memberIds.includes(id));
  const canonicalId = ordered[0];
  const canonical = table.stages[canonicalId];
  const originalRows = canonical.rows;
  const dirtyBefore = canonical.dirty;
  canonical.rows = structuredClone(originalRows);
  try {
    edit(canonicalId);
  } catch (error) {
    canonical.rows = originalRows;
    canonical.dirty = dirtyBefore;
    throw error;
  }
  if (rowsUnchanged(canonical.rows, originalRows) && canonical.dirty === dirtyBefore) {
    canonical.rows = originalRows;
    return true;
  }
  const result = structuredClone(canonical.rows);
  for (const stageId of ordered) {
    table.stages[stageId].rows = structuredClone(result);
    table.stages[stageId].dirty = true;
  }
  return true;
}

export function applyKpsTargetEdit(
  session: KpsSession,
  tableName: string,
  target: KpsStageTarget,
  edit: (stageId: string) => void,
): { applied: boolean; target: KpsStageTarget } {
  const table = session.tables[tableName];
  if (!table) {
    return { applied: false, target };
  }
  if (target.kind === 'stage') {
    edit(target.stageId);
    return {
      applied: true,
      target: resolveStageTarget(target, table, session.stageIds),
    };
  }
  const applied = applyStageGroupEdit(session, tableName, target.memberIds, edit);
  if (!applied) {
    return { applied: false, target };
  }
  return {
    applied: true,
    target: resolveStageTarget(target, table, session.stageIds),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/unit/kpsEditor.test.ts -t "kps stage group edits"`

Expected: PASS. Also run `npx vitest run test/unit/kpsEditor.test.ts -t "adds and removes rows on the active stage only"` and expect PASS, so single-stage mutations are unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/features/kpsEditor/kpsStageGroups.ts test/unit/kpsEditor.test.ts
git commit -m "feat(kps-editor): apply one edit to every stage in a group"
```

---

### Task 4: Group badges in the panel

**Files:**
- Modify: `src/features/kpsEditor/kpsPanelHtml.ts`
- Test: `test/unit/kpsEditor.test.ts`

**Interfaces:**
- Consumes: `findStageGroups`, `defaultStageTarget`, `resolveStageTarget`, `KpsStageTarget`, `writeStageGroupFixture`.
- Produces: `renderKpsEditorHtml` accepts `stageTarget?: KpsStageTarget` in addition to the existing `stageId?: string`. A passed `stageTarget` is resolved against the current groups. A passed `stageId` without `stageTarget` stays a single-stage view. With neither, the default target is used. Group buttons use class `stage-group` and `data-group="DEVL,TEST"`. Member badges use class `member` only while that group is the active target. The embedded script sets `const target` to the active `KpsStageTarget` and `const gridStageId` to the first member, or the selected stage.

- [ ] **Step 1: Write the failing test**

Import `KpsStageTarget` only if the test annotates the option. Append inside `describe('kps panel html', ...)`:

```ts
it('renders a stage group badge, member highlighting, and individual badges', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-group-html-'));
  const fixture = writeStageGroupFixture(tmp);
  const session = loadKpsSession(fixture.kpsRoot);
  const grouped = renderKpsEditorHtml(session, {
    cspSource: 'https://example',
    tableName: fixture.tableName,
    stageTarget: { kind: 'group', memberIds: ['DEVL', 'TEST'] },
    nonce: 'testnonce',
  });
  expect(grouped).toContain('class="stage-group active" data-group="DEVL,TEST">DEVL/TEST');
  expect(grouped).toContain('class="stage-tab member" data-stage="DEVL"');
  expect(grouped).toContain('class="stage-tab member" data-stage="TEST"');
  expect(grouped).toContain('class="stage-tab" data-stage="HUTL"');
  expect(grouped).toContain('class="stage-tab missing" data-stage="MISS"');
  expect(grouped).toContain('"kind":"group"');
  expect(grouped).toContain('"memberIds":["DEVL","TEST"]');
  expect(grouped).toContain('const gridStageId = "DEVL";');
  expect(grouped).toContain("type: 'selectGroup'");
  expect(grouped).toContain('source: \'json\', tableName, gridStageId');
  expect(grouped.indexOf('data-group="DEVL,TEST"')).toBeLessThan(
    grouped.indexOf('data-stage="DEVL"'),
  );

  const single = renderKpsEditorHtml(session, {
    cspSource: 'https://example',
    tableName: fixture.tableName,
    stageTarget: { kind: 'stage', stageId: 'DEVL' },
    nonce: 'testnonce',
  });
  expect(single).toContain('class="stage-group" data-group="DEVL,TEST">DEVL/TEST');
  expect(single).toContain('class="stage-tab active" data-stage="DEVL"');
  expect(single).not.toContain('class="stage-tab member"');
  expect(single).toContain('"kind":"stage"');
  expect(single).toContain('const gridStageId = "DEVL";');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/kpsEditor.test.ts -t "renders a stage group badge"`

Expected: FAIL because the group badge markup is absent.

- [ ] **Step 3: Render group badges**

In `src/features/kpsEditor/kpsPanelHtml.ts`, import `defaultStageTarget`, `findStageGroups`, `resolveStageTarget`, and `KpsStageTarget` from `./kpsStageGroups`.

Add this style next to `.tabs button.active`:

```css
.tabs button.member {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border-color: var(--vscode-button-background);
}
```

Extend the options argument of `renderKpsEditorHtml` with `stageTarget?: KpsStageTarget`.

After `const table = session.tables[tableName];`, replace the `stageId` / `stage` lookup with:

```ts
const requested: KpsStageTarget = options.stageTarget
  ? options.stageTarget
  : options.stageId && table.stages[options.stageId]
    ? { kind: 'stage', stageId: options.stageId }
    : defaultStageTarget(table, session.stageIds);
const target = resolveStageTarget(requested, table, session.stageIds);
const gridStageId = target.kind === 'group' ? target.memberIds[0] : target.stageId;
const stage = table.stages[gridStageId];
const groups = findStageGroups(table, session.stageIds);
```

Replace the `stageTabs` builder with:

```ts
const groupTabs = groups
  .map((group) => {
    const active =
      target.kind === 'group' &&
      group.memberIds.length === target.memberIds.length &&
      group.memberIds.every((id) => target.memberIds.includes(id))
        ? ' active'
        : '';
    return `<button class="stage-group${active}" data-group="${escapeHtml(group.memberIds.join(','))}">${escapeHtml(group.label)}</button>`;
  })
  .join('');

const stageTabs = session.stageIds
  .map((id) => {
    const st = table.stages[id];
    const active = target.kind === 'stage' && id === gridStageId ? ' active' : '';
    const member =
      target.kind === 'group' && target.memberIds.includes(id) ? ' member' : '';
    const missing = st?.status === 'missing' ? ' missing' : '';
    return `<button class="stage-tab${active}${member}${missing}" data-stage="${escapeHtml(id)}">${escapeHtml(id)}</button>`;
  })
  .join('');
```

Render `${groupTabs}${stageTabs}` inside the Stages row.

Use `gridStageId` everywhere the old local `stageId` was passed to `renderStageBody` and the Open JSON button. In the script, replace `const stageId = ...` with:

```ts
const target = ${JSON.stringify(target)};
const gridStageId = ${JSON.stringify(gridStageId)};
```

Post `target` from `setCell`, `addRow`, and `removeRow` instead of `stageId`. The Open JSON post must be exactly `vscode.postMessage({ type: 'openSource', source: 'json', tableName, gridStageId });`. Keep `createMissing` on `data-stage`.

Add a click handler:

```ts
document.querySelectorAll('.stage-group').forEach((button) => {
  button.addEventListener('click', () => {
    const memberIds = (button.getAttribute('data-group') ?? '').split(',').filter(Boolean);
    vscode.postMessage({ type: 'selectGroup', memberIds });
  });
});
```

Leave `.stage-tab` posting `{ type: 'selectStage', stageId }`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/unit/kpsEditor.test.ts -t "kps panel html"`

Expected: PASS, including the existing layout B and list-cell HTML tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/kpsEditor/kpsPanelHtml.ts test/unit/kpsEditor.test.ts
git commit -m "feat(kps-editor): show group badges beside stage badges"
```

---

### Task 5: Wire the editor service

**Files:**
- Modify: `src/features/kpsEditor/kpsEditorService.ts`

**Interfaces:**
- Consumes: `applyKpsTargetEdit`, `defaultStageTarget`, `resolveStageTarget`, `KpsStageTarget`, `setCell`, `addRow`, `removeRow`, `createMissing`, `renderKpsEditorHtml`.
- Produces: the service field `stageTarget: KpsStageTarget | undefined` replaces `selectedStageId`. Incoming edit messages carry `target: KpsStageTarget`. `selectGroup` sets a group target when that set is still a group. `selectTable` assigns `defaultStageTarget` for the newly selected table. `createMissing` assigns `{ kind: 'stage', stageId }` and does not jump to a group. A new KPS root assigns `defaultStageTarget`. The same KPS root on reload assigns `resolveStageTarget`. Remove-row confirmation reads `Remove row N from DEVL/TEST?` for a group and `Remove row N from DEVL?` for a stage. Open JSON already receives `gridStageId` from the panel.

- [ ] **Step 1: Replace the stage id field and message types**

Remove `private selectedStageId`. Add `private stageTarget: KpsStageTarget | undefined`.

Change `IncomingMessage` so `setCell`, `addRow`, and `removeRow` use `target: KpsStageTarget` instead of `stageId`. Add:

```ts
| { type: 'selectGroup'; memberIds: string[] }
```

Keep `selectStage`, `createMissing`, and `openSource` on `stageId`.

In `loadAndShow`, when `!sameKps`, after choosing `selectedTableName`:

```ts
this.stageTarget = defaultStageTarget(
  this.session.tables[this.selectedTableName],
  this.session.stageIds,
);
```

When `sameKps`, after repairing `selectedTableName`:

```ts
const table = this.session.tables[this.selectedTableName];
this.stageTarget = this.stageTarget
  ? resolveStageTarget(this.stageTarget, table, this.session.stageIds)
  : defaultStageTarget(table, this.session.stageIds);
```

Pass `stageTarget: this.stageTarget` into `renderKpsEditorHtml` and stop passing `stageId`.

- [ ] **Step 2: Handle group and stage edits**

`selectTable`:

```ts
this.selectedTableName = message.tableName;
if (this.session && this.session.tables[message.tableName]) {
  this.stageTarget = defaultStageTarget(
    this.session.tables[message.tableName],
    this.session.stageIds,
  );
}
this.render();
```

`selectStage`:

```ts
this.stageTarget = { kind: 'stage', stageId: message.stageId };
this.render();
```

`selectGroup`:

```ts
if (!this.session || !this.selectedTableName) {
  return;
}
const table = this.session.tables[this.selectedTableName];
const requested = { kind: 'group' as const, memberIds: message.memberIds };
this.stageTarget = table
  ? resolveStageTarget(requested, table, this.session.stageIds)
  : requested;
this.render();
```

For `setCell` and `addRow`, call:

```ts
const result = applyKpsTargetEdit(
  this.session,
  message.tableName,
  message.target,
  (stageId) => {
    setCell(
      this.session!,
      message.tableName,
      stageId,
      message.rowIndex,
      message.column,
      message.value,
    );
  },
);
if (result.applied) {
  this.stageTarget = result.target;
  this.render();
}
```

Use `addRow(this.session!, message.tableName, stageId)` in the add-row callback. There is no `rowIndex` on `addRow`.

`createMissing`:

```ts
createMissing(this.session, message.tableName, message.stageId);
this.stageTarget = { kind: 'stage', stageId: message.stageId };
this.render();
```

Replace `handleRemoveRow` so it takes `target: KpsStageTarget`:

```ts
private async handleRemoveRow(
  tableName: string,
  target: KpsStageTarget,
  rowIndex: number,
): Promise<void> {
  if (!this.session) {
    return;
  }
  const label =
    target.kind === 'group'
      ? this.session.stageIds.filter((id) => target.memberIds.includes(id)).join('/')
      : target.stageId;
  const confirm = await vscode.window.showWarningMessage(
    `Remove row ${rowIndex + 1} from ${label}?`,
    { modal: true },
    REMOVE_ACTION,
  );
  if (confirm !== REMOVE_ACTION) {
    return;
  }
  const result = applyKpsTargetEdit(this.session, tableName, target, (stageId) => {
    removeRow(this.session!, tableName, stageId, rowIndex);
  });
  if (result.applied) {
    this.stageTarget = result.target;
    this.render();
  }
}
```

- [ ] **Step 3: Type-check and run the suite**

Run: `npx tsc -p ./ --noEmit`

Expected: exit 0.

Run: `npm test`

Expected: PASS. The service has no VS Code harness; `applyKpsTargetEdit` and the panel HTML cover the behavior it calls. Search `src/features/kpsEditor` for `selectedStageId`; there must be no matches.

- [ ] **Step 4: Commit**

```bash
git add src/features/kpsEditor/kpsEditorService.ts
git commit -m "feat(kps-editor): edit matching stages from the group badge"
```
