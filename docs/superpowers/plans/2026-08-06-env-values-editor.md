# Environment Values Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a VS Code webview that discovers sibling `ENV/<stage>/values.yaml` files and edits them in one split-pane view (key tree + per-stage values).

**Architecture:** Pure logic under `src/features/envValuesEditor/` (discover → merge model → mutate → write YAML) with a thin VS Code service hosting an interactive webview. Stages are auto-discovered; project-root marker `values.yaml` is never treated as env data. Uses `js-yaml` for generic nested-map parse/stringify.

**Tech Stack:** TypeScript, Vitest, Node `fs`/`path`, `js-yaml`, VS Code WebviewPanel + Tools hub (`009`).

**Spec:** `specs/011-env-values-editor.md`  
**Design:** `docs/superpowers/specs/2026-08-06-env-values-editor-design.md`

## Global Constraints

- Spec-driven / TDD: failing tests before implementation; no behavior beyond `011`.
- Feature code lives under `src/features/envValuesEditor/`; pure logic must be unit-testable without the VS Code API.
- Project scope via `getSharedProjectRegistryStore().getProjectsInScope()` — never assume workspace root is the project.
- YAML entity-store project marker `values.yaml` at project root is unrelated; only `ENV/*/values.yaml`.
- Certificate Store, KPS, lists-as-first-class values, and live file-watch sync are out of scope for v1.
- Empty leaf values are OK; missing keys warn; Create missing inserts `""`; Add key creates path in all stages with `""`.

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/features/envValuesEditor/types.ts` | Domain types (`EnvStage`, `EnvValuesModel`, cell states, mutations) |
| `src/features/envValuesEditor/discoverEnvStages.ts` | Resolve sibling `ENV/`; list stages with `values.yaml` |
| `src/features/envValuesEditor/envValuesModel.ts` | Parse YAML → trees; merge paths; missing vs empty; structural conflicts |
| `src/features/envValuesEditor/envValuesMutations.ts` | setValue, addKey, removeKey, createMissing; dirty tracking |
| `src/features/envValuesEditor/envValuesWriter.ts` | Serialize stage trees back to `values.yaml` |
| `src/features/envValuesEditor/loadEnvValuesSession.ts` | Load session from ENV root (parse all stages into model) |
| `src/features/envValuesEditor/envValuesPanelHtml.ts` | Webview HTML/JS for split-pane editor |
| `src/features/envValuesEditor/envValuesEditorService.ts` | Command, picker, panel, Save/Reload message bridge |
| `src/features/envValuesEditor/toolDescriptor.ts` | Tools hub registration |
| `test/fixtures/env-values-editor/sample/**` | Parent folder with `POLICY_yaml` + `ENV/DEVL|TEST` |
| `test/unit/envValuesEditor.test.ts` | Unit tests for pure logic + tool descriptor |
| `package.json` | Command + `js-yaml` dependency + menus |
| `src/extension.ts` | Activate `EnvValuesEditorService` |
| `specs/009-tools-sidebar.md` | Document new Analyze tool row |

---

### Task 1: Fixtures, types, and stage discovery

**Files:**
- Create: `test/fixtures/env-values-editor/sample/POLICY_yaml/values.yaml`
- Create: `test/fixtures/env-values-editor/sample/POLICY_yaml/Policies/.gitkeep`
- Create: `test/fixtures/env-values-editor/sample/ENV/DEVL/values.yaml`
- Create: `test/fixtures/env-values-editor/sample/ENV/TEST/values.yaml`
- Create: `test/fixtures/env-values-editor/sample/ENV/DEVL/Certificate Store/.gitkeep`
- Create: `src/features/envValuesEditor/types.ts`
- Create: `src/features/envValuesEditor/discoverEnvStages.ts`
- Create: `test/unit/envValuesEditor.test.ts`
- Modify: `package.json` (add `js-yaml` dependency — needed from Task 2 onward; install once here)

**Interfaces:**
- Consumes: Node `fs`/`path`
- Produces:
  - `resolveSiblingEnvRoot(projectRoot: string): string`
  - `discoverEnvStages(envRoot: string): EnvStageDiscovery`
  - `export interface EnvStage { id: string; valuesFilePath: string }`
  - `export interface EnvStageDiscovery { envRoot: string; stages: EnvStage[]; skippedDirs: string[] }`

- [ ] **Step 1: Add `js-yaml` dependency**

```bash
npm install js-yaml
npm install -D @types/js-yaml
```

Expected: `package.json` lists `js-yaml` under `dependencies`.

- [ ] **Step 2: Create fixture files**

`test/fixtures/env-values-editor/sample/POLICY_yaml/values.yaml`:

```yaml
Policies: {}
```

`test/fixtures/env-values-editor/sample/ENV/DEVL/values.yaml`:

```yaml
A:
  AA: Inhalt
B:
  BA:
    BAA: Inhalt2
    BAB: Inhalt3
  BB:
    BBA: Inhalt 4
```

`test/fixtures/env-values-editor/sample/ENV/TEST/values.yaml`:

```yaml
A:
  AA: Inhalt-test
B:
  BA:
    BAA: Inhalt2
  BB:
    BBA: Inhalt 4
```

(Note: TEST intentionally omits `B.BA.BAB` so missing-key tests work. Create empty `Policies` dir and `Certificate Store` dir via `.gitkeep`.)

- [ ] **Step 3: Write failing discovery tests**

In `test/unit/envValuesEditor.test.ts`:

```typescript
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  discoverEnvStages,
  resolveSiblingEnvRoot,
} from '../../src/features/envValuesEditor/discoverEnvStages';

const sampleRoot = path.join(__dirname, '..', 'fixtures', 'env-values-editor', 'sample');
const policyRoot = path.join(sampleRoot, 'POLICY_yaml');
const envRoot = path.join(sampleRoot, 'ENV');

describe('env values discovery', () => {
  it('resolves sibling ENV next to the policy project', () => {
    expect(resolveSiblingEnvRoot(policyRoot)).toBe(envRoot);
  });

  it('discovers stages that contain values.yaml and skips Certificate Store', () => {
    const result = discoverEnvStages(envRoot);
    expect(result.envRoot).toBe(envRoot);
    expect(result.stages.map((s) => s.id).sort()).toEqual(['DEVL', 'TEST']);
    expect(result.stages.every((s) => s.valuesFilePath.endsWith(`${path.sep}values.yaml`))).toBe(
      true,
    );
    expect(result.skippedDirs).toContain('Certificate Store');
  });

  it('returns empty stages when ENV has no stage values.yaml files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-empty-'));
    const emptyEnv = path.join(tmp, 'ENV');
    fs.mkdirSync(emptyEnv);
    const result = discoverEnvStages(emptyEnv);
    expect(result.stages).toEqual([]);
  });
});
```

- [ ] **Step 4: Run tests — expect FAIL**

```bash
npm test -- test/unit/envValuesEditor.test.ts
```

Expected: FAIL (module not found / functions missing).

- [ ] **Step 5: Implement types + discovery**

`src/features/envValuesEditor/types.ts`:

```typescript
export type EnvScalar = string | number | boolean | null;

export interface EnvStage {
  id: string;
  valuesFilePath: string;
}

export interface EnvStageDiscovery {
  envRoot: string;
  stages: EnvStage[];
  skippedDirs: string[];
}

export type EnvCellState =
  | { kind: 'value'; value: EnvScalar }
  | { kind: 'missing' }
  | { kind: 'conflict'; detail: string };

export interface EnvTreeNode {
  name: string;
  path: string;
  children?: EnvTreeNode[];
  /** Present only on leaves */
  cells?: Record<string, EnvCellState>;
}

