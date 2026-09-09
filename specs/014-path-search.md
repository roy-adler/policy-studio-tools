# Feature: Path Search

## Goal

Enable developers to browse and search HTTP URI prefixes configured on Policy Studio Service listeners (YAML `XMLFirewall` entities under `Environment Configuration/Service/`) across **every** discovered project in the workspace, see which project owns each path, open the listener definition, and jump to the bound circuit when present.

## User Story

As a Policy Studio developer working in a monorepo, I want a sidebar catalog of every service URI prefix with project ownership and a filter box, so that I can answer “which project exposes `/api/…`?” without opening each gateway’s Service tree by hand.

## Inputs

- **All discovered projects** from `getProjectRegistry().projects` (`000-multi-project-monorepo.md`). This feature does **not** use `getProjectsInScope()`; sidebar project scope must not shrink the inventory.
- **YAML Service listeners (primary / only format in v1):**
  - Files under `Environment Configuration/Service/**` with extensions `.yaml` / `.yml`
  - Skip `_parent.yaml` and `solpacks.yaml`
  - Include entities with type `XMLFirewall` (compare type case-insensitively) that define a non-empty `fields.uriprefix`
- Optional filename key fields (Axway encoding) for display/search of URI matcher and HTTP method — see design doc.
- VS Code command: `policyStudioTools.searchPaths` (focuses the Path Search sidebar view).
- Tools sidebar registration via `ToolsHubService.registerTool` (`009-tools-sidebar.md`), Navigate group.

## Outputs

### Sidebar view `policyStudio.pathSearch` (WebviewView)

- Search input (auto-focus when the view is focused via command).
- Debounced filter (300 ms). Empty or whitespace query → full catalog.
- Result rows, each with:
  - **URI prefix** — canonical value from `fields.uriprefix`
  - **Project** — `projectDisplayName` (always shown; required for multi-project ownership)
  - **Interface** — parent folder name under `Service/`
  - **HTTP method** and/or **URI matcher** when decoded from the filename key fields
  - **Bound circuit** — `fields.filterCircuit` when present
- Click row → open the service YAML file and reveal the `uriprefix` range.
- Secondary action **Go to circuit** when `filterCircuit` is set → existing circuit jump (`003` / shared navigation helpers). Best-effort; do not block Path Search if circuit start detection is broken.
- Footer summary: path count, projects scanned, skipped/unreadable warning count.
- Empty states:
  - No Policy Studio projects → open-a-project guidance
  - Projects but no listeners → “No service paths found under Environment Configuration/Service.”
  - Query with no hits → “No paths match.”

### Domain result item

Each inventory entry includes at least: `uriPrefix`, `projectId`, `projectDisplayName`, `interfaceName`, optional `httpMethod` / `uriMatcher` / `filterCircuit`, `filePath`, and a range covering `uriprefix` for navigation.

## Behaviour

- Activate when the extension activates; view visibility may use `policyStudio.projectDetected` consistent with Circuit Search.
- On view open, registry change, or explicit webview refresh: rebuild inventory by scanning all registry projects.
- Case-insensitive substring search over: `uriPrefix`, project display name, interface name, http method, uri matcher, filterCircuit, and optionally decoded filename stem.
- Rank or order results deterministically: e.g. by `uriPrefix` ascending, then `projectDisplayName`, then `filePath`.
- Invalid / unreadable YAML: skip file, record warning, continue.
- Non-`XMLFirewall` files under Service: skip silently (scaffolding).
- Missing or blank `uriprefix`: skip; may record a warning.
- Duplicate prefixes across projects: one row per file; project name disambiguates.
- Selecting **Go to circuit** must not replace the primary open-YAML behaviour of a normal click.

## Edge Cases

- **XML-only projects:** Contribute zero path rows in v1 (no error).
- **Filename without method/matcher keys:** Still show `uriprefix` + project + interface; omit method/matcher chips.
- **Collision suffix** (`… 1.yaml`): Strip before parsing key fields; does not appear in method/matcher.
- **Special characters in filenames:** Decode Axway tokens `(slash)`, `(asterisk)`, etc., for key-field interpretation only; never override `fields.uriprefix`.
- **Circuit jump fails:** Surface the existing navigation error; inventory and YAML open remain usable.
- **Multi-root / duplicate display names:** Prefer existing project identity (`projectId`); show `relativePath` in the row description when two projects share `displayName` (same approach as other multi-project UIs if already established; otherwise displayName is enough for v1 fixtures).
- **Very large monorepos:** Scan incrementally per project if needed; keep UI responsive (mirror Circuit Search progress patterns lightly — footer “Scanning…” is enough for v1).

## Acceptance Criteria

- [ ] Command `policyStudioTools.searchPaths` focuses the Path Search sidebar view.
- [ ] Tools → Navigate includes **Search paths** when the feature is available.
- [ ] Inventory includes all YAML `XMLFirewall` listeners with `uriprefix` from **every** discovered project, even when scope is a single active project.
- [ ] Empty query shows the full catalog; filtering narrows by substring.
- [ ] Each result shows path, project, interface, method/matcher when known, and filterCircuit when present.
- [ ] Clicking a result opens the correct YAML file at the `uriprefix` location.
- [ ] **Go to circuit** is offered when `filterCircuit` is present and invokes shared circuit navigation.
- [ ] `_parent.yaml` and `solpacks.yaml` are not listed as paths.
- [ ] Unit tests cover token decode, discovery skips, parse, search, and multi-project ownership using dedicated fixtures.
- [ ] Fixtures include `(slash),(asterisk)`, path+method comma keys, and a numeric collision suffix filename.

### Non-goals (v1)

- XML entity-store listener discovery
- Editing or validating path templates (see `005-path-template-validator.md` for template rules elsewhere)
- Fixing circuit graph / start-node detection
- Regex or request-matching simulation
- Live file watchers (rebuild on open / refresh / registry change)

### Test fixture requirements

- `test/fixtures/path-search/yaml-project/` — minimal YAML project with `values.yaml`, Service tree scaffolding, at least three listeners: catch-all `(slash),(asterisk).yaml`, a concrete path+method file, and a collision-suffix file.
- `test/fixtures/path-search/two-projects/` — two sibling YAML projects each exposing the same `uriprefix` under different interface folders so search results show distinct project ownership.

## Downstream spec impact

| Spec | Change |
|------|--------|
| `009-tools-sidebar.md` | Add Path Search WebviewView; Navigate tool; note all-projects inventory exception |
| `000-multi-project-monorepo.md` | Optional note that Path Search intentionally uses the full registry |
| `003-jump-to-circuit.md` | No behaviour change; Path Search consumes jump API |

## Implementation notes

- **Module path:** `src/features/pathSearch/`
- **Design detail:** `docs/superpowers/specs/2026-09-09-path-search-design.md`
- Mirror Circuit Search webview wiring patterns (`circuitSearchViewProvider`) for focus, debounce, and message protocol.
- Register the view in `package.json` `contributes.views` under `policy-studio`.
