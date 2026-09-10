# ENV Key Usages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the ENV values editor, show where the selected key is referenced as `{{<env.path>.attributeValue}}` in sibling policy files, with a count badge (red when unused) and click-to-jump.

**Architecture:** Pure scan under `src/features/envValuesEditor/` (regex extract → walk sibling Policy Studio projects → key → usages map). Keep usages off `EnvValuesModel` so mutations that `rebuildModel` do not drop them. The editor service loads the scan on open/Reload, passes it into the detail pane, and opens the file at the match range.

**Tech Stack:** TypeScript, Vitest, Node `fs`/`path`, existing `discoverPolicyFiles` + `offsetToRange`, VS Code `WebviewPanel` already used by the ENV editor.

**Spec:** `specs/011-env-values-editor.md` (Policy usages)  
**Design:** `docs/superpowers/specs/2026-09-10-env-key-usages-design.md`

## Global Constraints

- Spec-driven / TDD: failing tests before implementation; no behavior beyond `011` Policy usages.
- Feature code lives under `src/features/envValuesEditor/`; extract + scan must be unit-testable without the VS Code API.
- Match only `{{<dotted.path>.attributeValue}}` (trim whitespace inside braces). Exact ENV key. Ignore other `{{…}}` placeholders.
- Scan sibling Policy Studio project(s) next to the open `ENV/` on load and Reload only (not Save; no live watch).
- YAML and XML policy files; text scan, not circuit parse.
- Unused: red `0 usages` badge + “Not used in any policy.” No unused coloring in the tree.
- Do not report interpolations that have no ENV key.
- Do not put `usages` on `EnvValuesModel` (mutations rebuild the model from documents and would drop it).

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/features/envValuesEditor/types.ts` | Add `EnvAttributeUsage`, `EnvUsageScan` |
| `src/features/envValuesEditor/findEnvAttributeUsages.ts` | Extract placeholders from text; list sibling projects; scan files |
| `src/features/envValuesEditor/envValuesPanelHtml.ts` | Badge + “Used in” list / unused empty state; styles; click handler |
| `src/features/envValuesEditor/envValuesEditorService.ts` | Load scan with session; `openUsage`; pass usages into detail HTML |
| `test/fixtures/env-values-editor/usages/**` | Bundle with ENV keys + YAML/XML interpolations |
| `test/unit/findEnvAttributeUsages.test.ts` | Extract + scan tests |
| `test/unit/envValuesEditor.test.ts` | Detail-pane HTML assertions |

---

### Task 1: Extract `{{…attributeValue}}` from text

**Files:**
- Modify: `src/features/envValuesEditor/types.ts`
- Create: `src/features/envValuesEditor/findEnvAttributeUsages.ts`
- Create: `test/unit/findEnvAttributeUsages.test.ts`

**Interfaces:**
- Consumes: `offsetToRange` from `src/features/circuitSearch/textUtils.ts`
- Produces:
  - `export interface EnvTextRange { start: { line: number; character: number }; end: { line: number; character: number } }`
  - `export interface EnvAttributePlaceholder { envKey: string; startOffset: number; endOffset: number }`
  - `export interface EnvAttributeUsage { envKey: string; absolutePath: string; relativePath: string; line: number; range: EnvTextRange }`
  - `export interface EnvUsageScan { byKey: Record<string, EnvAttributeUsage[]>; warnings: string[]; projectCount: number }`
  - `export function extractEnvAttributePlaceholders(content: string): EnvAttributePlaceholder[]`
  - `export const NO_SIBLING_POLICY_PROJECT_WARNING = 'No Policy Studio project found next to this ENV folder; policy usages were not scanned.'`

`line` on `EnvAttributeUsage` is **1-based** (display). `range` is **0-based** (VS Code).

- [ ] **Step 1: Write the failing tests**

Create `test/unit/findEnvAttributeUsages.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { extractEnvAttributePlaceholders } from '../../src/features/envValuesEditor/findEnvAttributeUsages';

describe('extractEnvAttributePlaceholders', () => {
  it('maps {{path.attributeValue}} to the ENV key and full-match offsets', () => {
    const content = 'cert: "{{Service.Health.serviceCert.attributeValue}}"';
    const found = extractEnvAttributePlaceholders(content);
    expect(found).toHaveLength(1);
    expect(found[0].envKey).toBe('Service.Health.serviceCert');
    expect(content.slice(found[0].startOffset, found[0].endOffset)).toBe(
      '{{Service.Health.serviceCert.attributeValue}}',
    );
  });

  it('trims whitespace inside the braces', () => {
    const content = '{{  A.AA.attributeValue  }}';
    const found = extractEnvAttributePlaceholders(content);
    expect(found).toHaveLength(1);
    expect(found[0].envKey).toBe('A.AA');
    expect(content.slice(found[0].startOffset, found[0].endOffset)).toBe(content);
  });

  it('keeps every match in the same string', () => {
    const content =
      '{{A.AA.attributeValue}} then {{B.BB.attributeValue}} and {{A.AA.attributeValue}}';
    const keys = extractEnvAttributePlaceholders(content).map((item) => item.envKey);
    expect(keys).toEqual(['A.AA', 'B.BB', 'A.AA']);
  });

  it('ignores placeholders that are not .attributeValue', () => {
    const content = 'path: "{{id}}" selector: "{{request.headers.host}}"';
    expect(extractEnvAttributePlaceholders(content)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/findEnvAttributeUsages.test.ts`

Expected: FAIL — cannot find module `findEnvAttributeUsages` (or `extractEnvAttributePlaceholders` is not exported).

- [ ] **Step 3: Write minimal implementation**

Add to `src/features/envValuesEditor/types.ts` (after the existing exports):

```ts
export interface EnvTextRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface EnvAttributePlaceholder {
  envKey: string;
  startOffset: number;
  endOffset: number;
}

export interface EnvAttributeUsage {
  envKey: string;
  absolutePath: string;
  relativePath: string;
  /** 1-based line for display */
  line: number;
  range: EnvTextRange;
}

