# Feature: Tools Sidebar (Extension Hub UI)

## Goal

Provide a **clickable Activity Bar entry** for Policy Studio Tools so developers have one persistent place to see project status, switch scope, and launch every extension capability — without relying on the command palette or remembering command names.

This spec is the **canonical UI shell** for the extension. Feature specs `002`–`008` implement domain logic and may also expose commands; this spec defines how those capabilities surface in the sidebar and how new tools register themselves.

## User Story

As a Policy Studio developer, I want to click the Policy Studio icon in the VS Code sidebar and use a clear, organized panel to search circuits, navigate policies, validate paths, compare versions, export docs, and open traces — with my current project scope always visible — so that all tools feel like one product instead of scattered commands.

## Inputs

- VS Code Activity Bar and sidebar view APIs (`viewsContainers`, `views`, optional `WebviewView`).
- Project registry and scope from `000-multi-project-monorepo.md` (`getProjectRegistry()`, `getProjectsInScope()`, `getScope()`).
- Context keys from `000` / `001`:
  - `policyStudio.projectDetected`
  - `policyStudio.projectCount`
  - `policyStudio.multiProject`
  - `policyStudio.activeProjectId`
- Existing and planned commands (each feature spec owns the command handler; this spec owns **presentation**):

| Group | Command (planned / existing) | Source spec |
|-------|------------------------------|-------------|
| Scope | `policyStudioTools.selectProjectScope` | `000` |
| Scope | `policyStudioTools.refreshProjects` | `000` / `001` |
| Navigate | `policyStudioTools.searchCircuits` | `002` |
| Navigate | `policyStudioTools.jumpToCircuit` | `003` |
| Analyze | `policyStudioTools.showCircuitGraph` | `008` |
| Analyze | `policyStudioTools.comparePolicies` | `006` |
| Analyze | `policyStudioTools.openEnvValuesEditor` | `011` |
| Analyze | `policyStudioTools.openCacheBrowser` | `013` |
| Validate | `policyStudioTools.validatePathTemplates` | `005` |
| Export | `policyStudioTools.exportDocumentation` | `007` |
| Traces | *(open `.trc` via custom editor; sidebar lists recent traces)* | `004` |

- Workspace/user settings (proposed):
  - `policyStudio.sidebar.showOnActivate` — focus sidebar when a project is first detected (default: `false`)
  - `policyStudio.sidebar.pinSearchView` — keep search results view expanded (default: `true`)

## Outputs

### Activity Bar container

- **Container id:** `policy-studio`
- **Title:** `Policy Studio`
- **Icon:** custom SVG (gateway / circuit motif); monochrome, follows VS Code theme.
- **Visibility:** container is always present; individual views inside use `when` clauses.

### Sidebar views (v1 layout)

Three views under the container, top to bottom:

#### 1. `policyStudio.projects` — Projects (TreeView)

Shows discovery and scope at a glance. Supports two **view modes** (see `docs/superpowers/specs/2026-09-07-projects-path-tree-design.md`):

- **Tree (default):** projects nested under compact path folders derived from each project’s `relativePath` (single-child folder chains collapsed; a folder with only one project child collapses into a project leaf labeled `folder/displayName`). Multi-root workspaces wrap each tree under a workspace-folder node.
- **List:** flat project rows (original behaviour).

Toggle via Projects view title-bar command `policyStudioTools.toggleProjectsViewMode`. Mode is persisted in workspace state (`policyStudio.projects.viewMode`: `tree` | `list`), not a user setting. Context key `policyStudio.projects.viewMode` drives the toolbar icon.

| Node | Content | Action |
|------|---------|--------|
| Scope summary (root) | e.g. `Active: gateway-a`, `All projects (3)`, `Selected: 2 projects` | Click → `selectProjectScope` |
| Refresh | `$(refresh) Refresh projects` | → `refreshProjects` |
| Workspace folder (tree, multi-root only) | Workspace folder basename | Expand/collapse only |
| Folder (tree) | Compact path segment(s), e.g. `policies/AUTH_GATEWAY` | Expand/collapse only |
| Per-project (list: flat; tree: leaf) | `displayName`, type badge (`yaml` / `xml` — YAML is the primary format, XML legacy), `relativePath` | Click → set `activeProject` scope to that project |
| Warnings | Discovery warnings from registry (truncated scan, unreadable paths) | Informational |

Empty state (no projects): message *“No Policy Studio projects found”* with link to run **Refresh** and hint to check workspace folder / markers (`001`).

#### 2. `policyStudio.tools` — Tools (TreeView)

Grouped action list. Each leaf runs an existing command (no duplicated business logic).

```
Navigate
  $(search) Search circuits          → searchCircuits
  $(link)   Jump to circuit          → jumpToCircuit
Analyze
  $(type-hierarchy) Circuit graph    → showCircuitGraph
  $(diff)   Compare policies         → comparePolicies
  $(symbol-field) ENV values editor  → openEnvValuesEditor
  $(table)  KPS editor               → openKpsEditor
  $(database) Caches                 → openCacheBrowser
Validate
  $(warning) Validate path templates → validatePathTemplates
Export
  $(export) Export documentation     → exportDocumentation
Traces
  $(file)   Open trace file…         → pick `.trc` and open Trace Viewer (`004`)
```

