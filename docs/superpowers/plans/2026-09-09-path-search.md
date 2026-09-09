# Path Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a sidebar Path Search WebviewView that catalogs YAML Service `uriprefix` listeners across every discovered project, filters them, opens the listener YAML, and offers best-effort jump to `filterCircuit`.

**Architecture:** Pure logic under `src/features/pathSearch/` (filename tokens → parse → discover → search) with a feature-owned `WebviewViewProvider` and thin VS Code service. Always scan `getProjectRegistry().projects`, never `getProjectsInScope()`. Do not extend Circuit Search.

**Tech Stack:** TypeScript, Vitest, Node `fs`/`path`, `parseMappingYaml` (`src/features/envValuesEditor/yamlMaps.ts`), `offsetToRange` (`src/features/circuitSearch/textUtils.ts`), VS Code WebviewView + Tools hub (`009`).

**Spec:** `specs/014-path-search.md`  
**Design:** `docs/superpowers/specs/2026-09-09-path-search-design.md`

## Global Constraints

- Spec-driven / TDD: failing tests before implementation; no behavior beyond `014` / design.
- Feature code under `src/features/pathSearch/`; pure logic unit-testable without the VS Code API.
- Inventory scope: **all** `getProjectRegistry().projects` — ignore sidebar project scope.
- YAML only: `Environment Configuration/Service/**/*.yaml|yml`; skip `_parent.yaml` and `solpacks.yaml`.
- Include only `type: XMLFirewall` (case-insensitive) with non-empty `fields.uriprefix`.
- Canonical path is always `fields.uriprefix`; filename tokens never override it.
- Empty/whitespace query → full catalog; search is case-insensitive substring.
- Exact empty-state copy: `Open a Policy Studio project to search paths.` / `No service paths found under Environment Configuration/Service.` / `No paths match.`
- Commands: `policyStudioTools.searchPaths` (single command that focuses the view). Tools label: `Search paths`. Navigate group, order `3`.
- View id: `policyStudio.pathSearch`. View title: `Path Search`.

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/features/pathSearch/types.ts` | `ServicePathEntry`, `PathSearchResponse`, `TextRange` |
| `src/features/pathSearch/filenameTokens.ts` | Decode Axway tokens; strip collision suffix; classify method/matcher |
| `src/features/pathSearch/parseServicePathYaml.ts` | One YAML file → entry or skip/warning |
| `src/features/pathSearch/discoverServicePaths.ts` | Walk Service trees for one or many projects |
| `src/features/pathSearch/searchPaths.ts` | Filter + sort inventory |
| `src/features/pathSearch/loadPathInventory.ts` | Discover all registry projects → inventory |
| `src/features/pathSearch/pathSearchNavigation.ts` | Open YAML at range; jump to circuit |
| `src/features/pathSearch/pathSearchViewProvider.ts` | Sidebar WebviewView |
| `src/features/pathSearch/pathSearchService.ts` | Activate, register view/command/tool, refresh on registry |
| `src/features/pathSearch/toolDescriptor.ts` | Tools hub Navigate entry |
| `test/fixtures/path-search/yaml-project/**` | Single-project Service fixtures |
| `test/fixtures/path-search/two-projects/**` | Shared-prefix ownership fixtures |
| `test/unit/pathSearch.test.ts` | Unit tests |
| `package.json` / `src/extension.ts` / `specs/009-tools-sidebar.md` / `test/unit/toolRegistrations.test.ts` | Wire-up |

---

### Task 1: Fixtures, types, filename token helpers

**Files:**
- Create: `test/fixtures/path-search/yaml-project/values.yaml`
- Create: `test/fixtures/path-search/yaml-project/Policies/_parent.yaml`
- Create: `test/fixtures/path-search/yaml-project/Environment Configuration/Service/_parent.yaml`
- Create: `test/fixtures/path-search/yaml-project/Environment Configuration/Service/solpacks.yaml`
- Create: `test/fixtures/path-search/yaml-project/Environment Configuration/Service/Name_One Interface/_parent.yaml`
- Create: `test/fixtures/path-search/yaml-project/Environment Configuration/Service/Name_One Interface/(slash),(asterisk).yaml`
- Create: `test/fixtures/path-search/yaml-project/Environment Configuration/Service/Name_One Interface/(slash)api(slash)orders,GET.yaml`
- Create: `test/fixtures/path-search/yaml-project/Environment Configuration/Service/Name_One Interface/(slash)api(slash)orders,GET 1.yaml`
- Create: `test/fixtures/path-search/two-projects/gateway-a/values.yaml`
- Create: `test/fixtures/path-search/two-projects/gateway-a/Policies/_parent.yaml`
- Create: `test/fixtures/path-search/two-projects/gateway-a/Environment Configuration/Service/A Interface/(slash)shared,(asterisk).yaml`
- Create: `test/fixtures/path-search/two-projects/gateway-b/values.yaml`
- Create: `test/fixtures/path-search/two-projects/gateway-b/Policies/_parent.yaml`
- Create: `test/fixtures/path-search/two-projects/gateway-b/Environment Configuration/Service/B Interface/(slash)shared,(asterisk).yaml`
- Create: `src/features/pathSearch/types.ts`
- Create: `src/features/pathSearch/filenameTokens.ts`
- Create: `test/unit/pathSearch.test.ts`

**Interfaces:**
- Consumes: none beyond Node string helpers
- Produces:
  - `export interface TextRange { start: { line: number; character: number }; end: { line: number; character: number } }`
  - `export interface ServicePathEntry { uriPrefix: string; projectId: string; projectDisplayName: string; interfaceName: string; httpMethod?: string; uriMatcher?: string; filterCircuit?: string; filePath: string; uriPrefixRange: TextRange; filenameStem?: string }`
  - `export interface PathSearchResponse { results: ServicePathEntry[]; warnings: string[]; projectsScanned: number }`
  - `export function decodeFilenameTokens(input: string): string`
  - `export function stripCollisionSuffix(basenameWithoutExt: string): string`
  - `export function parseFilenameKeyFields(basenameWithoutExt: string): { keys: string[]; httpMethod?: string; uriMatcher?: string }`

- [ ] **Step 1: Write fixtures**

`test/fixtures/path-search/yaml-project/values.yaml`:

```yaml
Policies: {}
```

`test/fixtures/path-search/yaml-project/Policies/_parent.yaml`:

```yaml
---
type: FilterCircuitContainer
fields:
  name: Policies
```

`Environment Configuration/Service/_parent.yaml`:

```yaml
---
type: NetService
fields:
  name: Service
```

`Environment Configuration/Service/solpacks.yaml`:

```yaml
---
type: SolutionPackLoader
fields:
  name: solpacks
```

`Environment Configuration/Service/Name_One Interface/_parent.yaml`:

```yaml
---
type: HTTP
fields:
  name: Name_One Interface
```

`Environment Configuration/Service/Name_One Interface/(slash),(asterisk).yaml`:

```yaml
---
type: XMLFirewall
fields:
  filterCircuit: /Policies/Commons/JWT/JWT verify
  uriprefix: /
children:
- type: SoftCircuitRefrence
  fields:
    circitPK: system.policy.response
    name: GLOBAL_POLICY_RSP
    priority: 4
```

`Environment Configuration/Service/Name_One Interface/(slash)api(slash)orders,GET.yaml`:

```yaml
---
type: XMLFirewall
fields:
  filterCircuit: /Policies/Orders/Create Order
  uriprefix: /api/orders
```

`Environment Configuration/Service/Name_One Interface/(slash)api(slash)orders,GET 1.yaml`:

```yaml
---
type: XMLFirewall
fields:
  filterCircuit: /Policies/Orders/Create Order Alt
  uriprefix: /api/orders
```

`two-projects/gateway-a/values.yaml` and `gateway-b/values.yaml`:

```yaml
Policies: {}
```

Each gateway `Policies/_parent.yaml` same stub as above.

`two-projects/gateway-a/.../A Interface/(slash)shared,(asterisk).yaml`:

```yaml
---
type: XMLFirewall
fields:
  filterCircuit: /Policies/A/Shared
  uriprefix: /shared
```

`two-projects/gateway-b/.../B Interface/(slash)shared,(asterisk).yaml`:

```yaml
---
type: XMLFirewall
fields:
  filterCircuit: /Policies/B/Shared
  uriprefix: /shared
```

- [ ] **Step 2: Write failing tests for filename tokens**

```ts
import { describe, expect, it } from 'vitest';
import {
  decodeFilenameTokens,
  parseFilenameKeyFields,
  stripCollisionSuffix,
} from '../../src/features/pathSearch/filenameTokens';

describe('filenameTokens', () => {
  it('decodes Axway filesystem tokens', () => {
    expect(decodeFilenameTokens('(slash)api(slash)orders')).toBe('/api/orders');
    expect(decodeFilenameTokens('(asterisk)')).toBe('*');
    expect(decodeFilenameTokens('http(colon)(slash)(slash)x')).toBe('http://x');
  });

  it('strips trailing collision suffix before key split', () => {
    expect(stripCollisionSuffix('(slash)api(slash)orders,GET 1')).toBe(
      '(slash)api(slash)orders,GET',
    );
    expect(stripCollisionSuffix('(slash),(asterisk)')).toBe('(slash),(asterisk)');
  });

  it('parses method and matcher from comma key fields', () => {
    expect(parseFilenameKeyFields('(slash),(asterisk)')).toEqual({
      keys: ['/', '*'],
      uriMatcher: '*',
    });
    expect(parseFilenameKeyFields('(slash)api(slash)orders,GET')).toEqual({
      keys: ['/api/orders', 'GET'],
      httpMethod: 'GET',
    });
    expect(parseFilenameKeyFields('(slash)api(slash)orders,GET 1')).toEqual({
      keys: ['/api/orders', 'GET'],
      httpMethod: 'GET',
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- test/unit/pathSearch.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 4: Implement types + filenameTokens**

`types.ts` — export the interfaces listed above.

`filenameTokens.ts`:

```ts
const TOKEN_MAP: Array<[RegExp, string]> = [
  [/\(slash\)/gi, '/'],
  [/\(bslash\)/gi, '\\'],
  [/\(quote\)/gi, '"'],
  [/\(colon\)/gi, ':'],
  [/\(lt\)/gi, '<'],
  [/\(gt\)/gi, '>'],
  [/\(asterisk\)/gi, '*'],
  [/\(qmark\)/gi, '?'],
  [/\(pipe\)/gi, '|'],
];

const HTTP_METHODS = new Set([
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT',
]);

export function decodeFilenameTokens(input: string): string {
  let out = input;
  for (const [pattern, replacement] of TOKEN_MAP) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function stripCollisionSuffix(basenameWithoutExt: string): string {
  return basenameWithoutExt.replace(/ (\d+)$/, '');
}

export function parseFilenameKeyFields(basenameWithoutExt: string): {
  keys: string[];
  httpMethod?: string;
  uriMatcher?: string;
} {
  const stripped = stripCollisionSuffix(basenameWithoutExt);
  const keys = stripped
    .split(',')
    .map((part) => decodeFilenameTokens(part.trim()))
    .filter(Boolean);
  let httpMethod: string | undefined;
  let uriMatcher: string | undefined;
  for (const key of keys) {
    if (key === '*') {
      uriMatcher = '*';
      continue;
    }
    const upper = key.toUpperCase();
    if (HTTP_METHODS.has(upper)) {
      httpMethod = upper;
    }
  }
  return { keys, httpMethod, uriMatcher };
}
```

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- test/unit/pathSearch.test.ts`  
Expected: PASS for `filenameTokens`

```bash
git add test/fixtures/path-search src/features/pathSearch/types.ts src/features/pathSearch/filenameTokens.ts test/unit/pathSearch.test.ts
git commit -m "$(cat <<'EOF'
test: add path-search fixtures and filename token helpers

EOF
)"
```

---

### Task 2: Parse YAML listeners and discover Service trees

**Files:**
- Create: `src/features/pathSearch/parseServicePathYaml.ts`
- Create: `src/features/pathSearch/discoverServicePaths.ts`
- Modify: `test/unit/pathSearch.test.ts`

**Interfaces:**
- Consumes: `parseMappingYaml`, `offsetToRange`, `parseFilenameKeyFields`, `PolicyStudioProject`, `ServicePathEntry`
- Produces:
  - `export function parseServicePathYaml(content: string, filePath: string, project: PolicyStudioProject, interfaceName: string): { entry?: ServicePathEntry; warning?: string; skipped?: boolean }`
  - `export function discoverServicePaths(projects: PolicyStudioProject[]): { entries: ServicePathEntry[]; warnings: string[] }`

- [ ] **Step 1: Write failing tests**

```ts
import fs from 'fs';
import path from 'path';
import { discoverServicePaths } from '../../src/features/pathSearch/discoverServicePaths';
import { parseServicePathYaml } from '../../src/features/pathSearch/parseServicePathYaml';
import type { PolicyStudioProject } from '../../src/features/projectRegistry/types';

const yamlRoot = path.join(__dirname, '..', 'fixtures', 'path-search', 'yaml-project');

function project(id: string, rootPath: string, displayName: string): PolicyStudioProject {
  return {
    id,
    rootPath,
    workspaceFolder: rootPath,
    relativePath: displayName,
    displayName,
    projectType: 'yaml',
  };
}

describe('parseServicePathYaml', () => {
  it('parses uriprefix, filterCircuit, and filename method/matcher', () => {
    const filePath = path.join(
      yamlRoot,
      'Environment Configuration',
      'Service',
      'Name_One Interface',
      '(slash),(asterisk).yaml',
    );
    const content = fs.readFileSync(filePath, 'utf8');
    const { entry, warning } = parseServicePathYaml(
      content,
      filePath,
      project('p1', yamlRoot, 'yaml-project'),
      'Name_One Interface',
    );
    expect(warning).toBeUndefined();
    expect(entry?.uriPrefix).toBe('/');
    expect(entry?.filterCircuit).toBe('/Policies/Commons/JWT/JWT verify');
    expect(entry?.uriMatcher).toBe('*');
    expect(entry?.uriPrefixRange.start.line).toBeGreaterThanOrEqual(0);
    expect(content.split(/\r?\n/)[entry!.uriPrefixRange.start.line]).toMatch(/uriprefix:/);
  });

  it('skips non-XMLFirewall scaffolding', () => {
    const filePath = path.join(yamlRoot, 'Environment Configuration', 'Service', '_parent.yaml');
    const content = fs.readFileSync(filePath, 'utf8');
    const result = parseServicePathYaml(
      content,
      filePath,
      project('p1', yamlRoot, 'yaml-project'),
      'Service',
    );
    expect(result.entry).toBeUndefined();
    expect(result.skipped).toBe(true);
  });
});

describe('discoverServicePaths', () => {
  it('finds listeners and skips _parent and solpacks', () => {
    const { entries, warnings } = discoverServicePaths([project('p1', yamlRoot, 'yaml-project')]);
    expect(warnings).toEqual([]);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.uriPrefix).sort()).toEqual(['/', '/api/orders', '/api/orders']);
    expect(entries.every((e) => e.interfaceName === 'Name_One Interface')).toBe(true);
    const methods = entries.filter((e) => e.httpMethod === 'GET');
    expect(methods).toHaveLength(2);
  });

  it('attributes the same uriPrefix to each owning project', () => {
    const two = path.join(__dirname, '..', 'fixtures', 'path-search', 'two-projects');
    const { entries } = discoverServicePaths([
      project('a', path.join(two, 'gateway-a'), 'gateway-a'),
      project('b', path.join(two, 'gateway-b'), 'gateway-b'),
    ]);
    const shared = entries.filter((e) => e.uriPrefix === '/shared');
    expect(shared).toHaveLength(2);
    expect(shared.map((e) => e.projectDisplayName).sort()).toEqual(['gateway-a', 'gateway-b']);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- test/unit/pathSearch.test.ts`

- [ ] **Step 3: Implement parse + discover**

`parseServicePathYaml.ts`:

- Empty content → `{ warning }`
- `parseMappingYaml`; on error → `{ warning }`
- Read `type` string; if not `xmlfirewall` (lower) → `{ skipped: true }`
- Read `fields.uriprefix` / `fields.filterCircuit` as strings; blank uriprefix → `{ skipped: true }`
- Find `uriprefix` with `/^\s*uriprefix:\s*.*$/m`; use `offsetToRange` for the match span
- Basename without ext → `parseFilenameKeyFields`
- Store **absolute** `filePath` on the entry for `openTextDocument`
- Set `filenameStem` to decoded stem without collision suffix for search

`discoverServicePaths.ts`:

- For each project, root = `path.join(project.rootPath, 'Environment Configuration', 'Service')`
- If missing, continue
- Recursively list `.yaml`/`.yml`; skip basenames `_parent.yaml` and `solpacks.yaml` (case-insensitive)
- `interfaceName` = `path.basename` of the file’s parent directory when parent is not the Service root; else `Service`
- Read file; call parse; collect entries/warnings

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/features/pathSearch/parseServicePathYaml.ts src/features/pathSearch/discoverServicePaths.ts test/unit/pathSearch.test.ts
git commit -m "$(cat <<'EOF'
feat: discover YAML service path listeners

EOF
)"
```

---

### Task 3: Search / inventory load

**Files:**
- Create: `src/features/pathSearch/searchPaths.ts`
- Create: `src/features/pathSearch/loadPathInventory.ts`
- Modify: `test/unit/pathSearch.test.ts`

**Interfaces:**
- Consumes: `discoverServicePaths`, `ServicePathEntry`
- Produces:
  - `export function searchPaths(entries: ServicePathEntry[], query: string): ServicePathEntry[]`
  - `export function loadPathInventory(projects: PolicyStudioProject[], query?: string): PathSearchResponse`

- [ ] **Step 1: Write failing tests**

```ts
import { loadPathInventory } from '../../src/features/pathSearch/loadPathInventory';
import { searchPaths } from '../../src/features/pathSearch/searchPaths';

describe('searchPaths', () => {
  const inventory = () => discoverServicePaths([project('p1', yamlRoot, 'yaml-project')]).entries;

  it('returns full catalog for empty query', () => {
    expect(searchPaths(inventory(), '   ')).toHaveLength(3);
  });

  it('filters by uriPrefix substring', () => {
    const hits = searchPaths(inventory(), 'api/orders');
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.uriPrefix.includes('/api/orders'))).toBe(true);
  });

  it('filters by project display name and circuit', () => {
    expect(searchPaths(inventory(), 'yaml-project').length).toBe(3);
    expect(searchPaths(inventory(), 'JWT verify')).toHaveLength(1);
    expect(searchPaths(inventory(), 'GET').length).toBeGreaterThanOrEqual(2);
  });

  it('sorts by uriPrefix then project then filePath', () => {
    const sorted = searchPaths(inventory(), '');
    const keys = sorted.map((e) => `${e.uriPrefix}|${e.projectDisplayName}|${e.filePath}`);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
  });
});

describe('loadPathInventory', () => {
  it('scans all provided projects', () => {
    const two = path.join(__dirname, '..', 'fixtures', 'path-search', 'two-projects');
    const response = loadPathInventory([
      project('a', path.join(two, 'gateway-a'), 'gateway-a'),
      project('b', path.join(two, 'gateway-b'), 'gateway-b'),
    ]);
    expect(response.projectsScanned).toBe(2);
    expect(response.results.filter((r) => r.uriPrefix === '/shared')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

`searchPaths.ts`:

```ts
import type { ServicePathEntry } from './types';

function haystacks(entry: ServicePathEntry): string[] {
  return [
    entry.uriPrefix,
    entry.projectDisplayName,
    entry.interfaceName,
    entry.httpMethod ?? '',
    entry.uriMatcher ?? '',
    entry.filterCircuit ?? '',
    entry.filenameStem ?? '',
  ];
}

export function searchPaths(entries: ServicePathEntry[], query: string): ServicePathEntry[] {
  const needle = query.trim().toLowerCase();
  const filtered = !needle
    ? [...entries]
    : entries.filter((entry) =>
        haystacks(entry).some((h) => h.toLowerCase().includes(needle)),
      );
  return filtered.sort((a, b) => {
    const byPath = a.uriPrefix.localeCompare(b.uriPrefix);
    if (byPath !== 0) return byPath;
    const byProject = a.projectDisplayName.localeCompare(b.projectDisplayName);
    if (byProject !== 0) return byProject;
    return a.filePath.localeCompare(b.filePath);
  });
}
```

`loadPathInventory.ts`:

```ts
import type { PolicyStudioProject } from '../projectRegistry/types';
import { discoverServicePaths } from './discoverServicePaths';
import { searchPaths } from './searchPaths';
import type { PathSearchResponse } from './types';

export function loadPathInventory(
  projects: PolicyStudioProject[],
  query = '',
): PathSearchResponse {
  const { entries, warnings } = discoverServicePaths(projects);
  return {
    results: searchPaths(entries, query),
    warnings,
    projectsScanned: projects.length,
  };
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/features/pathSearch/searchPaths.ts src/features/pathSearch/loadPathInventory.ts test/unit/pathSearch.test.ts
git commit -m "$(cat <<'EOF'
feat: filter and load path-search inventory

EOF
)"
```

---

### Task 4: Sidebar WebviewView, navigation, extension wiring

**Files:**
- Create: `src/features/pathSearch/toolDescriptor.ts`
- Create: `src/features/pathSearch/pathSearchNavigation.ts`
- Create: `src/features/pathSearch/pathSearchViewProvider.ts`
- Create: `src/features/pathSearch/pathSearchService.ts`
- Modify: `src/extension.ts`
- Modify: `package.json` (views + commands + commandPalette when)
- Modify: `specs/009-tools-sidebar.md` (Path Search view + Navigate tool)
- Modify: `test/unit/toolRegistrations.test.ts`
- Modify: `test/unit/pathSearch.test.ts` (tool descriptor assertions)

**Interfaces:**
- Consumes: `loadPathInventory`, `jumpToCircuit` from `circuitNavigationService`, `getSharedProjectRegistryStore`, `getSharedToolsHubService`
- Produces:
  - `PATH_SEARCH_TOOL` — Navigate, order 3, command `policyStudioTools.searchPaths`, label `Search paths`, iconId `list-filter`
  - `openServicePathEntry(entry: ServicePathEntry): Promise<void>`
  - `jumpToServicePathCircuit(entry: ServicePathEntry): Promise<void>`
  - `PathSearchViewProvider` with `focus()`, `notifyProjectsChanged()`
  - `PathSearchService.activate()`

- [ ] **Step 1: Write failing tool registration test**

```ts
import { PATH_SEARCH_TOOL } from '../../src/features/pathSearch/toolDescriptor';

describe('path search tool', () => {
  it('registers Search paths in Navigate order 3', () => {
    expect(PATH_SEARCH_TOOL.command).toBe('policyStudioTools.searchPaths');
    expect(PATH_SEARCH_TOOL.label).toBe('Search paths');
    expect(PATH_SEARCH_TOOL.group).toBe('navigate');
    expect(PATH_SEARCH_TOOL.order).toBe(3);
    expect(PATH_SEARCH_TOOL.available).toBe(true);
  });
});
```

Add `PATH_SEARCH_TOOL` to `ALL_TOOLS` in `toolRegistrations.test.ts` and assert `group === 'navigate'`.

- [ ] **Step 2: Implement toolDescriptor + navigation**

`pathSearchNavigation.ts`:

```ts
import * as vscode from 'vscode';
import { jumpToCircuit } from '../circuitNavigation/circuitNavigationService';
import type { ServicePathEntry } from './types';

export async function openServicePathEntry(entry: ServicePathEntry): Promise<void> {
  const uri = vscode.Uri.file(entry.filePath);
  const document = await vscode.workspace.openTextDocument(uri);
  const selection = new vscode.Range(
    entry.uriPrefixRange.start.line,
    entry.uriPrefixRange.start.character,
    entry.uriPrefixRange.end.line,
    entry.uriPrefixRange.end.character,
  );
  const editor = await vscode.window.showTextDocument(document, { selection });
  editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
}

export async function jumpToServicePathCircuit(entry: ServicePathEntry): Promise<void> {
  if (!entry.filterCircuit) {
    return;
  }
  await jumpToCircuit(entry.filterCircuit, { projectId: entry.projectId });
}
```

- [ ] **Step 3: Implement PathSearchViewProvider**

Mirror `src/features/toolsSidebar/circuitSearchViewProvider.ts` with these differences:

- `VIEW_TYPE = 'policyStudio.pathSearch'`
- On `ready` / query / refresh: `loadPathInventory(store.getProjectRegistry().projects, query)` — **full registry**
- Do **not** clear results on scope change; service calls `notifyProjectsChanged()` on registry updates
- Messages: `ready`, `search`, `refresh`, `openResult`, `goToCircuit`
- Row: `uriPrefix` + method/matcher; meta `project · interface`; `→ filterCircuit`; Go to circuit button
- Exact empty-state strings from Global Constraints
- Footer: `N paths · M projects` (+ warning count)
- Debounce 300 ms; empty query still loads full catalog

- [ ] **Step 4: Implement PathSearchService + package.json + extension + 009**

```ts
export class PathSearchService {
  private readonly viewProvider = new PathSearchViewProvider();

  constructor(private readonly context: vscode.ExtensionContext) {}

  activate(): void {
    getSharedToolsHubService().registerTool(PATH_SEARCH_TOOL);
    const store = getSharedProjectRegistryStore();
    this.context.subscriptions.push(
      vscode.window.registerWebviewViewProvider('policyStudio.pathSearch', this.viewProvider),
      vscode.commands.registerCommand('policyStudioTools.searchPaths', () => this.focus()),
      store.onProjectsChanged(() => this.viewProvider.notifyProjectsChanged()),
    );
  }

  private async focus(): Promise<void> {
    await vscode.commands.executeCommand('workbench.view.extension.policy-studio');
    this.viewProvider.focus();
  }
}
```

`package.json`: add view `policyStudio.pathSearch` (webview) after Circuit Search; add command `policyStudioTools.searchPaths` titled `Search Paths`; add commandPalette `when: policyStudio.projectDetected` if peers use it.

`src/extension.ts`: construct and `activate()` `PathSearchService`.

`specs/009-tools-sidebar.md`: document Path Search WebviewView; Navigate → Search paths; note all-projects inventory.

- [ ] **Step 5: Run full verification**

```bash
npm test -- test/unit/pathSearch.test.ts test/unit/toolRegistrations.test.ts
npx tsc -p ./ --noEmit
```

Expected: PASS / no type errors

- [ ] **Step 6: Commit**

```bash
git add src/features/pathSearch src/extension.ts package.json specs/009-tools-sidebar.md test/unit/pathSearch.test.ts test/unit/toolRegistrations.test.ts
git commit -m "$(cat <<'EOF'
feat: add Path Search sidebar for service URI prefixes

EOF
)"
```

---

## Spec coverage checklist

| Requirement | Task |
|-------------|------|
| Fixtures with `(slash)` / `(asterisk)` / comma / collision suffix | 1 |
| Filename token decode | 1 |
| Parse `uriprefix` + `filterCircuit` + range | 2 |
| Discover Service tree; skip scaffolding | 2 |
| Multi-project ownership | 2–3 |
| Empty query = catalog; substring filter; sort | 3 |
| Always all registry projects | 3–4 |
| Sidebar WebviewView + richer rows | 4 |
| Open YAML at uriprefix | 4 |
| Go to circuit best-effort | 4 |
| Tools hub Navigate + command | 4 |
| Update `009` | 4 |
| YAML only / no XML / no scope honor | Global + 2–4 |

## Plan self-review

- No TBD placeholders.
- Types (`ServicePathEntry`, `loadPathInventory`, `PATH_SEARCH_TOOL`) consistent across tasks.
- Circuit jump uses existing `jumpToCircuit`; start-node bugs remain out of scope per design.