export interface EnvUsageScan {
  byKey: Record<string, EnvAttributeUsage[]>;
  warnings: string[];
  projectCount: number;
}
```

Create `src/features/envValuesEditor/findEnvAttributeUsages.ts`:

```ts
import type { EnvAttributePlaceholder } from './types';

export const NO_SIBLING_POLICY_PROJECT_WARNING =
  'No Policy Studio project found next to this ENV folder; policy usages were not scanned.';

const ATTRIBUTE_VALUE_PLACEHOLDER = /\{\{\s*([^{}]*?)\.attributeValue\s*\}\}/g;

export function extractEnvAttributePlaceholders(content: string): EnvAttributePlaceholder[] {
  const found: EnvAttributePlaceholder[] = [];
  const pattern = new RegExp(ATTRIBUTE_VALUE_PLACEHOLDER.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const envKey = match[1].trim();
    if (!envKey) {
      continue;
    }
    found.push({
      envKey,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    });
  }
  return found;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/findEnvAttributeUsages.test.ts`

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/envValuesEditor/types.ts src/features/envValuesEditor/findEnvAttributeUsages.ts test/unit/findEnvAttributeUsages.test.ts
git commit -m "feat: extract ENV {{path.attributeValue}} placeholders from policy text"
```

---

### Task 2: Scan sibling policy projects into a usage map

**Files:**
- Create: `test/fixtures/env-values-editor/usages/POLICY_yaml/values.yaml`
- Create: `test/fixtures/env-values-editor/usages/POLICY_yaml/Policies/Used Circuit.yaml`
- Create: `test/fixtures/env-values-editor/usages/POLICY_yaml/Policies/legacy.xml`
- Create: `test/fixtures/env-values-editor/usages/ENV/DEVL/values.yaml`
- Create: `test/fixtures/env-values-editor/usages/ENV/TEST/values.yaml`
- Modify: `src/features/envValuesEditor/findEnvAttributeUsages.ts`
- Modify: `test/unit/findEnvAttributeUsages.test.ts`

**Interfaces:**
- Consumes: `extractEnvAttributePlaceholders`, `isPolicyStudioProject`, `discoverPolicyFiles`, `offsetToRange`, `createProjectId`
- Produces:
  - `export function listSiblingPolicyProjects(envRoot: string): PolicyStudioProject[]`
  - `export async function scanEnvAttributeUsages(envRoot: string): Promise<EnvUsageScan>`

- [ ] **Step 1: Create fixtures**

`test/fixtures/env-values-editor/usages/POLICY_yaml/values.yaml`:

```yaml
---
name: usages-fixture
```

`test/fixtures/env-values-editor/usages/POLICY_yaml/Policies/Used Circuit.yaml`:

```yaml
---
type: FilterCircuit
fields:
  name: Used Circuit
  cert: "{{A.AA.attributeValue}}"
  path: "{{id}}"
  spaced: "{{  A.AA.attributeValue  }}"
```

`test/fixtures/env-values-editor/usages/POLICY_yaml/Policies/legacy.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<entity type="FilterCircuit">
  <fval name="cert">{{A.AA.attributeValue}}</fval>
</entity>
```

`test/fixtures/env-values-editor/usages/ENV/DEVL/values.yaml` and `ENV/TEST/values.yaml` (same content):

```yaml
---
A:
  AA: /Environment/Development/serviceCert.pem
B:
  BB: unused-value
```

- [ ] **Step 2: Write the failing tests**

Append to `test/unit/findEnvAttributeUsages.test.ts`:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  extractEnvAttributePlaceholders,
  listSiblingPolicyProjects,
  NO_SIBLING_POLICY_PROJECT_WARNING,
  scanEnvAttributeUsages,
} from '../../src/features/envValuesEditor/findEnvAttributeUsages';

