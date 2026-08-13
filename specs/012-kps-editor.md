# Feature: KPS Editor

## Goal

Edit KPS datatable JSON across all stages in one view. Policy bundles keep per-stage JSON arrays under a sibling `KPS/` folder (e.g. DEVL, TEST) with the same object field names (columns) but different rows/values. Opening each file separately is error-prone; this feature presents them as a table with shared columns and per-stage tabs.

## User Story

As a Policy Studio developer, I want to see and edit all stage copies of a KPS datatable together (shared columns + per-stage rows), so that I can keep tables aligned, create missing stage files, and change values without switching between JSON files.

## Inputs

- **Project scope:** Prefer the active/selected Policy Studio project from the project registry (`000-multi-project-monorepo.md`). KPS discovery for switching uses all discovered projects so sibling KPS folders remain searchable.
- **Default KPS root:** Sibling folder named `KPS` next to the policy project directory:
  ```
  Parent/
    POLICYNAME_yaml/     ← detected Policy Studio project
    ENV/                 ← ENV values editor (separate feature)
    KPS/
      DEVL/*.json
      TEST/*.json
      …
  ```
- **Optional override:** Folder picker when sibling `KPS/` is missing or the user chooses “Open KPS folder…”.
- **Monorepo KPS switcher:** When multiple projects in scope have a sibling `KPS/`, the user picks which KPS set to edit via a searchable Quick Pick. The webview toolbar exposes **Switch KPS…** and **Open KPS folder…**.
- **Stage folders:** Every immediate child directory of `KPS/` that contains at least one `*.json`.
- **Table files:** Union of `*.json` basenames across stages. Each file is a single JSON array of objects (datatable).
- **JSON shape (v1):** Array of objects with scalar leaf values (string/number/boolean/null). Nested objects/arrays are non-editable (warned).
- **Type schema:** Sibling Policy Studio project `Environment Configuration/Key Property Stores/**/*.yaml` Store Group (`type: KPSReadWriteStore`) + Type Group (`KPSType` / `KPSTypeProperty`). Match `fields.aliases` to the JSON basename without `.json`; follow `fields.type` to the Type Group file.
- VS Code command: `policyStudioTools.openKpsEditor`.
- Tools sidebar registration via `ToolsHubService.registerTool` (`009-tools-sidebar.md`).

## Outputs

- Webview panel **KPS Editor** (layout B):
  - **Table tabs:** One tab per discovered JSON basename.
  - **Stage tabs:** One tab per discovered stage for the selected table.
  - **Grid:** Columns = field names; rows = entries of the active stage; inline editable scalar cells.
  - **Warnings:** Stage file missing; invalid JSON; nested non-scalar fields.
  - **Actions:** Save, Reload, Add row, Remove row, Create missing (per stage), Switch KPS…, Open KPS folder….
- On Save: write updated JSON only to stage files that changed.

## Behaviour

### Discovery

1. Collect Policy Studio projects. For **opening** the editor, prefer the active/selected project’s sibling `KPS/` when it exists. For **Switch KPS…**, list candidates from **all discovered projects** in the registry.
2. For each candidate project, resolve sibling `../KPS`. Keep candidates that exist and contain at least one stage with `*.json`.
3. **KPS selection on open:**
   - Prefer the sibling KPS of the **active project** (or the sole selected project) when that KPS has stages.
   - Else if exactly **1** candidate among projects in scope: open it directly.
   - Else if **2+** candidates: show a searchable Quick Pick; include a **Browse KPS folder…** item.
   - **0 candidates:** offer Browse / folder picker (or clear error if cancelled).
4. For the chosen KPS root, list immediate subdirectories that contain at least one `*.json`; each subdirectory name is the stage id.
5. Table ids = sorted union of `*.json` basenames across those stages.
6. **Switch KPS…** always shows the searchable Quick Pick (even when only one candidate exists), with dirty-discard confirm if needed, then reloads the panel. **Open KPS folder…** remains a direct folder picker.
7. **Follow active project:** While the KPS editor panel is open, changing the selected/active policy project switches the editor to that project’s sibling `KPS/` when it has stages (with dirty-discard confirm if needed). If the newly selected project has no editable KPS, keep the current session and show a short warning.

### Model

1. Parse each stage’s file for the selected table basename as a JSON array of objects.
2. **Column list (schema first):** When a Type Group is found, columns are the Type Group `KPSTypeProperty` names **in YAML order**. Extra JSON keys not in the Type Group are appended as additional columns so they can be inspected and corrected. When no Type Group exists, columns remain the ordered union of JSON keys (previous behaviour).
3. Table tabs include Store Group aliases even when no JSON file exists yet (all stages **missing**).
4. For each stage:
   - **present** — file exists and parsed; rows are the array entries
   - **missing** — basename not present in that stage → warning + **Create missing** (then the grid uses Type Group columns)
   - **error** — invalid JSON or not an array → stage error; other stages remain usable
