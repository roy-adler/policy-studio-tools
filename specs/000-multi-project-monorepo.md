# Feature: Multi-Project / Monorepo Support

## Goal

Treat a VS Code workspace as potentially containing **multiple** Axway Policy Studio projects at different paths (typical monorepo layout). Provide discovery, scoping, and shared infrastructure so every Policy Studio Tools feature can operate on one project, a chosen subset, or the entire repo — without duplicating logic or producing ambiguous results.

This spec is **foundational**. Features `001`–`008` must consume the abstractions defined here rather than assuming a single project at the workspace root.

## User Story

As a developer working in a monorepo with several Policy Studio projects, I want the extension to discover all projects automatically and let me search, navigate, validate, diff, document, and graph across one or all of them, so that I can work at repo scale without opening each project in a separate window.

## Inputs

- VS Code workspace folder(s) (single- or multi-root).
- Policy Studio project markers (see `001-project-detection.md`):
  - **XML project:** `PrimaryStore.xml` at a directory root
  - **YAML project:** `values.yaml` plus `Policies/`, `APIs/`, or `META-INF/`
- Workspace/user settings (proposed keys):
  - `policyStudio.projects.scanDepth` — max directory depth below each workspace folder to search for nested projects (default: `10`; `0` = workspace roots only)
  - `policyStudio.projects.includePaths` — glob allowlist limiting scan roots (default: `["**"]`)
  - `policyStudio.projects.excludePaths` — glob denylist (default: `["**/node_modules/**", "**/.git/**", "**/out/**", "**/dist/**", "**/build/**"]`)
  - `policyStudio.projects.autoDiscover` — enable/disable background discovery (default: `true`)
- Optional manual overrides:
  - Command `policyStudioTools.selectProjectScope` — pick active scope
  - Command `policyStudioTools.refreshProjects` — force re-discovery

## Outputs

### Project registry

An in-memory **Project Registry** refreshed on workspace open, settings change, and relevant file-system events:

```ts
interface PolicyStudioProject {
  id: string;              // stable within session, e.g. hash of absolute root path
  rootPath: string;        // absolute path to project root (directory containing markers)
  workspaceFolder: string; // owning VS Code workspace folder URI/path
  relativePath: string;    // path from workspace folder to project root
  displayName: string;     // default: folder basename or relative path
  projectType: 'xml' | 'yaml';
}

interface ProjectRegistry {
  projects: PolicyStudioProject[];
  discoveredAt: Date;
  warnings: string[];     // e.g. scan truncated, permission denied paths
}
```

### Project scope

User-facing and programmatic **scope** applied by all features:

| Scope | Meaning |
|-------|---------|
| `activeProject` | The project containing the active editor file, or the user’s last explicit selection |
| `allProjects` | Every discovered project in the workspace |
| `selectedProjects` | User-picked subset (multi-select quick pick) |

- Persisted scope per workspace (workspace state or `Memento`).
- Default scope: `activeProject` when the active file belongs to a discovered project; otherwise `allProjects` if any projects exist.

### VS Code context

- `policyStudio.projectDetected` — `true` when at least one project is discovered (retain for backward compatibility).
- `policyStudio.projectCount` — number of discovered projects.
- `policyStudio.multiProject` — `true` when `projectCount > 1`.
- `policyStudio.activeProjectId` — id of the project for `activeProject` scope, when resolved.

### UI surfaces

- **Status bar:** `Policy Studio: <displayName>` when one project and `activeProject` scope; `Policy Studio: N projects` when multiple; click opens scope picker.
- **Scope picker (quick pick):** list projects + entries for “All projects” and “Choose projects…”.

### Cross-feature result envelope

Any feature returning locatable results must include **project context**:

```ts
interface ProjectScopedLocation {
  projectId: string;
  projectDisplayName: string;
  filePath: string;        // workspace-relative unless noted otherwise
  range?: Range;
}
```

## Behaviour

### Discovery

- On activation (after `001-project-detection` primitives are available):
  1. For each workspace folder, walk the directory tree within `scanDepth`, honouring include/exclude globs.
  2. A directory is a **project root** when it contains valid markers and is not nested inside another discovered project root (inner `PrimaryStore.xml` inside an already-registered project tree is part of that project, not a separate project — refine if Axway layout requires exceptions).
  3. Register each project in `ProjectRegistry`.
- Debounce file watchers; invalidate and incrementally update registry when marker files or `values.yaml` / policy trees appear, disappear, or move.
- Do not block the extension host: discovery runs asynchronously with cancellable tasks; show lightweight progress when initial scan exceeds ~1 s.

### Shared services (required integration point)

Implement under `src/features/projectRegistry/` (or equivalent):

| Service | Responsibility |
|---------|----------------|
| `discoverProjects(workspaceFolder)` | Returns `PolicyStudioProject[]` |
| `getProjectRegistry()` | Current registry snapshot |
| `getProjectForFile(fileUri)` | Resolve which project owns a file |
| `getProjectsInScope(scope)` | Resolve `PolicyStudioProject[]` for current user scope |
| `onProjectsChanged` event | Features refresh indexes/views |

All features (`002`–`008`) **must** call `getProjectsInScope()` instead of assuming `workspace.rootPath` is the Policy Studio project.

### Per-project isolation

- Build **per-project indexes** (circuits, references, path templates, etc.); merge only at query/UI time.
- Cache keys include `projectId` to avoid cross-project cache pollution.
- Parallelize per-project work where safe (search, validation scan, graph build).

### Merged presentation rules

When scope is `allProjects` or `selectedProjects`:

- **Disambiguation:** Every list row, search hit, diagnostic summary, graph node label, and diff entry shows `projectDisplayName` or `relativePath` when the same name exists in multiple projects.
- **Navigation:** Jump/open actions pass `projectId` so the correct file is opened even with duplicate relative paths across projects (rare but possible across siblings).
- **Cross-project references:** If circuit `A` in project P1 references circuit `B` and `B` exists only in project P2 within the same repo, resolution searches **current scope first**, then optionally all projects in workspace (configurable; default: current scope, with “search all projects” action on not-found).

### Monorepo-only commands (examples)

- `policyStudioTools.searchCircuits` — respects scope; optional flag `--all-projects` in API for programmatic calls.
- `policyStudioTools.showCircuitGraph` — single graph per project by default; **merged graph** mode optional with project-coloured nodes or compound clusters.
- `policyStudioTools.exportDocumentation` — one Markdown file per project by default; combined export with top-level sections per project when scope is `allProjects`.

### Configuration documentation

- Document settings in extension README; sensible defaults must keep small single-project workspaces working unchanged.

## Edge Cases

- **Workspace root is not a Policy Studio project but nested projects exist:** Extension activates; `projectCount ≥ 1`; default scope `allProjects` until user opens a file inside one project.
- **Zero projects discovered:** `policyStudio.projectDetected` false; commands hidden; optional informational message if user runs a Policy Studio command via keybinding.
- **Duplicate project folder names** (e.g. `services/api/PrimaryStore.xml` and `services/legacy/api/PrimaryStore.xml`): `displayName` uses `relativePath` for uniqueness.
- **Same circuit name in two projects:** Allowed; all UIs show project column; jump-to-circuit searches within resolved project first.
- **Very large monorepo:** Respect `excludePaths`; cap initial scan time and report `warnings`; allow increasing `scanDepth` explicitly.
- **Multi-root workspace:** Discover independently per root; `workspaceFolder` on each `PolicyStudioProject` identifies ownership.
- **Symlinks:** Follow symlinks only when VS Code workspace does (document: do not double-count symlinked project roots).
- **Partial read permissions:** Skip unreadable subtrees; add warning rather than failing entire discovery.
- **User disables `autoDiscover`:** Registry contains only workspace-root checks from `001` or manually configured paths (future: explicit project path list setting).

## Acceptance Criteria

- [ ] Nested Policy Studio projects are discovered under a monorepo workspace fixture (at least two projects at different depths).
- [ ] `ProjectRegistry` exposes stable `id`, `rootPath`, `relativePath`, and `displayName` per project.
- [ ] `getProjectForFile` returns the correct project when the active editor is inside nested project A vs B.
- [ ] Scope picker offers `activeProject`, `allProjects`, and multi-select `selectedProjects`.
- [ ] Status bar reflects single- vs multi-project workspaces.
- [ ] Context keys `policyStudio.projectCount` and `policyStudio.multiProject` update after discovery.
- [ ] `policyStudio.projects.excludePaths` prevents scanning `node_modules` in a fixture.
- [ ] A project nested inside another discovered project is not registered twice.
- [ ] Existing single-project fixture at workspace root behaves identically to pre-monorepo behaviour (no regression).
- [ ] Unit tests cover discovery, nesting, excludes, scope resolution, and `getProjectForFile`.
- [ ] Specs `002`–`008` reference this document for scope and `ProjectScopedLocation` (verified by review checklist in each spec).

### Non-goals (v1)

- Discovering projects outside the opened workspace folders.
- Git-submodule–aware project boundaries beyond normal directory scan.
- Merging two projects into one logical project for analysis.
- Remote SSH workspace–specific optimisations beyond standard VS Code file APIs.
- Per-project credentials or deployment targets.

### Test fixture requirements

- `test/fixtures/monorepo/two-projects/` — workspace root is generic repo root; `apps/gateway-a/` and `apps/gateway-b/` each contain a valid XML or YAML Policy Studio project.
- `test/fixtures/monorepo/nested-depth/` — project at `packages/team/service/policy/` (depth > 1).
- `test/fixtures/monorepo/with-node-modules/` — `node_modules` contains decoy `PrimaryStore.xml`; must be excluded.
- `test/fixtures/monorepo/multi-root/` — two workspace folders each with one project (for multi-root integration tests if harness supports).
- `test/fixtures/sample-policy-project/` — retained; single-project regression.

### Downstream spec impact (summary)

| Spec | Required change when implementing |
|------|-----------------------------------|
| `001-project-detection` | Split marker check (primitive) from workspace-wide / nested discovery (registry) |
| `002-circuit-search` | Search `getProjectsInScope()`; results include `projectDisplayName` |
| `003-jump-to-circuit` | Resolve within project; optional cross-project search |
| `004-trace-viewer` | Associate trace with nearest project for status bar only (traces are not “in” a project) |
| `005-path-template-validator` | Validate all policy files in scope; diagnostics tagged with project |
| `006-policy-diff` | Compare snapshots per project or two roots that may differ in path |
| `007-export-documentation` | Per-project or combined export sections |
| `008-visual-circuit-graph` | Per-project graph default; optional merged view with project grouping |

## Future Ideas

- Workspace setting `policyStudio.projects.extraPaths` for explicit project roots that lack standard markers.
- Sidebar **Projects** tree listing discovered projects and quick actions.
- Per-project enable/disable toggles for expensive indexing.
- Import project boundaries from `CODEOWNERS` or repo metadata.
- Cross-project impact analysis (“which projects reference this shared circuit name”).
- Remote caching of indexes for CI-sized monorepos.