const usagesEnvRoot = path.join(
  __dirname,
  '..',
  'fixtures',
  'env-values-editor',
  'usages',
  'ENV',
);

describe('listSiblingPolicyProjects', () => {
  it('finds the sibling YAML project next to ENV', () => {
    const projects = listSiblingPolicyProjects(usagesEnvRoot);
    expect(projects).toHaveLength(1);
    expect(projects[0].projectType).toBe('yaml');
    expect(path.basename(projects[0].rootPath)).toBe('POLICY_yaml');
  });

  it('returns none when the parent has no policy project', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-no-policy-'));
    const envRoot = path.join(tmp, 'ENV');
    fs.mkdirSync(envRoot);
    expect(listSiblingPolicyProjects(envRoot)).toEqual([]);
  });
});

describe('scanEnvAttributeUsages', () => {
  it('indexes YAML and XML interpolations by ENV key and ignores other placeholders', async () => {
    const scan = await scanEnvAttributeUsages(usagesEnvRoot);
    expect(scan.projectCount).toBe(1);
    expect(scan.warnings).toEqual([]);
    expect(scan.byKey['A.AA']).toHaveLength(3);
    expect(scan.byKey['B.BB']).toBeUndefined();
    const relatives = scan.byKey['A.AA'].map((usage) => usage.relativePath).sort();
    expect(relatives).toEqual([
      'Policies/Used Circuit.yaml',
      'Policies/Used Circuit.yaml',
      'Policies/legacy.xml',
    ]);
    expect(scan.byKey['A.AA'][0].line).toBeGreaterThan(0);
    expect(scan.byKey['A.AA'][0].range.start.line).toBe(scan.byKey['A.AA'][0].line - 1);
  });

  it('warns when no sibling policy project exists', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-scan-none-'));
    const envRoot = path.join(tmp, 'ENV');
    fs.mkdirSync(envRoot);
    const scan = await scanEnvAttributeUsages(envRoot);
    expect(scan.projectCount).toBe(0);
    expect(scan.byKey).toEqual({});
    expect(scan.warnings).toEqual([NO_SIBLING_POLICY_PROJECT_WARNING]);
  });

  it('skips unreadable files and keeps other matches', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-scan-unread-'));
    const policy = path.join(tmp, 'POLICY_yaml');
    const envRoot = path.join(tmp, 'ENV');
    fs.mkdirSync(path.join(policy, 'Policies'), { recursive: true });
    fs.writeFileSync(path.join(policy, 'values.yaml'), 'name: tmp\n');
    const good = path.join(policy, 'Policies', 'good.yaml');
    const bad = path.join(policy, 'Policies', 'bad.yaml');
    fs.writeFileSync(good, 'x: "{{A.AA.attributeValue}}"\n');
    fs.writeFileSync(bad, 'y: "{{A.AA.attributeValue}}"\n');
    fs.chmodSync(bad, 0);
    fs.mkdirSync(envRoot);

    try {
      const scan = await scanEnvAttributeUsages(envRoot);
      expect(scan.byKey['A.AA']?.length).toBeGreaterThanOrEqual(1);
      expect(scan.warnings.some((warning) => warning.includes('bad.yaml'))).toBe(true);
    } finally {
      fs.chmodSync(bad, 0o644);
    }
  });
});
```

Keep the existing `extractEnvAttributePlaceholders` import (merge with the new import list; do not duplicate). On Windows, `chmodSync(bad, 0)` may still allow reads — if that test cannot make the file unreadable, skip it with `it.skipIf(process.platform === 'win32')` **only for the unreadable-file case**, and instead unit-test the skip by extracting a small internal helper `usageFromPolicyFile` is **not** required: implement skip via `readFile` catch and, on Windows, assert the catch path with a **missing file** by calling a testable wrapper.

Prefer this portable skip test instead of chmod (replace the chmod test):

```ts
  it('records a warning and continues when a policy file cannot be read', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-scan-missing-'));
    const policy = path.join(tmp, 'POLICY_yaml');
    const envRoot = path.join(tmp, 'ENV');
    fs.mkdirSync(path.join(policy, 'Policies'), { recursive: true });
    fs.writeFileSync(path.join(policy, 'values.yaml'), 'name: tmp\n');
    const gone = path.join(policy, 'Policies', 'gone.yaml');
    fs.writeFileSync(gone, 'x: "{{A.AA.attributeValue}}"\n');
    fs.mkdirSync(envRoot);

    const { scanPolicyFileForUsages } = await import(
      '../../src/features/envValuesEditor/findEnvAttributeUsages'
    );
    const result = await scanPolicyFileForUsages(
      { absolutePath: gone + '.missing', relativePath: 'Policies/gone.yaml' },
    );
    expect(result.usages).toEqual([]);
    expect(result.warning).toMatch(/gone\.yaml/);
  });