5. Schema mismatch (still editable):
   - Type Group property missing from a JSON row → warning; cell filled with the typed default so it can be corrected
   - JSON key not in the Type Group → warning on that extra column
   - Value not coercible to the Type Group type → warning; keep the loaded value so it can be edited
6. Cells that are nested objects/arrays are marked non-editable with a warning; scalar cells (including empty string / null) are editable.
7. Row lists are **independent per stage** (different lengths and values are allowed).

### Editor UI (layout B)

- Dual tabs: table basename tabs + stage tabs; full-width editable grid for the active stage.
- Switching table keeps in-session dirty state for other tables until Save or Reload of the session (or discard on Switch KPS / follow-project).
- Scalar cells: single-line text input showing the value’s string form. On cell commit:
  - If the column has a Type Group type, coerce to that JSON type (`java.lang.String`/`String` → string; `Boolean`/`java.lang.Boolean` → boolean; `Integer`/`Long`/`Short`/`Byte` and `java.lang.*` of those → integer number; `Double`/`Float`/`Number` and `java.lang.Double`/`Float` → number). Other Java types → string plus a session warning.
  - Else preserve the prior JSON type when compatible: previous `number` + parseable numeric text → number; previous `boolean` + `true`/`false` → boolean; previous `null` + empty text → null; otherwise store a string (including `""`).
  - Invalid schema/previous-type input **keeps the previous cell value**, does not mark dirty, and shows a warning in the banner.
- **Add row:** Appends a row to the **active stage only**. Columns with a schema default to `""` (string), `false` (boolean), or `0` (integer/number); columns without a schema default to `""`.
- On load and Save, coerce compatible existing cells to the schema type so booleans/integers are written as JSON booleans/numbers, not strings.
- **Remove row:** Removes that row from the **active stage only** (confirm optional; confirm for v1).
- **Create missing:** Creates `[]` for that stage’s file path for the selected table basename, then allows editing.
- Edits mark the corresponding stage file dirty; **Save** persists only dirty stage files (pretty-printed JSON with 4-space indent, trailing newline).
- **Reload** re-reads from disk; if dirty, confirm discard.

### Integration

- Pure logic under `src/features/kpsEditor/` (testable without VS Code API).
- Service opens/manages the webview and file I/O.
- Register tool in the Tools hub under the **Analyze** group.

## Edge Cases

- **Missing sibling KPS:** Folder picker or error; do not crash.
- **Stage folder without JSON:** Skip that folder (not a stage).
- **Invalid JSON in one stage:** Report error for that stage; keep other stages editable.
- **Empty KPS (no stages):** Show empty state explaining expected layout.
- **Multi-project monorepo:** Searchable picker of all projects that have a sibling `KPS/`.
- **User-picked KPS unrelated to project:** Allowed; discovery runs on the picked folder.
- **Concurrent external edits:** No live watch in v1; Reload picks up disk changes.
- **Table missing in some stages:** Create missing available; do not hide those stage tabs.
- **No Type Group for a table:** Fall back to JSON key union and previous-JSON-type coercion; warn once if Store/Type Group YAML is missing or unreadable.
- **JSON missing or not matching Type Group:** Warn (missing file, missing properties, extra keys, type mismatch). Keep the grid editable so the user can correct and Save.
- **Invalid typed edit:** Keep previous value; banner warning; do not write a wrong JSON type.

## Acceptance Criteria

- [ ] Command `policyStudioTools.openKpsEditor` opens the editor for a chosen sibling `KPS/` (direct open when only one; searchable picker when several).
- [ ] Toolbar can Switch KPS… (searchable) and Open KPS folder….
- [ ] Stages and table basenames are auto-discovered from `KPS/<stage>/*.json`.
- [ ] Layout B UI: table tabs + stage tabs + editable grid with shared columns.
- [ ] Missing stage files show a warning and support Create missing (`[]`).
- [ ] User can edit scalar cells, add/remove rows on the active stage; Save writes changed JSON files.
- [ ] Type Group properties define grid columns and JSON types; mismatched or missing JSON shows a warning and remains editable so it can be corrected; extra JSON keys are shown as unexpected columns. Unknown tables without a Type Group keep JSON-key union and previous-type fallback.
- [ ] Nested non-scalar values are warned and not silently overwritten as scalars.
- [ ] Invalid JSON in one stage does not block loading other stages.
- [ ] Unit tests cover discovery, column union, mutations, and write-back using fixtures under `test/fixtures/kps-editor/`.
- [ ] Tool appears in the Tools sidebar and uses project scope APIs from `000`.

## Non-goals

- Cross-stage row sync or equality/diff highlighting
- Add/remove columns
- Nested object/array cell editing
- Editing ENV or Certificate Store from this panel
- Live bidirectional sync with open text editors

## Notes

- Design discussion: `docs/superpowers/specs/2026-08-11-kps-editor-design.md`
- Pattern reference: `specs/011-env-values-editor.md`