export interface EnvStageDocument {
  stageId: string;
  filePath: string;
  /** Nested plain object; maps only + scalar leaves */
  data: Record<string, unknown>;
  parseError?: string;
  dirty: boolean;
}

export interface EnvValuesModel {
  envRoot: string;
  stages: EnvStage[];
  documents: Record<string, EnvStageDocument>;
  tree: EnvTreeNode[];
  warnings: string[];
}
```

`src/features/envValuesEditor/discoverEnvStages.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import type { EnvStage, EnvStageDiscovery } from './types';

export function resolveSiblingEnvRoot(projectRoot: string): string {
  return path.join(path.dirname(path.resolve(projectRoot)), 'ENV');
}

export function discoverEnvStages(envRoot: string): EnvStageDiscovery {
  const resolved = path.resolve(envRoot);
  const stages: EnvStage[] = [];
  const skippedDirs: string[] = [];

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return { envRoot: resolved, stages, skippedDirs };
  }

  for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const stageDir = path.join(resolved, entry.name);
    const valuesFilePath = path.join(stageDir, 'values.yaml');
    if (fs.existsSync(valuesFilePath) && fs.statSync(valuesFilePath).isFile()) {
      stages.push({ id: entry.name, valuesFilePath });
    } else {
      skippedDirs.push(entry.name);
    }
  }

  stages.sort((a, b) => a.id.localeCompare(b.id));
  return { envRoot: resolved, stages, skippedDirs };
}
```

- [ ] **Step 6: Run tests — expect PASS**

```bash
npm test -- test/unit/envValuesEditor.test.ts
```

Expected: PASS for discovery tests.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/features/envValuesEditor test/fixtures/env-values-editor test/unit/envValuesEditor.test.ts
git commit -m "feat(env-values): add fixtures and ENV stage discovery"
```

