# Design: Environment Values Editor

Date: 2026-08-06

## Goal

Let Policy Studio developers edit environment-specific `values.yaml` files for all stages (DEVL, TEST, …) in one split-pane view — nested key tree on the left, per-environment values on the right — instead of opening each file separately.

## Decisions (locked)

1. **Layout:** Parent folder contains `POLICYNAME_yaml/` (Policy Studio project), sibling `ENV/`, `KPS/`, and env-switch scripts. Editor targets `ENV/` only.
2. **Stage discovery:** Auto-discover every immediate `ENV/<stage>/` that contains `values.yaml`.
3. **UI:** Webview split pane — expandable key tree left; detail pane right with one editable field per stage for the selected path.
4. **Missing vs empty:** Empty leaf values are intentional and OK. A key path missing from a stage’s file is a **warning**, with optional **Create missing**.
5. **Editing (v1):** Edit existing leaves; add key to all stages (empty initially); remove key from all stages; create missing inserts empty string in that stage. Explicit **Save** writes changed files only.
6. **ENV resolution:** Default = sibling `ENV/` of the active project’s parent folder. Optional folder picker if missing or user overrides.
7. **Approach:** Dedicated feature module + VS Code webview panel (same pattern as Policy Diff / Circuit Graph).

## Non-goals (v1)

- Certificate Store under each stage
- KPS folder or env-switch scripts
- Live file-watch sync while the panel is open (Reload button instead)
- First-class YAML lists (scalars + nested maps only)
- Diff/equality highlighting in the tree (layout C deferred)

## Architecture

Feature root: `src/features/envValuesEditor/`

| Unit | Responsibility |
|------|----------------|
| `discoverEnvStages` | Resolve `ENV/` path; list stages with `values.yaml` |
| `envValuesModel` | Parse YAML maps; merge key tree; track value / empty / missing per stage |
| `envValuesMutations` | Set value, add path, remove path, create missing; mark dirty |
| `envValuesWriter` | Serialize nested maps back to each stage’s `values.yaml` |
| `envValuesEditorService` | VS Code command, webview host, Save / Reload / picker |
| `toolDescriptor` | Register in Tools sidebar |

Depends on `projectRegistry` for active project scope (`getProjectsInScope()` / active project). Does **not** treat project-root marker `values.yaml` as env data.

### Data flow

1. Resolve `ENV` (sibling of project parent, or user-picked folder).
2. Load and parse each `ENV/<stage>/values.yaml`.
3. Build merged tree of key paths; attach per-stage cell state.
4. Webview renders tree + detail; posts edit messages to extension host.
5. On Save, write only dirty stage files; clear dirty flags.

## UI & behaviour

- **Command:** `policyStudioTools.openEnvValuesEditor` (label: Open ENV values editor).
- **Tools hub:** Register under Analyze (or Validate); available when a project is in scope or user can pick a folder.
- **Tree:** Nested maps as folders; scalar leaves as selectable keys. Paths like `B.BA.BAA`.
- **Detail:** Selected path → one field per discovered stage. Missing → warning + Create missing. Empty string allowed.
- **Add key:** Prompt for path (relative to selection or absolute); create in all stages with empty string.
- **Remove key:** Confirm; remove from all stages that have it.
- **Save / Reload:** Save writes YAML; Reload re-reads from disk (discard unsaved with confirm if dirty).

## Edge cases

- No sibling `ENV/` → offer folder picker or clear error.
- Stage dir without `values.yaml` → skip (not listed).
- Invalid YAML in one stage → error for that stage; others remain usable.
- Structural conflict (map vs scalar at same path across stages) → warning; no blind overwrite.
- Multi-project workspace → active project’s parent sibling `ENV/`.

## Testing

Fixture layout:

```
test/fixtures/env-values-editor/sample/
  POLICY_yaml/values.yaml + Policies/
  ENV/DEVL/values.yaml
  ENV/TEST/values.yaml
```

Unit tests: discovery, merge (missing vs empty), add/remove/create-missing, write-back round-trip, invalid YAML isolation.

## Acceptance

- Discovers stages under sibling `ENV/`
- Split-pane editor works as specified
- Warns on missing keys; empty values OK
- Edit / add / remove / create-missing + Save
- Optional folder picker
- Certificate Store out of scope
- Spec in `/specs` + unit tests

## Related

- Feature spec: `specs/011-env-values-editor.md`
- Tools sidebar: `specs/009-tools-sidebar.md` (register new tool)
- Project scope: `specs/000-multi-project-monorepo.md`