- Items use `when: policyStudio.projectDetected` except **Refresh projects** (always available when a workspace is open).
- Items for unimplemented commands are **hidden** until the feature registers as available (see *Registration API* below), not shown disabled — avoids a cluttered preview UI.

#### 3. `policyStudio.circuitSearch` — Circuit search (WebviewView)

Embedded search UI replacing quick-pick-only flow for day-to-day use (`002`):

- Search input (auto-focus when view opens).
- Debounced search (300 ms) against `getProjectsInScope()`.
- Scrollable results list: project name (if multi), circuit, filter, preview, match kind.
- Click result → open file + reveal range (same as `002`).
- Reference hits → inline **Go to circuit** action (delegates to `003`).
- Footer summary: match count, files scanned, skipped invalid XML, duration.
- Empty query → placeholder text only; no full-project scan.

Command palette entry for `searchCircuits` remains; it focuses this view and places cursor in the search box.

### Status bar integration

Existing status bar from `001` / `000` is **retained** and stays in sync with the Projects view:

- Clicking status bar still opens scope picker.
- Sidebar Projects view and status bar both update on `onProjectsChanged` / `onScopeChanged`.

### Registration API (internal)

Implement under `src/features/toolsSidebar/`:

```ts
interface ToolsHubTool {
  id: string;
  label: string;
  iconId: string;           // ThemeIcon id
  command: string;
  group: 'navigate' | 'analyze' | 'validate' | 'export' | 'traces';
  order: number;
  /** VS Code when-clause fragment, e.g. "policyStudio.projectDetected" */
  when?: string;
  /** Set true when feature is implemented and command registered */
  available: boolean;
}

interface ToolsHubService {
  registerTool(tool: ToolsHubTool): void;
  setSearchProvider(provider: CircuitSearchViewProvider): void;
  refresh(): void;
}
```

Each feature module calls `registerTool` during activation when its command exists. The Tools tree is built from registrations — adding `006` does not require editing the hub’s core tree definition.

### VS Code context

- `policyStudio.sidebar.focused` — `true` when any Policy Studio sidebar view has focus (optional, for keybindings).

## Behaviour

### Activation

- On extension activate, register the view container and views in `package.json` `contributes`.
- Instantiate `ToolsHubService` once; wire Projects tree to `ProjectRegistryStore`.
- When `policyStudio.projectDetected` becomes `true` and `policyStudio.sidebar.showOnActivate` is `true`, run `vscode.commands.executeCommand('workbench.view.extension.policy-studio')`.

### Projects view

- Refresh tree on `onProjectsChanged`, `onScopeChanged`, view-mode toggle, and after `refreshProjects`.
- Highlight the project matching `activeProjectId` when scope mode is `activeProject`.
- When scope is `allProjects` or `selectedProjects`, show a distinct scope icon on the root node.
- Tree mode: build a path trie from `relativePath`, compact single-child folder chains, omit workspace-folder wrappers when only one workspace folder is present; projects with empty `relativePath` sit as leaves at that tree’s root.
- List mode: preserve the flat project list used before path-tree support.

### Tools view

- Render groups in fixed order: Navigate → Analyze → Validate → Export → Traces.
- Only show tools with `available: true`.
- Toolbar on the view: **Refresh projects** (same as command).

### Circuit search view

- Reuse `searchCircuits()` and circuit index from `002` — no second index.
- Cancel in-flight search when query changes (increment generation token).
- Respect `policyStudio.circuitSearch.maxResults`.
- When scope changes mid-search, clear results and show *“Scope changed — search again”*.

### Trace files (bridge to `004`)

- v1: **Open trace file…** runs file picker filtered to `*.trc`, then opens via Trace Viewer custom editor when `004` exists.
- Future: **Recent traces** children under Traces group (workspace memento, max 10).

### No project detected

- Projects view: empty state with guidance.
- Tools view: only **Refresh projects** visible.
- Circuit search view: empty state *“Open a Policy Studio project to search circuits.”*

## Edge Cases

- **Multi-root workspace:** Projects tree lists all discovered projects with `workspaceFolder` hint when the same `displayName` appears twice.
- **Large monorepo (many projects):** Projects tree collapses to scope summary + searchable project list when `projectCount > 20` (virtualized filter box at top of view). Path-tree compact folders remain available under tree mode independently of that future filter.
- **Sibling path segments:** Compact folders only merge when a folder has exactly one folder child and no project leaves at that node; siblings stay separate.
- **Feature not yet implemented:** Tool entry absent from Tools view; command palette entries for that feature also use `when` clauses defined by each spec.
- **Webview restored after reload:** Search query and results are not restored (fresh state); scope and projects restore from registry.
- **User hides sidebar views:** Standard VS Code view visibility; no forced re-show except `showOnActivate` once per session.
- **Circuit search while indexing:** Show progress indicator in webview footer; partial results optional (v1: wait for index per project batch).