---

### Task 2: Load and merge env values model

**Files:**
- Create: `src/features/envValuesEditor/envValuesModel.ts`
- Create: `src/features/envValuesEditor/loadEnvValuesSession.ts`
- Modify: `test/unit/envValuesEditor.test.ts`

**Interfaces:**
- Consumes: `discoverEnvStages`, `EnvStage`, `js-yaml`
- Produces:
  - `parseEnvValuesYaml(text: string): { data: Record<string, unknown>; error?: string }`
  - `buildEnvValuesModel(envRoot: string, documents: EnvStageDocument[]): EnvValuesModel`
  - `loadEnvValuesSession(envRoot: string): EnvValuesModel`
  - Helpers used by mutations: `getLeafPaths(data)`, `getValueAtPath`, `setValueAtPath`, `deleteValueAtPath`, `pathExists`

- [ ] **Step 1: Write failing model tests**

Append to `test/unit/envValuesEditor.test.ts`:

```typescript
import { loadEnvValuesSession } from '../../src/features/envValuesEditor/loadEnvValuesSession';
import { parseEnvValuesYaml } from '../../src/features/envValuesEditor/envValuesModel';

describe('env values model', () => {
  it('treats empty string as present value, not missing', () => {
    const parsed = parseEnvValuesYaml('A:\n  AA: ""\n');
    expect(parsed.error).toBeUndefined();
    expect(parsed.data).toEqual({ A: { AA: '' } });
  });

  it('marks BAB missing in TEST but present in DEVL', () => {
    const model = loadEnvValuesSession(envRoot);
    const bab = findLeaf(model.tree, 'B.BA.BAB');
    expect(bab?.cells?.DEVL).toEqual({ kind: 'value', value: 'Inhalt3' });
    expect(bab?.cells?.TEST).toEqual({ kind: 'missing' });
    expect(model.warnings.some((w) => w.includes('B.BA.BAB') && w.includes('TEST'))).toBe(true);
  });

  it('loads AA values for both stages', () => {
    const model = loadEnvValuesSession(envRoot);
    const aa = findLeaf(model.tree, 'A.AA');
    expect(aa?.cells?.DEVL).toEqual({ kind: 'value', value: 'Inhalt' });
    expect(aa?.cells?.TEST).toEqual({ kind: 'value', value: 'Inhalt-test' });
  });

  it('isolates invalid YAML to one stage', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-bad-'));
    const badEnv = path.join(tmp, 'ENV');
    fs.mkdirSync(path.join(badEnv, 'DEVL'), { recursive: true });
    fs.mkdirSync(path.join(badEnv, 'TEST'), { recursive: true });
    fs.writeFileSync(path.join(badEnv, 'DEVL', 'values.yaml'), 'A:\n  AA: ok\n');
    fs.writeFileSync(path.join(badEnv, 'TEST', 'values.yaml'), 'A: [\n');
    const model = loadEnvValuesSession(badEnv);
    expect(model.documents.TEST.parseError).toBeTruthy();
    expect(model.documents.DEVL.parseError).toBeUndefined();
    const aa = findLeaf(model.tree, 'A.AA');
    expect(aa?.cells?.DEVL).toEqual({ kind: 'value', value: 'ok' });
  });

  it('warns on map vs scalar structural conflict', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-conflict-'));
    const conflictEnv = path.join(tmp, 'ENV');
    fs.mkdirSync(path.join(conflictEnv, 'DEVL'), { recursive: true });
    fs.mkdirSync(path.join(conflictEnv, 'TEST'), { recursive: true });
    fs.writeFileSync(path.join(conflictEnv, 'DEVL', 'values.yaml'), 'A:\n  AA: scalar\n');
    fs.writeFileSync(path.join(conflictEnv, 'TEST', 'values.yaml'), 'A:\n  AA:\n    nested: x\n');
    const model = loadEnvValuesSession(conflictEnv);
    expect(model.warnings.some((w) => w.toLowerCase().includes('conflict'))).toBe(true);
  });
});

function findLeaf(
  nodes: import('../../src/features/envValuesEditor/types').EnvTreeNode[],
  dotted: string,
): import('../../src/features/envValuesEditor/types').EnvTreeNode | undefined {
  const parts = dotted.split('.');
  let current = nodes;
  let node: import('../../src/features/envValuesEditor/types').EnvTreeNode | undefined;
  for (const part of parts) {
    node = current.find((n) => n.name === part);
    if (!node) {
      return undefined;
    }
    current = node.children ?? [];
  }
  return node;
}
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- test/unit/envValuesEditor.test.ts
```

