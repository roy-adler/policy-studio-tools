# Feature: Environment Values Editor

## Goal

Edit environment-specific configuration across all stages in one view. Policy deployments keep per-stage `values.yaml` files under a sibling `ENV/` folder (e.g. DEVL, TEST) with the same nested key structure but different values. Opening each file separately is error-prone; this feature merges them into a single editable webview.

## User Story

As a Policy Studio developer, I want to see and edit all environment `values.yaml` files together (tree of keys + per-stage values), so that I can keep stages aligned, spot missing keys, and change values without switching between files.

As a Policy Studio developer, I want to see where a selected ENV key is referenced from policy files (`{{<key.path>}}`, with or without a trailing `.attributeValue` or other dotted suffix), so that I can tell whether a value is in use and jump to those places.

## Inputs

- **Project scope:** Prefer the active/selected Policy Studio project from the project registry (`000-multi-project-monorepo.md`). ENV discovery for switching uses all discovered projects so sibling ENV folders remain searchable.
- **Default ENV root:** Sibling folder named `ENV` next to the policy project directory:
  ```
  Parent/
    POLICYNAME_yaml/     ← detected Policy Studio project
    ENV/
      DEVL/values.yaml
      TEST/values.yaml
      …/Certificate Store/   ← ignored in v1
    KPS/                   ← ignored
  ```
- **Optional override:** Folder picker when sibling `ENV/` is missing or the user chooses “Open ENV folder…”.
- **Monorepo ENV switcher:** When multiple projects in scope have a sibling `ENV/`, the user picks which ENV set to edit via a searchable Quick Pick (filter by policy/project name or path). The webview toolbar exposes **Switch ENV…** (same picker) and **Open ENV folder…**.
- **Stage files:** Every immediate child directory of `ENV/` that contains a `values.yaml`.
- **YAML shape (v1):** Nested maps with scalar leaf values (string/number/boolean/null), plus **lists of scalars** (e.g. `sslTrustedCerts: [ path1, path2 ]`). Lists of maps/objects remain non-editable (warned and skipped).
- VS Code command: `policyStudioTools.openEnvValuesEditor`.
- Tools sidebar registration via `ToolsHubService.registerTool` (`009-tools-sidebar.md`).

## Outputs

- Webview panel **Environment Values Editor**:
  - **Left:** Expandable tree of nested keys from the merged key set across all stages.
  - **Right:** For the selected leaf path, one editable field per discovered stage, then policy **usages** of that key (see Policy usages).
  - **Warnings:** Key missing in a stage (distinct from empty value).
  - **Actions:** Save, Reload, Add key, Remove key, Create missing (per stage), optional Open ENV folder.
- On Save: write updated nested YAML only to stage files that changed.

## Behaviour

### Discovery

1. Collect Policy Studio projects. For **opening** the editor, prefer the active/selected project’s sibling `ENV/` when it exists (even when scope includes many projects). For **Switch ENV…**, list candidates from **all discovered projects** in the registry (not only the current single-project scope), so the picker is useful while an active project is selected.
2. For each candidate project, resolve sibling `../ENV`. Keep candidates that exist and contain at least one stage `values.yaml`.
3. **ENV selection on open:**
   - Prefer the sibling ENV of the **active project** (or the sole selected project) when that ENV has stages.
   - Else if exactly **1** candidate among projects in scope: open it directly.
   - Else if **2+** candidates: show a searchable Quick Pick (VS Code filter) listing policy/project display name, relative path, and stage ids; include a **Browse ENV folder…** item.
   - **0 candidates:** offer Browse / folder picker (or clear error if cancelled).
4. For the chosen ENV root, list immediate subdirectories that contain `values.yaml`; each subdirectory name is the stage id (e.g. `DEVL`).
5. Ignore `Certificate Store` and any other content that is not a stage `values.yaml` for v1 editing.
6. **Switch ENV…** always shows the searchable Quick Pick (even when only one candidate exists), with dirty-discard confirm if needed, then reloads the panel. **Open ENV folder…** remains a direct folder picker.
7. **Follow active project:** While the ENV editor panel is open, changing the selected/active policy project switches the editor to that project’s sibling `ENV/` when it has stages (with dirty-discard confirm if needed). If the newly selected project has no editable ENV, keep the current session and show a short warning. Changing scope to “all projects” does not force a switch.

### Model

