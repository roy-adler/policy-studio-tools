# KPS Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a VS Code webview that discovers sibling `KPS/<stage>/*.json` datatables and edits them with dual tabs (table + stage) over a full-width scalar grid.

**Architecture:** Pure logic under `src/features/kpsEditor/` (discover → model → mutate → write JSON) with a thin VS Code service hosting an interactive webview. Mirrors ENV editor project/scope UX; data model is JSON arrays of objects, not YAML trees.

**Tech Stack:** TypeScript, Vitest, Node `fs`/`path`, VS Code WebviewPanel + Tools hub (`009`).

**Spec:** `specs/012-kps-editor.md`  
**Design:** `docs/superpowers/specs/2026-08-11-kps-editor-design.md`

## Global Constraints

- Spec-driven / TDD: failing tests before implementation; no behavior beyond `012`.
- Feature code under `src/features/kpsEditor/`; pure logic unit-testable without VS Code API.
- Project scope via `getSharedProjectRegistryStore().getProjectsInScope()` — never assume workspace root is the project.
- Cell types: string | number | boolean | null only; nested non-scalars warned, not editable.
- Row add/remove applies to the **active stage only**.
- Create missing writes `[]`. Save writes only dirty stage files (pretty JSON, 4-space indent, no trailing newline; preserve original key order).
- Layout B: table tabs + stage tabs + full-width grid.
- No cross-stage row sync, column schema edits, nested cell editors, or live file-watch in v1.

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/features/kpsEditor/types.ts` | Domain types |
| `src/features/kpsEditor/discoverKpsStages.ts` | Sibling `KPS/`; stages + table basenames |
| `src/features/kpsEditor/listKpsRoots.ts` | Projects with editable sibling KPS |
| `src/features/kpsEditor/pickProjectRootForKpsEditor.ts` | Prefer active project root |
| `src/features/kpsEditor/resolveKpsSelection.ts` | Open / follow-project selection |
| `src/features/kpsEditor/kpsTableModel.ts` | Parse arrays; column union; session model |
| `src/features/kpsEditor/loadKpsSession.ts` | Load session from KPS root |
| `src/features/kpsEditor/kpsTableMutations.ts` | setCell, addRow, removeRow, createMissing |
| `src/features/kpsEditor/kpsTableWriter.ts` | Write dirty JSON files |
| `src/features/kpsEditor/kpsPanelHtml.ts` | Layout B webview HTML/JS |
| `src/features/kpsEditor/kpsEditorService.ts` | Command, picker, panel, message bridge |
| `src/features/kpsEditor/toolDescriptor.ts` | Tools hub registration |
| `test/fixtures/kps-editor/sample/**` | POLICY_yaml + KPS stages/tables |
| `test/unit/kpsEditor.test.ts` | Unit tests |
| `package.json` / `src/extension.ts` / `specs/009` / `test/unit/toolRegistrations.test.ts` | Wire-up |

---

### Task 1: Fixtures, types, and discovery

**Files:**
- Create: `test/fixtures/kps-editor/sample/POLICY_yaml/values.yaml`
- Create: `test/fixtures/kps-editor/sample/POLICY_yaml/Policies/.gitkeep`
- Create: `test/fixtures/kps-editor/sample/KPS/DEVL/T_CC_Sample_WebServices.json`
- Create: `test/fixtures/kps-editor/sample/KPS/TEST/T_CC_Sample_WebServices.json`
- Create: `test/fixtures/kps-editor/sample/KPS/HUTL/T_CC_Sample_WebServices.json`
- Create: `test/fixtures/kps-editor/sample/KPS/DEVL/T_CC_Sample_Routes.json` (only DEVL+TEST; HUTL missing for create-missing tests)
- Create: `test/fixtures/kps-editor/sample/KPS/TEST/T_CC_Sample_Routes.json`
- Create: `src/features/kpsEditor/types.ts`
- Create: `src/features/kpsEditor/discoverKpsStages.ts`
- Create: `test/unit/kpsEditor.test.ts`

**Interfaces:**
- Produces:
  - `resolveSiblingKpsRoot(projectRoot: string): string`
  - `discoverKpsStages(kpsRoot: string): KpsStageDiscovery`
  - `KpsStage { id: string; stageDir: string }`
  - `KpsStageDiscovery { kpsRoot: string; stages: KpsStage[]; tableNames: string[]; skippedDirs: string[] }`

- [ ] **Step 1: Create fixture JSON** (WebServices in all 3 stages with 2 rows each, env-suffixed names; Routes in DEVL+TEST only with 1 row)

- [ ] **Step 2: Write failing discovery tests**

```typescript
describe('kps discovery', () => {
  it('resolves sibling KPS next to the policy project', () => {
    expect(resolveSiblingKpsRoot(policyRoot)).toBe(kpsRoot);
  });

  it('discovers stages with json and unions table basenames', () => {
    const result = discoverKpsStages(kpsRoot);
    expect(result.stages.map((s) => s.id).sort()).toEqual(['DEVL', 'HUTL', 'TEST']);
    expect(result.tableNames.sort()).toEqual([
      'T_CC_Sample_Routes.json',
      'T_CC_Sample_WebServices.json',
    ]);
  });

  it('returns empty when KPS has no stage json', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-empty-'));
    const empty = path.join(tmp, 'KPS');
    fs.mkdirSync(empty);
    expect(discoverKpsStages(empty).stages).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test — expect FAIL** (`npm test -- test/unit/kpsEditor.test.ts`)

- [ ] **Step 4: Implement `types.ts` + `discoverKpsStages.ts`**
  - Stage = child dir with ≥1 `*.json`
  - `tableNames` = sorted unique basenames across stages
  - `skippedDirs` = child dirs with no json

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: Commit** `feat(kps-editor): discover stages and table basenames`

---

### Task 2: Model load, column union, missing/error stages

**Files:**
- Create: `src/features/kpsEditor/kpsTableModel.ts`
- Create: `src/features/kpsEditor/loadKpsSession.ts`
- Modify: `test/unit/kpsEditor.test.ts`

**Interfaces:**
- `KpsScalar = string | number | boolean | null`
- `KpsCell { editable: boolean; value: KpsScalar | undefined; nested?: unknown; warning?: string }`
- `KpsRow { cells: Record<string, KpsCell> }`
- `KpsStageTable { stageId: string; filePath: string; status: 'present' | 'missing' | 'error'; parseError?: string; rows: KpsRow[]; dirty: boolean }`
- `KpsTableModel { tableName: string; columns: string[]; stages: Record<string, KpsStageTable> }`
- `KpsSession { kpsRoot: string; stageIds: string[]; tableNames: string[]; tables: Record<string, KpsTableModel>; warnings: string[] }`
- `buildKpsSession(kpsRoot, discovery, fileContents): KpsSession` where `fileContents` maps `stageId/tableName → string | null` (null = missing)
- `loadKpsSession(kpsRoot: string): KpsSession` reads disk

**Column order:** first-seen across stages in discovery order, then rows in order.

**Nested values:** cell `editable: false` with warning; do not put nested into scalar `value`.

- [ ] **Step 1: Failing tests** — load sample session; WebServices has columns including `name`,`version`; HUTL Routes is `missing`; invalid JSON stage isolates error

- [ ] **Step 2: Implement model + loader**

- [ ] **Step 3: Tests PASS; commit** `feat(kps-editor): build table session model with column union`

---

### Task 3: Mutations and writer

**Files:**
- Create: `src/features/kpsEditor/kpsTableMutations.ts`
- Create: `src/features/kpsEditor/kpsTableWriter.ts`
- Modify: `test/unit/kpsEditor.test.ts`

**Interfaces:**
- `setCell(session, tableName, stageId, rowIndex, column, text): void` — type preserve per spec
- `addRow(session, tableName, stageId): void` — all columns `""`
- `removeRow(session, tableName, stageId, rowIndex): void`
- `createMissing(session, tableName, stageId): void` — status present, rows `[]`, dirty
- `isSessionDirty(session): boolean`
- `writeDirtyKpsTables(session): { written: string[] }` — only dirty present stages; `JSON.stringify(rowsAsObjects, null, 4)` with original key order and no trailing newline

**Row serialization:** for each column, if cell editable, include key with coerced value; skip non-editable nested keys unchanged from original storage — store `rawObjects: Record<string, unknown>[]` on stage table for round-trip of nested keys, OR rebuild from cells only for editable columns and copy unknown nested keys from a `original` map on the row.

Simpler approach for v1: each `KpsRow` keeps `extra: Record<string, unknown>` for non-editable keys; writer merges `columns → scalar values` + `extra`.

- [ ] **Step 1: Failing mutation/write tests** (edit cell, add/remove row active stage only, create missing, write-back round-trip)

- [ ] **Step 2: Implement mutations + writer**

- [ ] **Step 3: PASS; commit** `feat(kps-editor): mutate rows and write dirty JSON`

---

### Task 4: Selection helpers + tool descriptor

**Files:**
- Create: `src/features/kpsEditor/listKpsRoots.ts`
- Create: `src/features/kpsEditor/pickProjectRootForKpsEditor.ts`
- Create: `src/features/kpsEditor/resolveKpsSelection.ts`
- Create: `src/features/kpsEditor/toolDescriptor.ts`
- Modify: `test/unit/kpsEditor.test.ts`
- Modify: `test/unit/toolRegistrations.test.ts`

**Interfaces:** Mirror ENV:
- `listKpsRootsForProjects(projects): KpsRootCandidate[]`
- `pickProjectRootForKpsEditor({ activeProjectRoot, selectedProjectRoots, projectsInScope })`
- `resolveKpsOpenDecision(...)`, `resolveKpsFollowProjectDecision(...)`
- `KPS_EDITOR_TOOL` → command `policyStudioTools.openKpsEditor`, group `analyze`, order `3`

- [ ] **Step 1: Failing tests** (list roots for fixture project; tool descriptor; open decision prefers active)

- [ ] **Step 2: Implement helpers (copy ENV patterns, swap ENV→KPS)**

- [ ] **Step 3: PASS; commit** `feat(kps-editor): selection helpers and tools hub descriptor`

---

### Task 5: Webview HTML (layout B)

**Files:**
- Create: `src/features/kpsEditor/kpsPanelHtml.ts`
- Modify: `test/unit/kpsEditor.test.ts`

**Behaviour:**
- Header: title, Save, Reload, Switch KPS…, Open KPS folder…
- Table tabs; stage tabs (missing → Create missing button)
- Grid for active stage rows; inputs post `setCell` / `addRow` / `removeRow`
- Empty state when no stages
- `renderKpsEditorHtml(session, { cspSource, tableName, stageId, kpsLabel? })`

- [ ] **Step 1: Failing test** — HTML contains table name, stage ids, column headers, Add row

- [ ] **Step 2: Implement panel HTML/JS** (nonce CSP like ENV)

- [ ] **Step 3: PASS; commit** `feat(kps-editor): layout B webview HTML`

---

### Task 6: VS Code service + wire-up

**Files:**
- Create: `src/features/kpsEditor/kpsEditorService.ts`
- Modify: `src/extension.ts`
- Modify: `package.json` (command + commandPalette when)
- Modify: `specs/009-tools-sidebar.md` (document KPS tool row)
- Expand: `test/example-repo/202602/policies/NAME_ONE/KPS/` with a second table in DEVL+TEST only for manual demos

**Service:** Mirror `EnvValuesEditorService` — activate registers tool+command; open resolves KPS; panel posts messages; Save/Reload; Switch/Open folder; follow active project.

- [ ] **Step 1: Implement service**
- [ ] **Step 2: Wire extension + package.json + 009 + toolRegistrations**
- [ ] **Step 3: `npm test` + `npx tsc -p ./ --noEmit` green**
- [ ] **Step 4: Commit** `feat(kps-editor): open KPS editor command and tools hub integration`

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Sibling KPS discovery + stages/tables | 1 |
| Column union, missing/error stages | 2 |
| Edit cells, add/remove row (active stage), create missing, Save dirty | 3 |
| Multi-project picker / follow active | 4, 6 |
| Layout B webview | 5 |
| Command + Tools hub + package.json | 6 |
| Unit tests + fixtures | 1–5 |

## Self-review notes

- No placeholders; types named consistently `Kps*`.
- Writer pretty-print `null, 4` + trailing `\n` matches fixtures.
- Type preservation on `setCell` matches `012` cell-commit rules.