Expected: FAIL (missing modules).

- [ ] **Step 3: Implement model + loader**

Implement `envValuesModel.ts` with:

- `parseEnvValuesYaml` using `yaml.load` from `js-yaml`; reject non-object roots; on throw return `{ data: {}, error: message }`.
- `isPlainObject`, `isScalar` helpers.
- `collectLeafPaths(data, prefix='')` → string paths; skip list values (do not treat arrays as editable leaves; if array encountered, add a warning path note via caller).
- `getValueAtPath` / `pathExists` / `setValueAtPath` / `deleteValueAtPath` operating on nested `Record<string, unknown>` (create intermediate maps as needed for set).
- `buildEnvValuesModel(envRoot, documents)`:
  - Union all leaf paths from documents without `parseError`.
  - For each path × stage: if path missing → `{ kind: 'missing' }`; if scalar → `{ kind: 'value', value }`; if present but non-scalar map while another stage has scalar (or vice versa) → conflict cells + warning.
  - Build nested `EnvTreeNode[]` from paths; attach `cells` only on leaves.
  - Aggregate `warnings` for each missing path×stage and each conflict.

Implement `loadEnvValuesSession.ts`:

```typescript
import * as fs from 'fs';
import { discoverEnvStages } from './discoverEnvStages';
import { buildEnvValuesModel, parseEnvValuesYaml } from './envValuesModel';
import type { EnvStageDocument, EnvValuesModel } from './types';

export function loadEnvValuesSession(envRoot: string): EnvValuesModel {
  const discovery = discoverEnvStages(envRoot);
  const documents: EnvStageDocument[] = discovery.stages.map((stage) => {
    const text = fs.readFileSync(stage.valuesFilePath, 'utf8');
    const parsed = parseEnvValuesYaml(text);
    return {
      stageId: stage.id,
      filePath: stage.valuesFilePath,
      data: parsed.data,
      parseError: parsed.error,
      dirty: false,
    };
  });
  return buildEnvValuesModel(discovery.envRoot, documents);
}
```

