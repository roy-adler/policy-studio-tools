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
- **JSON shape:** Array of objects. Leaf values are scalars (string/number/boolean/null) or, for a `java.util.List` column, a flat JSON array of those scalars. Nested objects and arrays that are not a flat list on a list column are non-editable (warned).
- **Type schema:** Sibling Policy Studio project `Environment Configuration/Key Property Stores/**/*.yaml` Store Group (`type: KPSReadWriteStore`) + Type Group (`KPSType` / `KPSTypeProperty`). Match `fields.aliases` to the JSON basename without `.json`; follow `fields.type` to the Type Group file.
- VS Code command: `policyStudioTools.openKpsEditor`.
- Tools sidebar registration via `ToolsHubService.registerTool` (`009-tools-sidebar.md`).

## Outputs

- Webview panel **KPS Editor** (layout B):
  - **Table tabs:** One tab per discovered JSON basename.
  - **Stage tabs:** One tab per discovered stage for the selected table.
  - **Grid:** Columns = field names; rows = entries of the active stage; inline editable scalar cells and flat list cells.
  - **Warnings:** Stage file missing; invalid JSON; nested non-scalar fields; list element type mismatch.
  - **Actions:** Save, Reload, Add row, Remove row, Create missing (per stage), Switch KPS…, Open KPS folder…, **Open JSON**, **Open Store Group**, **Open Type Group** (current table; JSON is the active stage file).
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
6. Cells that are nested objects, or arrays on a column that is not a list, are marked non-editable with a warning. Scalar cells (including empty string / null) are editable. A `java.util.List` column whose value is a flat array of scalars is editable and holds that array. A list column whose value contains an object or nested array stays non-editable. A list column whose value is a scalar stays editable and warns that it is not a list; load and Save do not turn that scalar into an array until the user commits text that parses as a flat scalar array.
7. Rows may differ per stage. When two or more present stages contain the same rows as a multiset, they form a stage group (see Stage groups).

### Editor UI (layout B)

- Dual tabs: table basename tabs + stage tabs; full-width editable grid for the active stage.
- Switching table keeps in-session dirty state for other tables until Save or Reload of the session (or discard on Switch KPS / follow-project).
- Scalar cells: single-line text input showing the value’s string form. On cell commit:
  - If the column has a scalar Type Group type, coerce to that JSON type (`java.lang.String`/`String` → string; `Boolean`/`java.lang.Boolean` → boolean; `Integer`/`Long`/`Short`/`Byte` and `java.lang.*` of those → integer number; `Double`/`Float`/`Number` and `java.lang.Double`/`Float` → number). Other Java types that are not a list → string plus a session warning. List columns follow the list rule below and are not coerced to string.
  - Else preserve the prior JSON type when compatible: previous `number` + parseable numeric text → number; previous `boolean` + `true`/`false` → boolean; previous `null` + empty text → null; otherwise store a string (including `""`).
  - Invalid schema/previous-type input **keeps the previous cell value**, does not mark dirty, and shows a warning in the banner.