## Acceptance Criteria

- [ ] Activity Bar shows a Policy Studio icon; clicking it opens the sidebar container.
- [ ] **Projects** view lists discovered projects, current scope, and discovery warnings.
- [ ] **Projects** view defaults to a compact path tree; toolbar toggles list ↔ tree and persists mode in workspace state.
- [ ] Multi-root workspaces show workspace-folder parent nodes in tree mode; single-root does not.
- [ ] Clicking a project in the tree sets scope to `activeProject` for that project; folder nodes do not change scope.
- [ ] **Tools** view lists implemented tools in groups and runs the correct command on click.
- [ ] Unimplemented tools (`003`–`008` until shipped) do not appear as dead entries.
- [ ] **Circuit search** webview provides input, debounced results, and navigation consistent with `002`.
- [ ] Command `policyStudioTools.searchCircuits` focuses the Circuit search view.
- [ ] Status bar scope display stays consistent with Projects view.
- [ ] All views respect `policyStudio.projectDetected` / scope rules from `000`.
- [ ] `registerTool` API allows a new feature to add a sidebar entry without modifying hub tree source.
- [ ] Unit tests cover tool registration ordering, projects tree model from registry fixtures, and empty states.
- [ ] Integration test (or documented manual plan): open sidebar → search circuit → result opens editor.

### Non-goals (v1)

- Full Policy Studio policy tree mirroring the desktop Policy Studio navigator (future idea in `000`).
- Settings editor embedded in the sidebar (use VS Code Settings).
- Authentication or deployment targets UI.
- Replacing every quick pick in the extension — scope picker may remain quick pick for v1.

### Test fixture requirements

- Reuse `test/fixtures/sample-policy-project`, `test/fixtures/monorepo/two-projects`, and `test/fixtures/circuit-search/minimal` for projects tree and search webview model tests.
- `test/fixtures/tools-sidebar/` — optional README describing manual VS Code verification steps only (no large fixtures).

## Downstream spec impact

When implementing or updating feature specs, align UI entry points with this hub:

| Spec | Required change |
|------|-----------------|
| `000-multi-project-monorepo` | Reference `009` as primary scope UI; status bar remains secondary shortcut. Projects tree fulfills future “sidebar Projects tree” idea. |
| `001-project-detection` | Status bar behaviour unchanged; detection state drives sidebar empty states. |
| `002-circuit-search` | Add `CircuitSearchViewProvider`; command focuses webview; quick pick flow may remain fallback. Search results UI in webview is canonical; palette command delegates to hub. |
| `003-jump-to-circuit` | Register Navigate tool; webview reference hits call `jumpToCircuit`. |
| `004-trace-viewer` | Register Traces tool + custom editor; sidebar “Open trace file…” entry. |
| `005-path-template-validator` | Register Validate tool; optional future **Problems** badge on tool node when diagnostics exist. |
| `006-policy-diff` | Register Analyze tool; diff results may open in editor area, not sidebar (launch from hub only). |
| `007-export-documentation` | Register Export tool; export options may stay quick pick / save dialog. |
| `008-visual-circuit-graph` | Register Analyze tool; graph renders in editor-area webview panel launched from hub. |
| `011-env-values-editor` | Register Analyze tool; split-pane editor renders in editor-area webview panel launched from hub. |
| `012-kps-editor` | Register Analyze tool; dual-tab datatable editor renders in editor-area webview panel launched from hub. |

### UI placement principles (for all specs)

1. **Sidebar = launch pad + lightweight persistent views** (projects, search, action list).
2. **Editor-area webviews / custom editors = heavy visualizations** (graph, trace viewer, large diff).
3. **Quick picks = multi-step configuration** (scope multi-select, compare folder pickers, export options).
4. Every feature exposes a **command**; the hub calls commands, not feature internals.
5. Every navigable result includes **project context** per `000` (`ProjectScopedLocation`).

## Implementation notes

- **Module path:** `src/features/toolsSidebar/`
- **package.json:** `viewsContainers`, `views`, `menus.view/title` toolbars.
- **Icons:** `media/policy-studio-icon.svg` (Activity Bar), use codicons for tree items.
- **Phase 1 (MVP):** container + Projects tree + Tools tree with entries for implemented commands only (`refreshProjects`, `selectProjectScope`, `searchCircuits`).
- **Phase 2:** Circuit search WebviewView; migrate `002` UI.
- **Phase 3:** Register tools as `003`–`008` ship.

## Future Ideas

- **Dashboard** section: circuit count, validation error count, last export time per project.
- **Problems** sub-view aggregating diagnostics from `005` and parse warnings from `002`.
- **Pinned circuits** favourites list per project.
- **Drag-and-drop** `.trc` onto sidebar to open trace viewer.
- **Walkthrough** (VS Code getting-started) on first `projectDetected`.
- Keybinding `Ctrl+Shift+P` alternative: `Ctrl+Shift+G P` focus Policy Studio search view.