Keep path helpers exported from `envValuesModel.ts` for Task 3.

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- test/unit/envValuesEditor.test.ts
```

Expected: all model tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/envValuesEditor test/unit/envValuesEditor.test.ts
git commit -m "feat(env-values): merge multi-stage values into editor model"
```

---

### Task 3: Mutations (set, add, remove, create missing)

**Files:**
- Create: `src/features/envValuesEditor/envValuesMutations.ts`
- Modify: `test/unit/envValuesEditor.test.ts`

**Interfaces:**
- Consumes: path helpers + `buildEnvValuesModel` from `envValuesModel`
- Produces:
  - `setLeafValue(model, path, stageId, value): EnvValuesModel`
  - `addKey(model, path): EnvValuesModel` — creates `""` in all stages without parseError
  - `removeKey(model, path): EnvValuesModel` — deletes from all stages that have it
  - `createMissing(model, path, stageId): EnvValuesModel` — sets `""` in that stage
  - Each returns a **new** model with `dirty: true` on affected documents and rebuilt tree/warnings

- [ ] **Step 1: Write failing mutation tests**

```typescript
import {
  addKey,
  createMissing,
  removeKey,
  setLeafValue,
} from '../../src/features/envValuesEditor/envValuesMutations';

describe('env values mutations', () => {
  it('setLeafValue updates one stage and marks it dirty', () => {
    const model = loadEnvValuesSession(envRoot);
    const next = setLeafValue(model, 'A.AA', 'DEVL', 'changed');
    expect(findLeaf(next.tree, 'A.AA')?.cells?.DEVL).toEqual({ kind: 'value', value: 'changed' });
    expect(next.documents.DEVL.dirty).toBe(true);
    expect(next.documents.TEST.dirty).toBe(false);
  });

  it('createMissing inserts empty string for TEST BAB', () => {
    const model = loadEnvValuesSession(envRoot);
    const next = createMissing(model, 'B.BA.BAB', 'TEST');
    expect(findLeaf(next.tree, 'B.BA.BAB')?.cells?.TEST).toEqual({ kind: 'value', value: '' });
    expect(next.documents.TEST.dirty).toBe(true);
  });

  it('addKey creates path in all stages', () => {
    const model = loadEnvValuesSession(envRoot);
    const next = addKey(model, 'C.CA');
    expect(findLeaf(next.tree, 'C.CA')?.cells?.DEVL).toEqual({ kind: 'value', value: '' });
    expect(findLeaf(next.tree, 'C.CA')?.cells?.TEST).toEqual({ kind: 'value', value: '' });
    expect(next.documents.DEVL.dirty).toBe(true);
    expect(next.documents.TEST.dirty).toBe(true);
  });

  it('removeKey deletes path from all stages', () => {
    const model = loadEnvValuesSession(envRoot);
    const next = removeKey(model, 'A.AA');
    expect(findLeaf(next.tree, 'A.AA')).toBeUndefined();
    expect(next.documents.DEVL.dirty).toBe(true);
    expect(next.documents.TEST.dirty).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- test/unit/envValuesEditor.test.ts
```

Expected: FAIL (mutations not found).

- [ ] **Step 3: Implement mutations**

```typescript
// envValuesMutations.ts — pattern for each function:
// 1. deep-clone documents (JSON.parse(JSON.stringify) is OK for plain data)
// 2. apply setValueAtPath / deleteValueAtPath on relevant stage data
// 3. mark dirty
// 4. return buildEnvValuesModel(model.envRoot, Object.values(clonedDocs))
```

