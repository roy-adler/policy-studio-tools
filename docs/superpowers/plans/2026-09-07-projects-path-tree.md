# Projects Path Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact path-folder tree to the Projects sidebar (default), with a toolbar toggle back to the flat list.

**Architecture:** Pure hierarchical model in `projectsTreeModel.ts` (`children` on folder/workspace nodes); `ProjectsTreeProvider` becomes recursive; view mode stored in workspace memento and exposed via context key for the toolbar icon.

**Tech Stack:** TypeScript, VS Code TreeDataProvider, vitest

**Spec:** `docs/superpowers/specs/2026-09-07-projects-path-tree-design.md` · `specs/009-tools-sidebar.md`

## Global Constraints

- Group **projects** by path only — no circuit/policy navigator
- Default view mode: `tree`; alternate: `list`
- Persist mode in workspace state key `policyStudio.projects.viewMode` (not settings.json)
- Compact single-child folder chains; sole project under a folder → leaf label `folder/displayName`
- Multi-root: wrap under `workspaceFolder` nodes only when >1 unique `workspaceFolder`
- YAML primary / XML legacy unchanged; no discovery changes

## File map

| File | Responsibility |
|------|----------------|
| `src/features/toolsSidebar/projectsTreeModel.ts` | Tree/list builders, compact collapse |
| `src/features/toolsSidebar/projectsTreeProvider.ts` | Hierarchical TreeDataProvider + viewMode |
| `src/features/toolsSidebar/toolsSidebarService.ts` | Toggle command, memento, context key |
| `package.json` | Command + view/title menu |
| `test/unit/toolsSidebar.test.ts` | Model unit tests |

---

### Task 1: Tree model (list parity + compact tree)

**Files:**
- Modify: `src/features/toolsSidebar/projectsTreeModel.ts`
- Test: `test/unit/toolsSidebar.test.ts`

**Interfaces:**
- Produces: `export type ProjectsViewMode = 'tree' | 'list'`
- Produces: `ProjectsTreeNode` with optional `children?: ProjectsTreeNode[]` and kinds `'workspaceFolder' | 'folder'`
- Produces: `buildProjectsTree(registry, scope, viewMode?: ProjectsViewMode): ProjectsTreeNode[]` — default `'tree'`

- [ ] **Step 1: Write failing tests** for compact siblings, sole-project collapse, root project, multi-root wrap, list mode flat shape, empty state

```typescript
describe('buildProjectsTree path tree', () => {
  it('compacts sole project under a folder into leaf label folder/displayName', () => {
    const registry: ProjectRegistry = {
      projects: [
        sampleProject({
          id: 'a',
          displayName: 'AUTH_GATEWAY_YAML',
          relativePath: 'policies/AUTH_GATEWAY/AUTH_GATEWAY_YAML',
          workspaceFolder: 'file:///repo',
        }),
        sampleProject({
          id: 'b',
          displayName: 'PAYMENT_API_YAML',
          relativePath: 'policies/PAYMENT_API/PAYMENT_API_YAML',
          workspaceFolder: 'file:///repo',
        }),
      ],
      discoveredAt: new Date(),
      warnings: [],
    };
    const roots = buildProjectsTree(registry, { mode: 'allProjects' }, 'tree');
    const folders = roots.filter((n) => n.kind === 'folder');
    expect(folders).toHaveLength(1);
    expect(folders[0].label).toBe('policies');
    const leaves = folders[0].children ?? [];
    expect(leaves.map((n) => n.label).sort()).toEqual([
      'AUTH_GATEWAY/AUTH_GATEWAY_YAML',
      'PAYMENT_API/PAYMENT_API_YAML',
    ]);
    expect(leaves.every((n) => n.kind === 'project')).toBe(true);
  });

  it('does not wrap workspaceFolder when only one workspace root', () => {
    const roots = buildProjectsTree(
      {
        projects: [sampleProject({ relativePath: 'gateway', displayName: 'gateway' })],
        discoveredAt: new Date(),
        warnings: [],
      },
      { mode: 'allProjects' },
      'tree',
    );
    expect(roots.some((n) => n.kind === 'workspaceFolder')).toBe(false);
  });

  it('wraps under workspaceFolder when multiple workspace roots', () => {
    const roots = buildProjectsTree(
      {
        projects: [
          sampleProject({
            id: '1',
            workspaceFolder: 'file:///repo-a',
            relativePath: 'gw',
            displayName: 'gw',
            rootPath: '/repo-a/gw',
          }),
          sampleProject({
            id: '2',
            workspaceFolder: 'file:///repo-b',
            relativePath: 'gw',
            displayName: 'gw',
            rootPath: '/repo-b/gw',
          }),
        ],
        discoveredAt: new Date(),
        warnings: [],
      },
      { mode: 'allProjects' },
      'tree',
    );
    const ws = roots.filter((n) => n.kind === 'workspaceFolder');
    expect(ws).toHaveLength(2);
  });

  it('list mode stays flat with project kind nodes and no children', () => {
    const roots = buildProjectsTree(
      {
        projects: [
          sampleProject({
            relativePath: 'policies/AUTH_GATEWAY/AUTH_GATEWAY_YAML',
            displayName: 'AUTH_GATEWAY_YAML',
          }),
        ],
        discoveredAt: new Date(),
        warnings: [],
      },
      { mode: 'allProjects' },
      'list',
    );
    const projects = roots.filter((n) => n.kind === 'project');
    expect(projects).toHaveLength(1);
    expect(projects[0].children).toBeUndefined();
    expect(projects[0].label).toBe('AUTH_GATEWAY_YAML');
  });

  it('places root-level project as leaf without empty folder', () => {
    const roots = buildProjectsTree(
      {
        projects: [sampleProject({ relativePath: '', displayName: 'root-proj' })],
        discoveredAt: new Date(),
        warnings: [],
      },
      { mode: 'allProjects' },
      'tree',
    );
    expect(roots.some((n) => n.kind === 'project' && n.label === 'root-proj')).toBe(true);
    expect(roots.some((n) => n.kind === 'folder')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- test/unit/toolsSidebar.test.ts`

