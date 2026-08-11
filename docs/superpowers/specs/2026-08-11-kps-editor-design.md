# Design: KPS Editor

Date: 2026-08-11

## Goal

Let Policy Studio developers view and edit KPS datatable JSON files across stages (DEVL, TEST, HUTL, …) in one webview — shared column schema, per-stage row data — instead of opening each `KPS/<stage>/*.json` file separately.

## Decisions (locked)

1. **Approach:** Dedicated feature module `src/features/kpsEditor/` (same pattern as ENV values editor; do not generalize ENV into a shared shell in v1).
2. **Layout (UI B):** Dual tabs over a full-width editable table — table basename tabs + stage tabs; columns shared; active stage’s rows shown in the grid.
3. **KPS root:** Sibling folder `KPS/` next to the Policy Studio project (same parent as `ENV/`). Optional folder picker; **Switch KPS…** / **Open KPS folder…**; follow active project like ENV.
4. **Stage discovery:** Immediate child directories of `KPS/` that contain at least one `*.json`.
5. **Table discovery:** Union of `*.json` basenames across stages. Selecting a table loads that basename per stage.
6. **Missing stage file:** Show the stage tab with a warning and **Create missing** (writes `[]`).
7. **Editing (v1):** Edit scalar cells; add/remove rows on the **active stage only**. No add/remove columns in v1.
8. **Cell types:** string / number / boolean / null only. Nested objects/arrays → warning, not editable.
9. **Save:** Explicit Save writes only dirty stage files (pretty-printed JSON, 4-space indent). Reload re-reads from disk (confirm if dirty). No live file-watch in v1.

## Non-goals (v1)

- Cross-stage row sync, matching, or diff highlighting
- Add/remove columns (schema redesign)
- Nested JSON cell editing
- Certificate Store or ENV content
- Live bidirectional sync with open text editors

## On-disk layout

```
Parent/
  POLICY_yaml/          ← Policy Studio project
  ENV/                  ← existing ENV values editor
  KPS/
    DEVL/T_CC_….json    ← JSON array of objects (datatable)
    TEST/T_CC_….json
    HUTL/T_CC_….json
```

Each file is a single JSON array. Objects in the list share the same field names (datatable). Stages may differ in row count and cell values.

## Architecture

Feature root: `src/features/kpsEditor/`

| Unit | Responsibility |
|------|----------------|
| `discoverKpsStages` | Resolve sibling `KPS/`; list stages with `*.json` |
| `listKpsRoots` | Projects whose sibling KPS has at least one stage |
| `kpsTableModel` | Parse arrays; merge column union; per-stage rows; missing vs present |
| `kpsTableMutations` | Set cell, add/remove row, create missing; mark dirty |
| `kpsTableWriter` | Serialize arrays back to JSON files |
| `kpsEditorService` | VS Code command, webview host, Save / Reload / picker |
| `kpsPanelHtml` | Layout B webview HTML/JS |
| `toolDescriptor` | Register in Tools sidebar (Analyze) |

Depends on `projectRegistry` for active/in-scope projects (`getProjectsInScope()`).

### Data flow

1. Resolve `KPS` (sibling of project parent, or user-picked folder).
2. Discover stages and table basenames.
3. Load selected table’s JSON per stage; build column union; attach per-stage row lists.
4. Webview renders table tabs + stage tabs + grid; posts edit messages to the extension host.
5. On Save, write only dirty stage files; clear dirty flags.

### Column / cell rules

- Columns = ordered union of object keys across all rows in all stages for the selected table (stable order: first-seen across stages in discovery order, then rows).
- Missing key on a row → empty editable cell; saving a typed value writes that key on the object.
- Empty string is a valid scalar value and is written as `""`.
- Structural issues (file not an array, non-object items, nested non-scalars) produce warnings; keep other stages/tables usable.

## UI & behaviour

- **Command:** `policyStudioTools.openKpsEditor` (label: Open KPS editor).
- **Tools hub:** Register under Analyze; available when a project is detected (or user can pick a folder).
- **Toolbar:** Save, Reload, Switch KPS…, Open KPS folder….
- **Table tabs:** One tab per discovered basename; switch reloads the grid for that table (dirty-discard confirm if needed when leaving a dirty table — or keep dirty state in memory across table switches within the session; prefer keep-in-memory until Save/Reload of the session).
- **Stage tabs:** One per discovered stage; missing file → Create missing.
- **Grid:** Header = column names; rows = active stage entries; inline inputs for scalars; − remove row; + Add row (new row: all columns `""`).
- **Cell commit typing:** Preserve prior JSON type when compatible (`number` / `boolean` / `null`); otherwise store a string.
- **Follow active project:** While the panel is open, changing the selected policy project switches to that project’s sibling `KPS/` when it has stages (dirty-discard confirm if needed).

## Edge cases

- No sibling `KPS/` → offer folder picker or clear error.
- Stage dir with no JSON → not a stage.
- Invalid JSON in one stage → error for that stage; others remain usable.
- Table present in some stages only → Create missing for the others.
- Multi-project monorepo → searchable Quick Pick of KPS roots (mirror ENV).
- Concurrent external edits → no live watch; Reload picks up disk changes.

## Testing

Fixture layout:

```
test/fixtures/kps-editor/sample/
  POLICY_yaml/values.yaml + Policies/
  KPS/DEVL/T_CC_Sample_WebServices.json
  KPS/TEST/T_CC_Sample_WebServices.json
  KPS/HUTL/T_CC_Sample_WebServices.json
  (+ a second table basename in some stages for multi-table / missing-file cases)
```

Also expand `test/example-repo/.../NAME_ONE/KPS/` with an extra table if useful for manual demos.

Unit tests: discovery, column union, missing file / create missing, add/remove row (active stage only), cell edit, write-back round-trip, invalid JSON isolation.

## Acceptance

- Discovers stages and tables under sibling `KPS/`
- Layout B webview works as specified
- Edit cells; add/remove rows on active stage; Create missing; Save dirty files
- Optional folder picker / Switch KPS…
- Nested non-scalars warned, not silently corrupted
- Spec in `/specs` + unit tests + Tools hub registration

## Related

- Feature spec: `specs/012-kps-editor.md`
- ENV editor (pattern reference): `specs/011-env-values-editor.md`
- Tools sidebar: `specs/009-tools-sidebar.md`
- Project scope: `specs/000-multi-project-monorepo.md`