- **List cells:** A Type Group property with `fields.type` of `java.util.List` or `List` is a list column. `fields.value` is the element type, mapped with the same Java scalar rules as other columns. The input shows `JSON.stringify` of the array. On commit, the text is parsed as JSON and stored as that value with no coercion: `[3,5]` stays numbers, `["3","5"]` stays strings. A known element type that does not match (including `null`, and a non-integer in an integer list; an integer in a `Double`/`Float`/`Number` list does match) keeps the parsed array, warns on the cell, and marks the stage dirty. Invalid JSON, a non-array, or an array containing an object or nested array keeps the previous value, does not mark dirty, and shows the banner warning. Missing or unknown `fields.value` still edits as a list, warns once at schema load, and does not check elements. A new row and a missing list property default to `[]`. The array is stored on the cell, not in the preserved non-scalar bag, so Save writes a JSON array.
- **Stage groups:** For the selected table, present stages with the same row multiset form a group badge labeled with their ids in discovery order joined by `/` (example: `DEVL/TEST`). Row order and JSON key order do not matter. Duplicate rows count. List element order matters. Nested values matter. Cell warnings do not. Missing and error stages are never members. The stage bar shows every group badge first (ordered by each group's first member), then every stage badge. On open and on every table switch, the largest group is selected; a tie goes to the group whose first member appears earliest. With no group, the first present stage is selected, otherwise the first stage. Switching tables does not keep the previous selection. While a group is selected, its badge and its member badges are highlighted, and the grid shows the first member's row order. Edits in that view write that one row list to every member. A stage badge selects only that stage; a later edit that makes it differ removes it from the group, and a later edit that makes stages match creates or grows a group, without moving the current selection. If the selected group's exact member set disappears, selection falls back to the first of those members. **Create missing** leaves selection on that stage. An empty file joins a group of other empty stages on the next compute. A rejected cell edit changes no member of a group. **Open JSON** is disabled in a group view, because that view is not one file. It stays available for a single selected stage.
- **Add row:** In a single-stage view, appends a row to that stage only. In a group view, appends the same new row to every member. Columns with a schema default to `""` (string), `false` (boolean), `0` (integer/number), or `[]` (list); columns without a schema default to `""`.
- On load and Save, coerce compatible existing scalar cells to the schema type so booleans/integers are written as JSON booleans/numbers, not strings. List elements are not coerced. A loaded flat list whose elements do not match a known element type keeps the array, sets the cell warning, and adds a session warning.
- **Remove row:** In a single-stage view, removes that row from that stage only (confirm for v1). In a group view, one confirm removes that row index from the shared row list and writes the result to every member.
- **Create missing:** Creates `[]` for that stage’s file path for the selected table basename, then allows editing.
- **Open JSON / Store Group / Type Group:** Open the current table’s active-stage JSON, Store Group YAML, and Type Group YAML in the editor. If a path is unknown or the file is missing, show a warning instead of failing silently.
- Edits mark the corresponding stage file dirty; **Save** persists only dirty stage files (pretty-printed JSON with 4-space indent). Do **not** add a trailing newline or blank line after the closing `]`. Preserve each row’s original JSON key order; newly added keys (missing Type Group properties filled in on save, extra keys) are appended after existing keys.
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
- **List type mismatch:** Keep the parsed array (numbers stay numbers, strings stay strings); cell warning; stage dirty.
- **List column with nested values:** Non-editable; do not flatten or stringify them.

## Acceptance Criteria

- [ ] Command `policyStudioTools.openKpsEditor` opens the editor for a chosen sibling `KPS/` (direct open when only one; searchable picker when several).
- [ ] Toolbar can Switch KPS… (searchable) and Open KPS folder….
- [ ] Stages and table basenames are auto-discovered from `KPS/<stage>/*.json`.
- [ ] Layout B UI: table tabs + stage tabs + editable grid with shared columns.
- [ ] Missing stage files show a warning and support Create missing (`[]`).
- [ ] User can edit scalar cells, add/remove rows on the active stage; Save writes changed JSON files.
- [ ] Type Group properties define grid columns and JSON types; mismatched or missing JSON shows a warning and remains editable so it can be corrected; extra JSON keys are shown as unexpected columns. Unknown tables without a Type Group keep JSON-key union and previous-type fallback.
- [ ] Nested objects, and arrays that are not a flat list on a `java.util.List` column, are warned and not silently overwritten as scalars.
- [ ] A `java.util.List` cell edited as `[3,5]` or `["3","5"]` is saved as a JSON array of those values, not as a string. An element that does not match `fields.value` is kept and warned. Invalid list text keeps the previous value.
- [ ] Invalid JSON in one stage does not block loading other stages.
- [ ] Unit tests cover discovery, column union, mutations, and write-back using fixtures under `test/fixtures/kps-editor/`.
- [ ] Toolbar/source actions can open the current table’s JSON (active stage), Store Group YAML, and Type Group YAML.
- [ ] A table whose present stages share the same rows shows a group badge (for example `DEVL/TEST`) that edits those stages together, highlights the member badges, and still allows selecting one stage on its own. Stages that differ, and missing or invalid stages, stay individual.

## Non-goals

- Diff highlighting between stages whose rows differ
- Keeping stages linked after their rows diverge
- Add/remove columns
- Nested object editing, and editing arrays that contain objects or nested arrays
- Coercing list elements to the Type Group element type
- A per-item add/remove control for list cells
- Editing ENV or Certificate Store from this panel
- Live bidirectional sync with open text editors

## Notes

- Design discussion: `docs/superpowers/specs/2026-08-11-kps-editor-design.md`
- List columns: `docs/superpowers/specs/2026-09-22-kps-list-editor-design.md`
- Stage groups: `docs/superpowers/specs/2026-09-22-kps-stage-groups-design.md`
- Pattern reference: `specs/011-env-values-editor.md`