- [ ] **Step 3: Implement model**

Extend kinds; add `children?`; implement trie insert; `compactFolder` recursive; sole-project merge; group by `workspaceFolder`; list path = existing logic; tree default.

Key helpers:

```typescript
export type ProjectsViewMode = 'tree' | 'list';
export type ProjectsTreeNodeKind =
  | 'scope' | 'refresh' | 'project' | 'warning' | 'empty'
  | 'workspaceFolder' | 'folder';

export interface ProjectsTreeNode {
  id: string;
  label: string;
  description?: string;
  kind: ProjectsTreeNodeKind;
  projectId?: string;
  iconId?: string;
  tooltip?: string;
  command?: string;
  children?: ProjectsTreeNode[];
}

function basenameFromWorkspaceFolder(uriOrPath: string): string {
  const cleaned = uriOrPath.replace(/\\/g, '/').replace(/\/$/, '');
  const parts = cleaned.split('/');
  return parts[parts.length - 1] || cleaned;
}
```

Compact (after building mutable trie nodes):

1. Recurse children first
2. While one child and child.kind === `'folder'`: merge labels with `/`, adopt grandchildren
3. If one child and child.kind === `'project'`: return project with `label = `${folderLabel}/${project.displayName or project.label}``

When building project leaf initially use `displayName`; sole-project compact rewrites label.

Omit `relativePath` from description when tree leaf label already embeds path segments (keep type + active).

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/features/toolsSidebar/projectsTreeModel.ts test/unit/toolsSidebar.test.ts
git commit -m "feat(tools-sidebar): build compact projects path tree model"
```

---

### Task 2: Provider hierarchy + view mode wiring

**Files:**
- Modify: `src/features/toolsSidebar/projectsTreeProvider.ts`
- Modify: `src/features/toolsSidebar/toolsSidebarService.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `buildProjectsTree(registry, scope, viewMode)`
- Produces: `ProjectsTreeProvider.setViewMode(mode)` / `getViewMode()`; command `policyStudioTools.toggleProjectsViewMode`
- Workspace state key: `policyStudio.projects.viewMode`
- Context key: `policyStudio.projects.viewMode`

- [ ] **Step 1: Update provider**

```typescript
getChildren(element?: ProjectsTreeNode): ProjectsTreeNode[] {
  if (element) {
    return element.children ?? [];
  }
  const store = getSharedProjectRegistryStore();
  return buildProjectsTree(store.getProjectRegistry(), store.getScope(), this.viewMode);
}

getTreeItem(element: ProjectsTreeNode): vscode.TreeItem {
  const collapsible =
    element.kind === 'folder' || element.kind === 'workspaceFolder'
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None;
  // ... existing command wiring; folders have no command
}
```

Accept optional `getViewMode` / hold `viewMode` field updated by service.

- [ ] **Step 2: Register toggle in ToolsSidebarService.activate**

On activate: read memento (default `'tree'`), set context, pass mode to provider.

```typescript
const VIEW_MODE_KEY = 'policyStudio.projects.viewMode';
const VIEW_MODE_CONTEXT = 'policyStudio.projects.viewMode';

// toggle: flip tree↔list, update memento, setContext, provider.refresh()
```

- [ ] **Step 3: package.json**

Add command with icons (`list-tree` when in list mode to switch to tree; `list-flat` when in tree mode to switch to list) using two menu entries with `when`:

```json
{
  "command": "policyStudioTools.toggleProjectsViewMode",
  "title": "Toggle Projects Tree/List",
  "category": "Policy Studio",
  "icon": "$(list-tree)"
}
```

`view/title` for `view == policyStudio.projects`:

- Show `$(list-flat)` when `policyStudio.projects.viewMode == tree` (click → switch to list)
- Show `$(list-tree)` when `policyStudio.projects.viewMode != tree` (click → switch to tree)

Or single command that toggles; icon can be static `$(list-tree)` if dual-when is awkward — prefer dual menu entries with same command id and different icons via two contributed commands if needed. Simplest: one command, icon `$(list-tree)`, title "Toggle Projects View Mode".

Also add to `view/title` with `when: view == policyStudio.projects`.

- [ ] **Step 4: Compile + unit tests**

Run: `npm test -- test/unit/toolsSidebar.test.ts` and `npx tsc -p ./ --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/features/toolsSidebar/projectsTreeProvider.ts src/features/toolsSidebar/toolsSidebarService.ts package.json
git commit -m "feat(tools-sidebar): toggle Projects tree/list view in sidebar"
```

---

### Task 3: Spec acceptance polish

**Files:**
- Verify: `specs/009-tools-sidebar.md` already updated
- Manual: reload extension, confirm tree default + toggle

- [ ] **Step 1:** Confirm acceptance criteria from design doc against tests
- [ ] **Step 2:** Commit any leftover doc tweaks only if needed

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Compact path tree default | 1 |
| Sole-project leaf label | 1 |
| List mode flat | 1 |
| Multi-root workspaceFolder | 1 |
| Toolbar toggle + memento | 2 |
| Hierarchical provider | 2 |
| Unit tests | 1 |