```

Export `scanPolicyFileForUsages` from the implementation in Step 3.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/unit/findEnvAttributeUsages.test.ts`

Expected: FAIL — `listSiblingPolicyProjects` / `scanEnvAttributeUsages` not exported.

- [ ] **Step 4: Implement scan**

Append to `src/features/envValuesEditor/findEnvAttributeUsages.ts` (keep the extract function). Full file after this task:

```ts
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { discoverPolicyFiles } from '../circuitSearch/policyFileDiscovery';
import { offsetToRange } from '../circuitSearch/textUtils';
import { isPolicyStudioProject } from '../projectDetection/detectPolicyStudioProject';
import { createProjectId } from '../projectRegistry/projectId';
import type { PolicyStudioProject } from '../projectRegistry/types';
import type {
  EnvAttributePlaceholder,
  EnvAttributeUsage,
  EnvUsageScan,
} from './types';

export const NO_SIBLING_POLICY_PROJECT_WARNING =
  'No Policy Studio project found next to this ENV folder; policy usages were not scanned.';

const ATTRIBUTE_VALUE_PLACEHOLDER = /\{\{\s*([^{}]*?)\.attributeValue\s*\}\}/g;

export function extractEnvAttributePlaceholders(content: string): EnvAttributePlaceholder[] {
  const found: EnvAttributePlaceholder[] = [];
  const pattern = new RegExp(ATTRIBUTE_VALUE_PLACEHOLDER.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const envKey = match[1].trim();
    if (!envKey) {
      continue;
    }
    found.push({
      envKey,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    });
  }
  return found;
}

function detectProjectType(folderPath: string): 'xml' | 'yaml' | undefined {
  if (fs.existsSync(path.join(folderPath, 'PrimaryStore.xml'))) {
    return 'xml';
  }
  if (isPolicyStudioProject(folderPath)) {
    return 'yaml';
  }
  return undefined;
}

export function listSiblingPolicyProjects(envRoot: string): PolicyStudioProject[] {
  const parent = path.dirname(path.resolve(envRoot));
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch {
    return [];
  }

  const projects: PolicyStudioProject[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const rootPath = path.join(parent, entry.name);
    if (path.resolve(rootPath) === path.resolve(envRoot)) {
      continue;
    }
    const projectType = detectProjectType(rootPath);
    if (!projectType) {
      continue;
    }
    projects.push({
      id: createProjectId(rootPath),
      rootPath,
      workspaceFolder: parent,
      relativePath: entry.name,
      displayName: entry.name,
      projectType,
    });
  }
  projects.sort((a, b) => a.rootPath.localeCompare(b.rootPath));
  return projects;
}

export async function scanPolicyFileForUsages(file: {
  absolutePath: string;
  relativePath: string;
}): Promise<{ usages: EnvAttributeUsage[]; warning?: string }> {
  let content: string;
  try {
    content = await fsPromises.readFile(file.absolutePath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      usages: [],
      warning: `Could not read policy file "${file.relativePath}": ${message}`,
    };
  }

  const usages = extractEnvAttributePlaceholders(content).map((placeholder) => {
    const range = offsetToRange(content, placeholder.startOffset, placeholder.endOffset);
    return {
      envKey: placeholder.envKey,
      absolutePath: file.absolutePath,
      relativePath: file.relativePath.split(path.sep).join('/'),
      line: range.start.line + 1,
      range,
    };
  });
  return { usages };
}

export async function scanEnvAttributeUsages(envRoot: string): Promise<EnvUsageScan> {
  const projects = listSiblingPolicyProjects(envRoot);
  if (projects.length === 0) {
    return { byKey: {}, warnings: [NO_SIBLING_POLICY_PROJECT_WARNING], projectCount: 0 };
  }

  const byKey: Record<string, EnvAttributeUsage[]> = {};
  const warnings: string[] = [];

  for (const project of projects) {
    const files = await discoverPolicyFiles(project);
    for (const absolutePath of files) {
      const relativePath = path.relative(project.rootPath, absolutePath);
      const result = await scanPolicyFileForUsages({ absolutePath, relativePath });
      if (result.warning) {
        warnings.push(result.warning);
      }
      for (const usage of result.usages) {
        const list = byKey[usage.envKey] ?? [];
        list.push(usage);
        byKey[usage.envKey] = list;
      }
    }
  }

  return { byKey, warnings, projectCount: projects.length };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/unit/findEnvAttributeUsages.test.ts`

