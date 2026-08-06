# Feature: Environment Values Editor

## Goal

Edit environment-specific configuration across all stages in one view. Policy deployments keep per-stage `values.yaml` files under a sibling `ENV/` folder (e.g. DEVL, TEST) with the same nested key structure but different values. Opening each file separately is error-prone; this feature merges them into a single editable webview.

## User Story

As a Policy Studio developer, I want to see and edit all environment `values.yaml` files together (tree of keys + per-stage values), so that I can keep stages aligned, spot missing keys, and change values without switching between files.

## Inputs

- **Project scope:** Active Policy Studio project from `getProjectsInScope()` / active project (`000-multi-project-monorepo.md`). Do not assume the workspace root is the project.
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
- **Stage files:** Every immediate child directory of `ENV/` that contains a `values.yaml`.
- **YAML shape (v1):** Nested maps with scalar leaf values (string/number/boolean/null). Lists are out of scope as first-class editable values.
- VS Code command: `policyStudioTools.openEnvValuesEditor`.
- Tools sidebar registration via `ToolsHubService.registerTool` (`009-tools-sidebar.md`).

## Outputs

- Webview panel **Environment Values Editor**:
  - **Left:** Expandable tree of nested keys from the merged key set across all stages.
  - **Right:** For the selected leaf path, one editable field per discovered stage.
  - **Warnings:** Key missing in a stage (distinct from empty value).
  - **Actions:** Save, Reload, Add key, Remove key, Create missing (per stage), optional Open ENV folder.
- On Save: write updated nested YAML only to stage files that changed.

## Behaviour

### Discovery

1. Resolve the active project root from the project registry.
2. Look for `../ENV` relative to that project root (sibling).
3. If found, list immediate subdirectories that contain `values.yaml`; each subdirectory name is the stage id (e.g. `DEVL`).
4. If not found, prompt the user to pick an `ENV` folder (or cancel with a clear message).
5. Ignore `Certificate Store` and any other content that is not a stage `values.yaml` for v1 editing.

### Model

1. Parse each stage’s `values.yaml` as a nested map.
2. Build a **merged key tree**: union of all dotted paths to scalar leaves (e.g. `B.BA.BAA`).
3. For each path × stage cell:
   - **present** with a value (including empty string / null — empty is allowed and not a warning)
   - **missing** — path does not exist in that stage’s document → **warning**
4. Intermediate map nodes appear in the tree but are not editable as values.
5. If the same path is a map in one stage and a scalar in another → **structural conflict** warning; do not allow silent overwrite of the conflicting side.

### Editor UI (split pane)

- Selecting a leaf in the tree shows per-stage fields in the detail pane.
- Missing cells show a warning affordance and **Create missing** (inserts the key with an empty string into that stage’s in-memory model).
- **Add key:** User supplies a key path (relative to current node or absolute). Key is created in **all** discovered stages (empty string initially).
- **Remove key:** Confirm, then remove the path from every stage that has it.
- Edits mark the model dirty; **Save** persists only dirty stage files, preserving nesting. Prefer stable key order when rewriting (insertion order / existing file order where practical).
- **Reload** re-reads from disk; if dirty, confirm discard.

### Integration

- Pure logic under `src/features/envValuesEditor/` (testable without VS Code API).
- Service opens/manages the webview and file I/O.
- Register tool in the Tools hub under the **Analyze** group.

## Edge Cases

- **Missing sibling ENV:** Folder picker or error; do not crash.
- **Stage folder without values.yaml:** Skip that folder (not a stage).
- **Invalid YAML in one stage:** Report error for that stage; keep other stages editable.
- **Empty ENV (no stages):** Show empty state explaining expected layout.
- **Multi-project monorepo:** Use active project only for sibling resolution.
- **User-picked ENV unrelated to project:** Allowed; discovery runs on the picked folder.
- **Concurrent external edits:** No live watch in v1; Reload picks up disk changes.
- **Large nested trees:** Tree should remain usable (expand/collapse); no hard limit required for v1 beyond reasonable fixture sizes.

## Acceptance Criteria

- [ ] Command `policyStudioTools.openEnvValuesEditor` opens the editor for the active project’s sibling `ENV/` when present.
- [ ] Stages are auto-discovered from `ENV/<stage>/values.yaml`.
- [ ] Split-pane UI: key tree left, per-stage values right for the selected path.
- [ ] Empty leaf values do not produce missing-key warnings.
- [ ] Missing keys show a warning and support Create missing.
- [ ] User can edit values, add keys, and remove keys; Save writes changed `values.yaml` files.
- [ ] Optional folder picker works when sibling `ENV/` is absent or overridden.
- [ ] Invalid YAML in one stage does not block loading other stages.
- [ ] Structural map/scalar conflicts are warned, not silently overwritten.
- [ ] Certificate Store is not edited in v1.
- [ ] Unit tests cover discovery, merge (missing vs empty), mutations, and write-back using fixtures under `test/fixtures/env-values-editor/`.
- [ ] Tool appears in the Tools sidebar and uses project scope APIs from `000`.

## Non-goals

- Editing Certificate Store contents
- Integrating KPS or environment-switch scripts
- Diff highlighting of unequal values across stages (may come later)
- Live bidirectional sync with open text editors
- YAML sequences/lists as editable first-class values

## Notes

- Design discussion: `docs/superpowers/specs/2026-08-06-env-values-editor-design.md`
- Project-root `values.yaml` remains the YAML project **marker** (`001`); it is unrelated to `ENV/*/values.yaml` content.