1. Parse each stage’s `values.yaml` as a nested map.
2. Build a **merged key tree**: union of all dotted paths to scalar leaves and scalar-list leaves (e.g. `B.BA.BAA`, `Cassandra_Settings.sslTrustedCerts`).
3. For each path × stage cell:
   - **present** with a scalar value (including empty string / null — empty is allowed and not a warning)
   - **present** with a scalar list (including empty list `[]`)
   - **missing** — path does not exist in that stage’s document → **warning**
4. Intermediate map nodes appear in the tree but are not editable as values.
5. If the same path is a map in one stage and a scalar/list in another, or scalar vs list → **structural conflict** warning; do not allow silent overwrite of the conflicting side.
6. Lists whose items are not all scalars are skipped with a warning (not shown as editable leaves).

### Editor UI (split pane)

- Selecting a leaf in the tree shows per-stage fields in the detail pane **without replacing the tree document** (the tree must not jump to the top).
- Scalar leaves: single-line text input.
- Scalar-list leaves: **per-item text inputs** for each stage, with **+** (add item) and **−** (remove item) controls; order is preserved.
- Missing cells show a warning affordance and **Create missing** (inserts `""` for scalar leaves, or `[]` when any other stage has a list at that path).
- **Missing highlight:** Leaves missing in any stage are marked in **yellow** in the tree; ancestor branches that contain a missing descendant also show a yellow cue.
- **Tree persistence:** Save, Reload, and in-place re-renders keep the **selected leaf**, **expanded branch paths**, and **tree scroll position**. Expansion resets only when switching to a different ENV root. Selecting a leaf is an in-place update (selected class + detail pane), not a full-panel re-render.
- **Search/filter:** A search box above the tree filters to leaves whose **key path** (variable / segment / filename-like segment) **or** any stage **value** (scalar or list item) matches the query (case-insensitive substring). Matching leaves and their ancestors remain; clear query restores the full tree. Filtering runs in the webview (no full-panel re-render on each keystroke).
- **Smart auto-expand:** When a branch is opened (or the filtered tree leaves a single chain), keep expanding while a node has **exactly one child**, until a **leaf** or a node with **2+ children**.
- **Add key:** User supplies a key path (relative to current node or absolute). Key is created in **all** discovered stages (empty string initially).
- **Remove key:** Confirm, then remove the path from every stage that has it. Empty parent maps left behind are pruned so the written YAML does not keep `Key: {}` stubs; if a stage document becomes empty, write an empty mapping-free file (preserve a leading `---` when the original had one).
- Edits mark the model dirty; **Save** persists only dirty stage files.
- **YAML write fidelity (v1):** When rewriting a stage file, preserve:
  - leading `---` document marker when the original file had one
  - **existing mapping key order** (new keys are appended after existing keys in that map; do not sort)
  - **compact list indentation** when the original used it (`key:` then `- item` at the same indent as `key`)
  - **single-quoted** scalars when the original used `'…'` (double-quoted / plain left as such; new values may use plain or double when quoting is required)
  - no trailing blank line / extra newline after the last entry (indentation may be normalized to 2 spaces)
- **Reload** re-reads from disk; if dirty, confirm discard. Keep selection and expansion. Reload also **rescans policy usages**.

### Policy usages

Show where the selected ENV leaf is referenced in sibling Policy Studio project files.

1. **Match:** Any `{{…}}` placeholder (trim whitespace inside the braces) whose inner text is the **whole ENV key** (`{{Service.X.serviceCert}}`) or that key plus a dotted suffix (`{{Service.X.serviceCert.attributeValue}}`, or any other `.segment` after the key). Do not treat a different name as a usage (`{{id}}` is not a usage of `A.AA`). A longer sibling name is not a match (`A.AAA` is not a usage of `A.AA`).
2. **When:** Scan on editor load and Reload (not on Save; no live watch of policy files).
3. **Where:** Walk `.yaml` / `.yml` / `.xml` policy files in sibling Policy Studio project(s) next to the open `ENV/` folder (same bundle layout as discovery). Reuse the existing policy-file walk. Read file text; do not parse circuits. Unparseable documents are still scanned as text.
4. **Detail pane:** After the per-stage value fields:
   - Heading badge: `N usages` (`N` = match count). Unused → red `0 usages`.
   - Used: section **Used in** with one clickable row per match (`relativePath` + line). Click opens the file and highlights the full `{{…}}` range.
   - Unused: no rows; italic **Not used in any policy.**