Expected: PASS. If the YAML relative-path sort differs because of OS separators, the implementation already normalizes to `/`.

- [ ] **Step 6: Commit**

```bash
git add src/features/envValuesEditor/findEnvAttributeUsages.ts test/unit/findEnvAttributeUsages.test.ts test/fixtures/env-values-editor/usages
git commit -m "feat: scan sibling policy files for ENV attributeValue usages"
```

---

### Task 3: Detail pane badge and usage list

**Files:**
- Modify: `src/features/envValuesEditor/envValuesPanelHtml.ts`
- Modify: `test/unit/envValuesEditor.test.ts`

**Interfaces:**
- Consumes: `EnvAttributeUsage[]` for the selected leaf
- Produces:
  - `renderEnvValuesDetailHtml(model, selectedPath?, usages?: EnvAttributeUsage[]): string`
  - `EnvValuesPanelViewState.usages?: EnvAttributeUsage[]`
  - `EnvValuesPanelViewState.usageWarnings?: string[]`
  - Webview click on `.usage-hit` posts `{ type: 'openUsage', filePath, range }`

Do **not** change `renderEnvValuesDetailHtml` callers in the service in this task except as needed for TypeScript (optional third arg defaults to `[]`). Existing HTML tests that omit usages must still pass: selected leaves with no usages array show unused (red `0 usages` + “Not used in any policy”). That is correct for the sample fixture (no interpolations).

- [ ] **Step 1: Write the failing HTML tests**

Append to `test/unit/envValuesEditor.test.ts` (add `EnvAttributeUsage` to the types import):

