# Design: Projects path tree (compact folders)

Date: 2026-09-07

## Goal

Make the Policy Studio **Projects** sidebar view easier to scan when many projects live under nested folders. Show discovered **projects** (not circuits) in a compact folder tree by default, with a toolbar toggle back to today’s flat list.

## Decisions (locked)

1. **Scope:** Group **project roots** by path. Do not show policy/circuit trees under a project.
2. **Default mode:** `tree`. Alternate mode: `list` (current flat behaviour).
3. **Compact folders:** Collapse single-child folder segments (VS Code Explorer–style), including a folder whose only child is a project leaf (leaf label becomes `parent/displayName`). Sibling folders under a shared parent (e.g. two gateways under `policies/`) do not collapse.
4. **Toggle:** Projects view title-bar button only. Persist in **workspace state** (`policyStudio.projects.viewMode`: `'tree' | 'list'`). No `settings.json` key.
5. **Multi-root:** When the registry spans more than one workspace folder, wrap each tree under a `workspaceFolder` node. Single-root workspaces omit that wrapper.
6. **Architecture:** Approach 1 — hierarchical tree model + flat list mode; extend `buildProjectsTree` / `ProjectsTreeProvider`.

## Non-goals

- Full Policy Studio policy navigator under a project (still future in `009`).
- User setting for view mode.
- Changes to project discovery, markers, or circuit indexing.
- Persisting expand/collapse state across sessions.
- Virtualized filter for >20 projects (existing future idea in `009`).

## UX

Top-level nodes (all modes):

- Scope summary → `selectProjectScope`
- Refresh projects → `refreshProjects`
- (empty / warnings as today)

Tree mode (single workspace root):

```
Active: PAYMENT_API_YAML
Refresh projects
policies/
  AUTH_GATEWAY/AUTH_GATEWAY_YAML     ← project leaf
  PAYMENT_API/PAYMENT_API_YAML
```

Tree mode (multi-root):

```
…
repo-a/
  gateway/
    …
repo-b/
  …
```

- **Project leaf:** click → `policyStudioTools.setActiveProject` (unchanged).
- **Folder / workspace folder nodes:** expand/collapse only; no scope command.
- **List mode:** flat project rows identical to current behaviour (label, type/path description, active marker).

Toolbar: `policyStudioTools.toggleProjectsViewMode` on `view/title` for `policyStudio.projects`. Icon reflects current mode via context key `policyStudio.projects.viewMode`.

## Data model

Extend `ProjectsTreeNode` kinds:

| Kind | Role |
|------|------|
| `scope` / `refresh` / `warning` / `empty` | Unchanged; always root-level |
| `workspaceFolder` | Multi-root only; children are folders/projects |
| `folder` | Compact path segment(s); collapsible |
| `project` | Leaf; `projectId` set |

Pure API:

```ts
buildProjectsTree(registry, scope, viewMode: 'tree' | 'list'): ProjectsTreeNode[]
```

For TreeView parenting, either:

- return a forest of roots and attach `children` on folder/workspace nodes, and teach the provider to use them; or
- keep a parent-id map — implementation choice, prefer `children` on nodes for unit-test clarity.

### Compact rule

Build a trie from each project’s posix `relativePath` segments (all segments including the project folder name). Then compact:

1. **Folder chains:** while a folder node has exactly one child that is also a folder and has no project leaves at that node, merge: label becomes `parent/child`, children become the child’s children.
2. **Sole project under a folder:** while a folder node has exactly one child and that child is a project leaf, replace the folder with that project leaf and set the leaf label to `folderLabel/projectDisplayName` (e.g. `AUTH_GATEWAY/AUTH_GATEWAY_YAML`). Description may still show type / active markers; avoid duplicating the full `relativePath` when it is already in the label.

Projects with `relativePath === ''` are leaves at the tree root for that workspace folder (no empty path folder); label stays `displayName`.

Example for `policies/AUTH_GATEWAY/AUTH_GATEWAY_YAML` and `policies/PAYMENT_API/PAYMENT_API_YAML`:

```
policies/
  AUTH_GATEWAY/AUTH_GATEWAY_YAML
  PAYMENT_API/PAYMENT_API_YAML
```

(`policies` has two children → not collapsed; each gateway folder has one project → collapsed into the leaf label.)

### Multi-root detection

Group projects by `workspaceFolder`. If unique workspace folder URIs/paths ≤ 1, omit `workspaceFolder` nodes. If > 1, one node per folder (label = basename of workspace folder).

## Wiring

| Piece | Change |
|-------|--------|
| `projectsTreeModel.ts` | Tree builder + compact collapse; list path preserves current output |
| `projectsTreeProvider.ts` | Hierarchical `getChildren`; collapsible state for folder/workspace |
| `toolsSidebarService` / hub | Register toggle command; read/write workspace memento; set context key |
| `package.json` | Command + `menus.view/title` entry; optional `when` on view mode for icon swap |
| `specs/009-tools-sidebar.md` | Document tree/list modes and toggle |

Default expand: workspace folder and first-level folder nodes **expanded**; deeper folders can start collapsed (implementation may expand all for small trees).

## Testing

Unit tests in `toolsSidebar.test.ts` (or adjacent):

- Compact merge of single-child chains
- Sibling folders do not collapse
- Root-level project (`relativePath === ''`)
- Multi-root wraps under workspace folder nodes; single-root does not
- List mode matches prior flat shape (scope, refresh, projects, warnings)
- Empty registry unchanged

## Acceptance criteria

- [ ] Projects view defaults to compact path tree
- [ ] Toolbar toggles list ↔ tree; choice survives window reload (workspace state)
- [ ] Multi-root shows workspace folder parents
- [ ] Project click still sets active project; folders do not
- [ ] Unit tests cover compact merge, multi-root, list parity

## Downstream

Update `009-tools-sidebar.md` Projects view section to describe tree/list modes. No change to `000` discovery semantics.