Refuse `setLeafValue` / `createMissing` when the stage has `parseError` (return model unchanged or throw — prefer return unchanged and leave a warning string if easy). Refuse writing into a conflict cell without resolving structure — for v1, `setLeafValue` only allowed when current cell is `value` or `missing` (createMissing handles missing).

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- test/unit/envValuesEditor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/envValuesEditor/envValuesMutations.ts test/unit/envValuesEditor.test.ts
git commit -m "feat(env-values): add set/add/remove/create-missing mutations"
```

---

### Task 4: Write-back dirty stages

**Files:**
- Create: `src/features/envValuesEditor/envValuesWriter.ts`
- Modify: `test/unit/envValuesEditor.test.ts`

**Interfaces:**
- Consumes: `EnvValuesModel`, `js-yaml.dump`
- Produces: `writeDirtyEnvDocuments(model: EnvValuesModel): { written: string[]; model: EnvValuesModel }`  
  Writes each dirty document without `parseError`; clears `dirty`; returns updated model.

- [ ] **Step 1: Write failing writer test**

```typescript
import { writeDirtyEnvDocuments } from '../../src/features/envValuesEditor/envValuesWriter';

describe('env values writer', () => {
  it('writes only dirty stages and round-trips values', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-write-'));
    const writeEnv = path.join(tmp, 'ENV');
    fs.mkdirSync(path.join(writeEnv, 'DEVL'), { recursive: true });
    fs.mkdirSync(path.join(writeEnv, 'TEST'), { recursive: true });
    fs.writeFileSync(path.join(writeEnv, 'DEVL', 'values.yaml'), 'A:\n  AA: one\n');
    fs.writeFileSync(path.join(writeEnv, 'TEST', 'values.yaml'), 'A:\n  AA: two\n');

    let model = loadEnvValuesSession(writeEnv);
    model = setLeafValue(model, 'A.AA', 'DEVL', 'updated');
    const result = writeDirtyEnvDocuments(model);

    expect(result.written).toEqual([path.join(writeEnv, 'DEVL', 'values.yaml')]);
    expect(result.model.documents.DEVL.dirty).toBe(false);

    const reloaded = loadEnvValuesSession(writeEnv);
    expect(findLeaf(reloaded.tree, 'A.AA')?.cells?.DEVL).toEqual({
      kind: 'value',
      value: 'updated',
    });
    expect(findLeaf(reloaded.tree, 'A.AA')?.cells?.TEST).toEqual({
      kind: 'value',
      value: 'two',
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- test/unit/envValuesEditor.test.ts
```

Expected: FAIL (writer missing).

- [ ] **Step 3: Implement writer**

```typescript
import * as fs from 'fs';
import yaml from 'js-yaml';
import type { EnvValuesModel } from './types';

export function writeDirtyEnvDocuments(model: EnvValuesModel): {
  written: string[];
  model: EnvValuesModel;
} {
  const written: string[] = [];
  const documents = { ...model.documents };

  for (const [stageId, doc] of Object.entries(documents)) {
    if (!doc.dirty || doc.parseError) {
      continue;
    }
    const text = yaml.dump(doc.data, {
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    });
    fs.writeFileSync(doc.filePath, text, 'utf8');
    written.push(doc.filePath);
    documents[stageId] = { ...doc, dirty: false };
  }

  return {
    written,
    model: { ...model, documents },
  };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- test/unit/envValuesEditor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/envValuesEditor/envValuesWriter.ts test/unit/envValuesEditor.test.ts
git commit -m "feat(env-values): write dirty stage values.yaml files"
```

---

### Task 5: Tool descriptor, command contribution, and service + webview

**Files:**
- Create: `src/features/envValuesEditor/toolDescriptor.ts`
- Create: `src/features/envValuesEditor/envValuesPanelHtml.ts`
- Create: `src/features/envValuesEditor/envValuesEditorService.ts`
- Modify: `package.json` (commands + commandPalette + optional menus)
- Modify: `src/extension.ts`
- Modify: `test/unit/envValuesEditor.test.ts`
- Modify: `specs/009-tools-sidebar.md` (add Analyze row for ENV editor)

**Interfaces:**
- Consumes: all pure modules + `getSharedProjectRegistryStore` + `getSharedToolsHubService`
- Produces: `EnvValuesEditorService.activate()`; command `policyStudioTools.openEnvValuesEditor`

- [ ] **Step 1: Write tool descriptor test**

```typescript
import { ENV_VALUES_EDITOR_TOOL } from '../../src/features/envValuesEditor/toolDescriptor';

describe('env values tool descriptor', () => {
  it('registers under Analyze with openEnvValuesEditor command', () => {
    expect(ENV_VALUES_EDITOR_TOOL.group).toBe('analyze');
    expect(ENV_VALUES_EDITOR_TOOL.command).toBe('policyStudioTools.openEnvValuesEditor');
    expect(ENV_VALUES_EDITOR_TOOL.available).toBe(true);
  });
});
```

- [ ] **Step 2: Implement toolDescriptor**

```typescript
import type { ToolsHubTool } from '../toolsSidebar/types';

export const ENV_VALUES_EDITOR_TOOL: ToolsHubTool = {
  id: 'env-values-editor',
  label: 'ENV values editor',
  iconId: 'symbol-field',
  command: 'policyStudioTools.openEnvValuesEditor',
  group: 'analyze',
  order: 2,
  when: 'policyStudio.projectDetected',
  available: true,
};
```

- [ ] **Step 3: Add package.json command**

Under `contributes.commands`, after `showCircuitGraph`:

```json
{
  "command": "policyStudioTools.openEnvValuesEditor",
  "title": "Open ENV Values Editor",
  "category": "Policy Studio"
}
```

Under `commandPalette`, add when `policyStudio.projectDetected` (same pattern as comparePolicies).

- [ ] **Step 4: Implement panel HTML**

`envValuesPanelHtml.ts` exports:

- `getEnvValuesPanelShellHtml(nonce: string): string` — CSP, layout CSS (left tree ~38%, right detail), toolbar buttons Save / Reload / Add key / Remove key / Open ENV folder, `#tree`, `#detail`, script with `acquireVsCodeApi()`.
- `renderEnvValuesEditorHtml(model: EnvValuesModel, selectedPath?: string): string` — full document including serialized model JSON in a `<script type="application/json" id="model">` and client JS that:
  - Renders expandable tree; click leaf → postMessage `{ type: 'select', path }` and show detail fields.
  - Detail: for each stage, input if `value`; warning + “Create missing” button if `missing`; conflict text if `conflict`.
  - Input `change` → `{ type: 'setValue', path, stageId, value }`.
  - Toolbar → `{ type: 'save' | 'reload' | 'addKey' | 'removeKey' | 'pickEnv' }`.
  - Create missing → `{ type: 'createMissing', path, stageId }`.
  - Add/remove: postMessage and let extension host prompt via `showInputBox` / `showWarningMessage` (webview may post `{ type: 'addKey' }` without path; host prompts).

Use VS Code CSS variables like circuit graph panel. Keep client JS inside nonce script tag.

- [ ] **Step 5: Implement `EnvValuesEditorService`**

```typescript
export class EnvValuesEditorService {
  private panel: vscode.WebviewPanel | undefined;
  private model: EnvValuesModel | undefined;
  private selectedPath: string | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  activate(): void {
    getSharedToolsHubService().registerTool(ENV_VALUES_EDITOR_TOOL);
    this.context.subscriptions.push(
      vscode.commands.registerCommand('policyStudioTools.openEnvValuesEditor', () =>
        this.openEditor(),
      ),
    );
  }

  // openEditor:
  // 1. Resolve project: getProjectsInScope(); if 0 → showErrorMessage; if 1 use it;
  //    if many, prefer scope.mode === 'activeProject' match, else QuickPick projects.
  // 2. sibling = resolveSiblingEnvRoot(project.rootPath)
  // 3. if !fs.existsSync(sibling) → offer modal: Pick ENV folder… / Cancel
  // 4. loadEnvValuesSession(envRoot); showPanel
  //
  // showPanel: create/reveal webviewViewType 'policyStudio.envValuesEditor'
  // onDidReceiveMessage: handle select/setValue/save/reload/addKey/removeKey/createMissing/pickEnv
  // save → writeDirtyEnvDocuments; showInformationMessage with count
  // reload → if any dirty, confirm discard; reload from model.envRoot
  // addKey → showInputBox for path; addKey(); refresh html
  // removeKey → confirm; removeKey(selectedPath)
  // pickEnv → showOpenDialog folder; load that root
}
```

Also export a small pure helper for tests if useful:

```typescript
export function pickProjectRootForEnvEditor(
  projects: PolicyStudioProject[],
  scope: ProjectScope,
): PolicyStudioProject | undefined
```

Prefer `activeProjectId` when present and in list; else single project; else `undefined` (caller shows QuickPick).

- [ ] **Step 6: Wire `src/extension.ts`**

```typescript
import { EnvValuesEditorService } from './features/envValuesEditor/envValuesEditorService';
// ...
const envValuesEditor = new EnvValuesEditorService(context);
envValuesEditor.activate();
```

- [ ] **Step 7: Update `specs/009-tools-sidebar.md`**

Add under Analyze table/list:

`$(symbol-field) ENV values editor → openEnvValuesEditor` (spec `011`).

- [ ] **Step 8: Run unit tests + compile**

```bash
npm test -- test/unit/envValuesEditor.test.ts
npx tsc -p ./ --noEmit
```

Expected: PASS / no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/features/envValuesEditor src/extension.ts package.json package-lock.json test/unit/envValuesEditor.test.ts specs/009-tools-sidebar.md
git commit -m "feat(env-values): add webview editor command and tools hub entry"
```

---

### Task 6: Manual verification checklist (no commit required unless fixes)

**Files:** none expected (fix-only)

- [ ] **Step 1: Compile and run Extension Development Host**

```bash
npm run compile
```

Launch VS Code Extension Development Host against a folder matching:

```
Parent/
  POLICY_yaml/   (or open the sample fixture parent)
  ENV/DEVL|TEST/values.yaml
```

- [ ] **Step 2: Exercise acceptance paths**

1. Command Palette → “Open ENV Values Editor” (or Tools sidebar Analyze).
2. Tree shows `A` / `B` nesting; select `A.AA` → DEVL/TEST fields differ.
3. Select `B.BA.BAB` → TEST shows missing warning; Create missing → empty field; Save → TEST file gains key.
4. Edit a value → Save → reload file on disk matches.
5. Add key `C.CA` → both stages; Remove key → both stages.
6. Rename/remove sibling ENV temporarily → picker offered.

- [ ] **Step 3: If bugs found, add a failing unit test first, fix, commit**

```bash
git commit -m "fix(env-values): <short bug description>"
```

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| Sibling `ENV/` discovery + auto stages | Task 1 |
| Optional folder picker | Task 5 |
| Nested map model; empty ≠ missing | Task 2 |
| Missing warnings + Create missing | Tasks 2–3, 5 |
| Edit / add / remove + Save | Tasks 3–5 |
| Invalid YAML isolation | Task 2 |
| Structural conflict warning | Task 2 |
| Certificate Store ignored | Task 1 |
| Tools sidebar Analyze | Task 5 |
| Unit tests + fixtures | Tasks 1–4 |
| `openEnvValuesEditor` command | Task 5 |
| Project scope APIs | Task 5 |

No placeholders left. Types (`EnvValuesModel`, mutation signatures, discovery helpers) are consistent across tasks.