```ts
describe('ENV key usage list HTML', () => {
  it('shows a red unused badge when the selected key has no usages', () => {
    const model = loadEnvValuesSession(envRoot);
    const html = renderEnvValuesEditorHtml(model, 'A.AA', 'sample', { usages: [] });
    expect(html).toContain('class="usage-badge unused"');
    expect(html).toContain('0 usages');
    expect(html).toContain('Not used in any policy');
    expect(html).not.toContain('class="usage-hit"');
  });

  it('shows a count badge and clickable rows for usages', () => {
    const model = loadEnvValuesSession(envRoot);
    const usages: EnvAttributeUsage[] = [
      {
        envKey: 'A.AA',
        absolutePath: '/proj/Policies/Used Circuit.yaml',
        relativePath: 'Policies/Used Circuit.yaml',
        line: 42,
        range: {
          start: { line: 41, character: 9 },
          end: { line: 41, character: 40 },
        },
      },
    ];
    const html = renderEnvValuesEditorHtml(model, 'A.AA', 'sample', { usages });
    expect(html).toContain('class="usage-badge"');
    expect(html).not.toContain('class="usage-badge unused"');
    expect(html).toContain('1 usages');
    expect(html).toContain('Used in');
    expect(html).toContain('Policies/Used Circuit.yaml');
    expect(html).toContain('L42');
    expect(html).toContain('class="usage-hit"');
    expect(html).toContain('openUsage');
  });
});
```