5. **Tree:** No unused coloring. Missing-in-stage yellow is unchanged.
6. **Unreadable file:** Skip it; keep the editor; add a short warning.
7. **No sibling policy project** (including folder-picked ENV with none): empty usage map; unused empty state for every leaf; one session warning (banner) that no policy project was scanned.
8. **Click when the file is gone:** error toast; editor stays usable.

### Integration

- Pure logic under `src/features/envValuesEditor/` (testable without VS Code API).
- Service opens/manages the webview and file I/O.
- Register tool in the Tools hub under the **Analyze** group.

## Edge Cases

- **Missing sibling ENV:** Folder picker or error; do not crash.
- **Stage folder without values.yaml:** Skip that folder (not a stage).
- **Invalid YAML in one stage:** Report error for that stage; keep other stages editable.
- **Empty ENV (no stages):** Show empty state explaining expected layout.
- **Multi-project monorepo:** Offer a searchable picker of all in-scope projects that have a sibling `ENV/`; do not silently pick only the active project when several ENVs exist.
- **User-picked ENV unrelated to project:** Allowed; discovery runs on the picked folder.
- **Concurrent external edits:** No live watch in v1; Reload picks up disk changes.
- **Large nested trees:** Tree should remain usable (expand/collapse); no hard limit required for v1 beyond reasonable fixture sizes.
- **Several interpolations in one file:** One usage row per match.
- **Unreadable policy file during usage scan:** Skip; do not fail the ENV session.
- **No sibling Policy Studio project:** All leaves unused; session warning that nothing was scanned.
- **Unrelated placeholders** (e.g. `{{id}}` when the selected key is `A.AA`): Not a usage of that key. They only count if the inner text is that key or that key plus a dotted suffix.

## Acceptance Criteria

- [ ] Command `policyStudioTools.openEnvValuesEditor` opens the editor for a chosen sibling `ENV/` (direct open when only one; searchable picker when several).
- [ ] Toolbar can Switch ENV… (searchable) and Open ENV folder….
- [ ] Stages are auto-discovered from `ENV/<stage>/values.yaml`.
- [ ] Split-pane UI: key tree left, per-stage values right for the selected path.
- [ ] Empty leaf values do not produce missing-key warnings.
- [ ] Missing keys show a yellow tree highlight and support Create missing.
- [ ] Save/Reload keep selected key and expanded branches; search filters the tree by key or value.
- [ ] User can edit scalar values and scalar lists (e.g. `sslTrustedCerts`), add keys, and remove keys; Save writes changed `values.yaml` files.
- [ ] Optional folder picker works when sibling `ENV/` is absent or overridden.
- [ ] Invalid YAML in one stage does not block loading other stages.
- [ ] Structural map/scalar conflicts are warned, not silently overwritten.
- [ ] Certificate Store is not edited in v1.
- [ ] Unit tests cover discovery, merge (missing vs empty), mutations, and write-back using fixtures under `test/fixtures/env-values-editor/`.
- [ ] Tool appears in the Tools sidebar and uses project scope APIs from `000`.
- [ ] Selecting an ENV leaf shows a usage count badge and either a clickable “Used in” list or “Not used in any policy.”
- [ ] Usages come from `{{<key.path>}}` in sibling policy YAML/XML, including an optional dotted suffix such as `.attributeValue`; click opens the file at that range.
- [ ] Unused keys show a red `0 usages` badge. Reload rescans usages.
- [ ] Unit tests cover interpolation extraction, used vs unused lookup, skip-unreadable, and detail-pane HTML (badge, list, unused state).

## Non-goals

- Editing Certificate Store contents
- Integrating KPS or environment-switch scripts
- Diff highlighting of unequal values across stages (may come later)
- Live bidirectional sync with open text editors
- Lists of maps/objects as editable values (scalar lists are in scope)
- Unused-key highlighting in the ENV tree
- Reporting `{{…}}` interpolations that do not match any ENV key
- Live watch of policy files for usage changes (Reload rescans)

## Notes

- Design discussion: `docs/superpowers/specs/2026-08-06-env-values-editor-design.md`
- Policy usages: `docs/superpowers/specs/2026-09-10-env-key-usages-design.md`
- Project-root `values.yaml` remains the YAML project **marker** (`001`); it is unrelated to `ENV/*/values.yaml` content.