The click-handler test (`toContain('openUsage')`) asserts the **script** posts `type: 'openUsage'` (string present in the bundled script), not a JSON blob in the row. Rows use `data-file`, `data-start-line`, `data-start-character`, `data-end-line`, `data-end-character`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/envValuesEditor.test.ts -t "ENV key usage list HTML"`

Expected: FAIL — `usage-badge` not in HTML.

- [ ] **Step 3: Implement HTML**

1. Import `EnvAttributeUsage` in `envValuesPanelHtml.ts`.

2. Extend `EnvValuesPanelViewState`:

```ts
export interface EnvValuesPanelViewState {
  expandedPaths?: Iterable<string>;
  searchQuery?: string;
  treeScrollTop?: number;
  usages?: EnvAttributeUsage[];
  usageWarnings?: string[];
}
```

3. Add CSS inside `getStyles()` `:root` and rules:

```css
    :root {
      --env-ok-color: var(--vscode-charts-green, #2ea043);
      --env-missing-color: #c9a227;
      --env-missing-bg: rgba(201, 162, 39, 0.28);
      --env-conflict-color: var(--vscode-charts-red, #d1242f);
      --env-unused-color: var(--vscode-charts-red, #d1242f);
    }
    h2 .usage-badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      vertical-align: middle;
      margin-left: 8px;
      padding: 1px 8px;
      border-radius: 8px;
      background: var(--vscode-badge-background, #094771);
      color: var(--vscode-badge-foreground, #fff);
      white-space: nowrap;
    }
    h2 .usage-badge.unused {
      background: var(--env-unused-color);
      color: #fff;
    }
    .usages {
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid var(--vscode-panel-border);
    }
    .usages-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      opacity: 0.7;
      margin-bottom: 6px;
    }
    .usage-hit {
      display: block;
      width: 100%;
      text-align: left;
      background: transparent;
      color: var(--vscode-textLink-foreground, #9cdcfe);
      border: none;
      border-radius: 3px;
      padding: 4px 6px;
      cursor: pointer;
      font: inherit;
    }
    .usage-hit:hover { background: var(--vscode-list-hoverBackground, #2a2d2e); }
    .usage-hit .usage-line { opacity: 0.7; margin-left: 6px; }
    .usages-empty {
      font-style: italic;
      color: var(--env-unused-color);
      opacity: 0.9;
      margin: 0;
    }
```

4. Change `renderBanner` to include `usageWarnings`:

```ts
function renderBanner(model: EnvValuesModel, usageWarnings: string[] = []): string {
  const parseErrors = Object.values(model.documents)
    .filter((document) => document.parseError)
    .map((document) => `${document.stageId}: ${document.parseError}`);

  const parts: string[] = [];
  if (parseErrors.length > 0) {
    parts.push(`<div class="banner error">${escapeHtml(parseErrors.join(' · '))}</div>`);
  }
  const warnings = [...model.warnings, ...usageWarnings];
  if (warnings.length > 0) {
    const preview = warnings.slice(0, 3).join(' · ');
    const suffix = warnings.length > 3 ? '…' : '';
    parts.push(
      `<div class="banner warning">${warnings.length} warning(s): ${escapeHtml(preview)}${suffix}</div>`,
    );
  }
  return parts.join('');
}
```

5. Change `renderEnvValuesDetailHtml` signature and the selected-leaf return (keep the early placeholders unchanged):

```ts
export function renderEnvValuesDetailHtml(
  model: EnvValuesModel,
  selectedPath?: string,
  usages: EnvAttributeUsage[] = [],
): string {
```

After the stage rows are built, replace the final return:

```ts
  const count = usages.length;
  const badgeClass = count === 0 ? 'usage-badge unused' : 'usage-badge';
  const badge = `<span class="${badgeClass}">${count} usages</span>`;
  const usageSection =
    count === 0
      ? `<div class="usages"><p class="usages-empty">Not used in any policy</p></div>`
      : `<div class="usages">
        <div class="usages-label">Used in</div>
        ${usages
          .map(
            (usage) =>
              `<button type="button" class="usage-hit" data-file="${escapeHtml(usage.absolutePath)}" data-start-line="${usage.range.start.line}" data-start-character="${usage.range.start.character}" data-end-line="${usage.range.end.line}" data-end-character="${usage.range.end.character}">${escapeHtml(usage.relativePath)}<span class="usage-line">L${usage.line}</span></button>`,
          )
          .join('')}
      </div>`;

  return `<h2>${escapeHtml(selectedPath)} ${badge}</h2><div class="stage-rows">${rows.join('')}</div>${usageSection}`;
}
```

6. In `renderEnvValuesEditorHtml`, pass usages into detail and banners:

```ts
  const usages = viewState.usages ?? [];
  const usageWarnings = viewState.usageWarnings ?? [];
```

`renderBanner(model)` → `renderBanner(model, usageWarnings)`.

`renderEnvValuesDetailHtml(model, selectedPath)` → `renderEnvValuesDetailHtml(model, selectedPath, usages)`.

7. In the `#detail` click listener (same `detailPane.addEventListener('click', …)`), before the `create-missing` check, add:

```ts
        if (el.classList.contains('usage-hit') || el.closest('.usage-hit')) {
          const hit = el.classList.contains('usage-hit') ? el : el.closest('.usage-hit');
          if (!(hit instanceof HTMLElement)) {
            return;
          }
          vscode.postMessage({
            type: 'openUsage',
            filePath: hit.dataset.file,
            range: {
              start: {
                line: Number(hit.dataset.startLine),
                character: Number(hit.dataset.startCharacter),
              },
              end: {
                line: Number(hit.dataset.endLine),
                character: Number(hit.dataset.endCharacter),
              },
            },
          });
          return;
        }
```

`el.closest` is valid because the handler already uses `el.closest('.list-editor')`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/envValuesEditor.test.ts`

Expected: PASS, including existing empty-state / list-editor tests and the new usage HTML tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/envValuesEditor/envValuesPanelHtml.ts test/unit/envValuesEditor.test.ts
git commit -m "feat: show ENV key usages and unused badge in the editor detail pane"
```

---

### Task 4: Load scan on session and jump to usage

**Files:**
- Modify: `src/features/envValuesEditor/envValuesEditorService.ts`

**Interfaces:**
- Consumes: `scanEnvAttributeUsages`, `renderEnvValuesDetailHtml(..., usages)`, `EnvUsageScan`
- Produces: webview message `{ type: 'openUsage'; filePath: string; range: EnvTextRange }` handled by the service

There is no VS Code unit harness for the panel. Cover the wiring by keeping scan state on the service and passing it into HTML that Task 3 already tests. After this task, `npx vitest run test/unit/findEnvAttributeUsages.test.ts test/unit/envValuesEditor.test.ts` must still pass.

- [ ] **Step 1: Extend IncomingMessage and service fields**

In `envValuesEditorService.ts`:

```ts
import { scanEnvAttributeUsages } from './findEnvAttributeUsages';
import type { EnvTextRange, EnvUsageScan } from './types';
```

Add to `IncomingMessage`:

```ts
  | { type: 'openUsage'; filePath: string; range: EnvTextRange }
```

On the class, next to `searchQuery`:

```ts
  private usageScan: EnvUsageScan = { byKey: {}, warnings: [], projectCount: 0 };
```

- [ ] **Step 2: Load scan in `loadAndShow`**

Change `loadAndShow` to `async` and scan after `loadEnvValuesSession`. Callers that are already `async` must `await` it (`openEditor`, `handleActiveProjectChanged`, `handleSwitchEnv`, `handlePickEnv` if it calls load, `handleReload`).

```ts
  private async loadAndShow(envRoot: string, label?: string): Promise<void> {
    const previousRoot = this.model?.envRoot;
    const sameEnv =
      previousRoot !== undefined && path.resolve(previousRoot) === path.resolve(envRoot);

    try {
      this.model = loadEnvValuesSession(envRoot);
      this.envLabel = label ?? path.basename(path.dirname(envRoot)) ?? path.basename(envRoot);
      this.usageScan = await scanEnvAttributeUsages(envRoot);

      if (!sameEnv) {
        this.selectedPath = undefined;
        this.expandedPaths.clear();
        this.searchQuery = '';
        this.treeScrollTop = 0;
      } else if (this.selectedPath && !findTreeNode(this.model.tree, this.selectedPath)) {
        this.selectedPath = undefined;
      }

      this.showPanel();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Failed to load ENV values: ${message}`);
    }
  }
```

Keep the existing `catch` behaviour (do not invent a new error path). If the current `loadAndShow` already has extra logic, preserve it and only add the `usageScan` assignment + `async`/`await`.

- [ ] **Step 3: Pass usages into `render` and `select`**

Helper on the class:

```ts
  private usagesForSelection(selectedPath: string | undefined): import('./types').EnvAttributeUsage[] {
    if (!selectedPath) {
      return [];
    }
    return this.usageScan.byKey[selectedPath] ?? [];
  }
```

In `render()`, extend the viewState argument:

```ts
        expandedPaths: this.expandedPaths,
        searchQuery: this.searchQuery,
        treeScrollTop: this.treeScrollTop,
        usages: this.usagesForSelection(this.selectedPath),
        usageWarnings: this.usageScan.warnings,
```

In `case 'select':`:

```ts
        void this.panel?.webview.postMessage({
          type: 'showDetail',
          path: message.path,
          html: renderEnvValuesDetailHtml(
            this.model,
            message.path,
            this.usagesForSelection(message.path),
          ),
        });
```

`setValue` / `setList` / `createMissing` / add / remove call `this.render()` — they keep the existing `usageScan` (Save does not rescan; Reload does because it calls `loadAndShow`). That matches the spec.

- [ ] **Step 4: Handle `openUsage`**

Add `case 'openUsage': await this.handleOpenUsage(message.filePath, message.range); break;`

```ts
  private async handleOpenUsage(filePath: string, range: EnvTextRange): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
      const selection = new vscode.Range(
        range.start.line,
        range.start.character,
        range.end.line,
        range.end.character,
      );
      const editor = await vscode.window.showTextDocument(document, { selection });
      editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Could not open policy usage: ${message}`);
    }
  }
```

- [ ] **Step 5: Run unit tests**

Run: `npx vitest run test/unit/findEnvAttributeUsages.test.ts test/unit/envValuesEditor.test.ts`

Expected: PASS.

Run: `npx tsc -p ./ --noEmit`

Expected: no errors (`loadAndShow` now returns `Promise<void>`; every caller must await or void it — prefer `await` in async methods).

- [ ] **Step 6: Commit**

```bash
git add src/features/envValuesEditor/envValuesEditorService.ts
git commit -m "feat: jump from ENV editor usages to policy interpolations"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Match only `{{path.attributeValue}}`, trim braces, exact key | 1 |
| YAML + XML text scan; ignore other placeholders | 1, 2 |
| Sibling policy project(s) next to ENV; reuse policy-file walk | 2 |
| Scan on load and Reload, not Save; no live watch | 4 |
| Badge `N usages`; unused red `0 usages` + “Not used in any policy.” | 3 |
| Clickable `relativePath` + line; jump highlights full `{{…}}` | 3, 4 |
| No unused coloring in the tree | 3 (tree CSS untouched) |
| Unreadable file: skip + warning | 2 |
| No sibling project: unused + banner warning | 2, 3 (`usageWarnings`), 4 |
| Click when file gone: error toast | 4 `handleOpenUsage` catch |
| One row per match | 2 (three A.AA rows in fixture) |
| Orphan interpolations out of scope | no task (YAGNI) |
| Unit tests for extract, used vs unused, skip-unreadable, HTML | 1–3 |

No TBD placeholders. `EnvAttributeUsage.range` is the same shape in Tasks 1, 3, and 4. `loadAndShow` stays the single place that assigns `usageScan`.
