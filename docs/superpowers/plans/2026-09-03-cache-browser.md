# Cache Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a read-only VS Code webview that lists Policy Studio caches (local, distributed, other), searches that inventory, and jumps to `cache:` / known caching-filter usages.

**Architecture:** Pure logic under `src/features/cacheBrowser/` (discover → parse YAML/XML to one model → resolve usages → search) with a thin VS Code service hosting a master–detail webview. Do not extend Circuit Search or the circuit index.

**Tech Stack:** TypeScript, Vitest, Node `fs`/`path`, existing `parseMappingYaml` (`src/features/envValuesEditor/yamlMaps.ts`), VS Code `WebviewPanel` + Tools hub (`009`).

**Spec:** `specs/013-cache-browser.md`  
**Design:** `docs/superpowers/specs/2026-09-03-cache-browser-design.md`

## Global Constraints

- Spec-driven / TDD: failing tests before implementation; no behavior beyond `013`.
- Feature code under `src/features/cacheBrowser/`; pure logic unit-testable without the VS Code API.
- Project scope via `getSharedProjectRegistryStore().getProjectsInScope()` — never assume workspace root is the project.
- YAML is primary; XML is legacy; both produce the same `ParsedCache` / `CacheUsage` model.
- YAML discovery: `Libraries/Cache Manager/**/*.yaml|yml` except `_parent.yaml`. Empty/invalid files → warning, skip.
- XML discovery: entity-store entities with type `Cache` or `DistributedCache` only (no XML “other” kinds).
- Kind: `Cache` → `local`, `DistributedCache` → `distributed` (case-insensitive); any other YAML Cache Manager entity → `other`.
- Usage: field names `cache` and `cacheToUse`, plus known filter types `CacheAttribute`, `IsCached`, `RemoveCachedAttribute` (case-insensitive, optional `Filter` suffix). Scan all project YAML/XML except cache inventory files.
- Search: case-insensitive substring over name, kind, entity type, scalar field keys/values. Empty query = all. Do not search usage text.
- Read-only: no create/edit/delete. No live file watch. No Server Settings cache. No META-INF type browser.
- Exact empty-state copy: `No caches under Libraries/Cache Manager.` / `No caches match.` / `No policies or caching filters reference this cache yet.`
- Command: `policyStudioTools.openCacheBrowser`. Panel title: `Caches`. Tools label: `Caches`.

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/features/cacheBrowser/types.ts` | `CacheKind`, `ParsedCache`, `CacheUsage`, `CacheSession`, `CacheWarning` |
| `src/features/cacheBrowser/cacheIdentity.ts` | `classifyCacheKind`, `isKnownCachingFilterType`, `isCacheFieldName`, `toYamlPk`, `cacheId`, `cacheListHint`, `scalarFieldMap` |
| `src/features/cacheBrowser/parseCacheYaml.ts` | One YAML file → `ParsedCache` or warning |
| `src/features/cacheBrowser/parseCacheXml.ts` | One XML file → zero or more `ParsedCache` |
| `src/features/cacheBrowser/discoverCaches.ts` | Walk Cache Manager (YAML) and XML files; parse; collect warnings |
| `src/features/cacheBrowser/resolveCacheRef.ts` | Resolve a field value to a cache in the same project |
| `src/features/cacheBrowser/findCacheUsages.ts` | Scan project YAML/XML for cache-field and caching-filter usages |
| `src/features/cacheBrowser/searchCaches.ts` | Filter inventory by query |
| `src/features/cacheBrowser/loadCacheSession.ts` | Discover + usage → `CacheSession` |
| `src/features/cacheBrowser/cachePanelHtml.ts` | Master–detail webview HTML |
| `src/features/cacheBrowser/cacheBrowserService.ts` | Command, panel, refresh, follow scope, open/jump |
| `src/features/cacheBrowser/toolDescriptor.ts` | Tools hub registration (Analyze, order 4) |
| `test/fixtures/cache-browser/yaml-project/**` | YAML caches + usages |
| `test/fixtures/cache-browser/xml-project/PrimaryStore.xml` | XML caches + usage |
| `test/unit/cacheBrowser.test.ts` | Unit tests |
| `package.json` / `src/extension.ts` / `test/unit/toolRegistrations.test.ts` | Wire-up |

---

### Task 1: Fixtures, types, identity helpers, YAML parse

**Files:**
- Create: `test/fixtures/cache-browser/yaml-project/values.yaml`
- Create: `test/fixtures/cache-browser/yaml-project/Policies/UsesCors.yaml`
- Create: `test/fixtures/cache-browser/yaml-project/Environment Configuration/OAuth Store.yaml`
- Create: `test/fixtures/cache-browser/yaml-project/Libraries/Cache Manager/_parent.yaml`
- Create: `test/fixtures/cache-browser/yaml-project/Libraries/Cache Manager/CORS Profiles.yaml`
- Create: `test/fixtures/cache-browser/yaml-project/Libraries/Cache Manager/Cron Expression Library.yaml`
- Create: `test/fixtures/cache-browser/yaml-project/Libraries/Cache Manager/Custom Store.yaml`
- Create: `test/fixtures/cache-browser/yaml-project/Libraries/Cache Manager/Empty.yaml` (zero bytes)
- Create: `src/features/cacheBrowser/types.ts`
- Create: `src/features/cacheBrowser/cacheIdentity.ts`
- Create: `src/features/cacheBrowser/parseCacheYaml.ts`
- Create: `test/unit/cacheBrowser.test.ts`

**Interfaces:**
- Consumes: `PolicyStudioProject` from `src/features/projectRegistry/types.ts`; `parseMappingYaml` from `src/features/envValuesEditor/yamlMaps.ts`
- Produces:
  - `export type CacheKind = 'local' | 'distributed' | 'other'`
  - `export type CacheUsageKind = 'cache-field' | 'caching-filter'`
  - `export interface ParsedCache { name: string; kind: CacheKind; entityType: string; fields: Record<string, string>; yamlPk: string; filePath: string; startOffset: number; endOffset: number; projectId: string; projectDisplayName: string }`
  - `export interface CacheUsage { cacheId: string; cacheName: string; usageKind: CacheUsageKind; filePath: string; circuitName?: string; filterName?: string; filterType?: string; fieldName?: string; matchPreview: string; startOffset: number; projectId: string; projectDisplayName: string }`
  - `export interface CacheSession { caches: ParsedCache[]; usages: CacheUsage[]; warnings: string[]; projectLabel: string }`
  - `classifyCacheKind(entityType: string): CacheKind`
  - `isKnownCachingFilterType(entityType: string): boolean`
  - `isCacheFieldName(fieldName: string): boolean`
  - `toYamlPk(projectRoot: string, filePath: string): string`
  - `cacheId(cache: ParsedCache): string` → `${projectId}::${filePath}::${startOffset}`
  - `cacheListHint(cache: ParsedCache): string` → `eternal` if `fields.eternal` is `true` (case-insensitive); else `TTL ${n}s` if `timeToLiveSeconds` is present; else `''`
  - `parseCacheYaml(content: string, filePath: string, project: PolicyStudioProject): { cache?: ParsedCache; warning?: string }`

- [ ] **Step 1: Write fixtures**

`test/fixtures/cache-browser/yaml-project/values.yaml`:

```yaml
Policies: {}
```

`Libraries/Cache Manager/_parent.yaml`:

```yaml
---
type: CacheManager
fields:
  name: Cache Manager
```

`Libraries/Cache Manager/CORS Profiles.yaml`:

```yaml
---
type: Cache
fields:
  name: CORS Profiles
  eternal: true
```

`Libraries/Cache Manager/Cron Expression Library.yaml`:

```yaml
---
type: DistributedCache
fields:
  name: Cron Expression Library
  maxElementsInMemory: 10000
  maxElementsOnDisk: 10001
  overflowToDisk: true
  timeToLiveSeconds: 600
  timeToIdleSeconds: 300
```

`Libraries/Cache Manager/Custom Store.yaml`:

```yaml
---
type: WidgetCache
fields:
  name: Custom Store
  maxSize: 42
```

`Libraries/Cache Manager/Empty.yaml`: empty file (no bytes).

`Policies/UsesCors.yaml`:

```yaml
---
type: FilterCircuit
fields:
  name: Uses CORS
  start: ./Cache Attribute
children:
- type: CacheAttribute
  fields:
    name: Cache Attribute
    cache: /Libraries/Cache Manager/CORS Profiles
- type: IsCached
  fields:
    name: Is Cached?
    cacheToUse: ./CORS Profiles
- type: RemoveCachedAttribute
  fields:
    name: Remove Cron
    other: /Libraries/Cache Manager/Cron Expression Library
```

`Environment Configuration/OAuth Store.yaml`:

```yaml
---
type: AuthzCodePersist
fields:
  name: Authz Code Store
  cache: /Libraries/Cache Manager/CORS Profiles
```

- [ ] **Step 2: Write failing tests** in `test/unit/cacheBrowser.test.ts`

```typescript
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  cacheId,
  cacheListHint,
  classifyCacheKind,
  isCacheFieldName,
  isKnownCachingFilterType,
  toYamlPk,
} from '../../src/features/cacheBrowser/cacheIdentity';
import { parseCacheYaml } from '../../src/features/cacheBrowser/parseCacheYaml';
import type { PolicyStudioProject } from '../../src/features/projectRegistry/types';
import type { ParsedCache } from '../../src/features/cacheBrowser/types';

const yamlRoot = path.join(__dirname, '..', 'fixtures', 'cache-browser', 'yaml-project');

function yamlProject(root = yamlRoot): PolicyStudioProject {
  return {
    id: 'yaml-1',
    rootPath: root,
    workspaceFolder: root,
    relativePath: 'yaml-project',
    displayName: 'yaml-project',
    projectType: 'yaml',
  };
}

describe('cache identity', () => {
  it('classifies Cache, DistributedCache, and other case-insensitively', () => {
    expect(classifyCacheKind('Cache')).toBe('local');
    expect(classifyCacheKind('cache')).toBe('local');
    expect(classifyCacheKind('DistributedCache')).toBe('distributed');
    expect(classifyCacheKind('WidgetCache')).toBe('other');
  });

  it('recognizes known caching filters with optional Filter suffix', () => {
    expect(isKnownCachingFilterType('CacheAttribute')).toBe(true);
    expect(isKnownCachingFilterType('IsCachedFilter')).toBe(true);
    expect(isKnownCachingFilterType('RemoveCachedAttribute')).toBe(true);
    expect(isKnownCachingFilterType('CompareAttributeFilter')).toBe(false);
  });

  it('treats cache and cacheToUse as cache field names', () => {
    expect(isCacheFieldName('cache')).toBe(true);
    expect(isCacheFieldName('cacheToUse')).toBe(true);
    expect(isCacheFieldName('other')).toBe(false);
  });

  it('builds YamlPK with forward slashes and no extension', () => {
    const filePath = path.join(yamlRoot, 'Libraries', 'Cache Manager', 'CORS Profiles.yaml');
    expect(toYamlPk(yamlRoot, filePath)).toBe('/Libraries/Cache Manager/CORS Profiles');
  });
});

describe('parseCacheYaml', () => {
  const project = yamlProject();

  it('parses a local cache and uses fields.name', () => {
    const content = `---\ntype: Cache\nfields:\n  name: CORS Profiles\n  eternal: true\n`;
    const filePath = path.join(yamlRoot, 'Libraries', 'Cache Manager', 'CORS Profiles.yaml');
    const { cache, warning } = parseCacheYaml(content, filePath, project);
    expect(warning).toBeUndefined();
    expect(cache?.kind).toBe('local');
    expect(cache?.entityType).toBe('Cache');
    expect(cache?.name).toBe('CORS Profiles');
    expect(cache?.fields.eternal).toBe('true');
    expect(cache?.yamlPk).toBe('/Libraries/Cache Manager/CORS Profiles');
    expect(cacheListHint(cache as ParsedCache)).toBe('eternal');
    expect(cacheId(cache as ParsedCache)).toContain(filePath);
  });

  it('parses a distributed cache and TTL hint', () => {
    const content = `---\ntype: DistributedCache\nfields:\n  name: Cron Expression Library\n  timeToLiveSeconds: 600\n`;
    const filePath = path.join(yamlRoot, 'Libraries', 'Cache Manager', 'Cron Expression Library.yaml');
    const { cache } = parseCacheYaml(content, filePath, project);
    expect(cache?.kind).toBe('distributed');
    expect(cacheListHint(cache as ParsedCache)).toBe('TTL 600s');
  });

  it('classifies unknown types as other and omits nested fields', () => {
    const content = `---\ntype: WidgetCache\nfields:\n  name: Custom Store\n  nested:\n    a: 1\n`;
    const filePath = path.join(yamlRoot, 'Libraries', 'Cache Manager', 'Custom Store.yaml');
    const { cache } = parseCacheYaml(content, filePath, project);
    expect(cache?.kind).toBe('other');
    expect(cache?.fields.nested).toBeUndefined();
    expect(cache?.fields.name).toBe('Custom Store');
  });

  it('falls back to basename when fields.name is missing', () => {
    const content = `---\ntype: Cache\nfields:\n  eternal: true\n`;
    const filePath = path.join(yamlRoot, 'Libraries', 'Cache Manager', 'CORS Profiles.yaml');
    const { cache } = parseCacheYaml(content, filePath, project);
    expect(cache?.name).toBe('CORS Profiles');
  });

  it('warns on empty content and invalid YAML', () => {
    const filePath = path.join(yamlRoot, 'Libraries', 'Cache Manager', 'Empty.yaml');
    expect(parseCacheYaml('   \n', filePath, project).warning).toMatch(/empty/i);
    expect(parseCacheYaml('::::', filePath, project).warning).toMatch(/invalid/i);
    expect(parseCacheYaml('::::', filePath, project).cache).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- test/unit/cacheBrowser.test.ts`

Expected: FAIL (modules not found)

- [ ] **Step 4: Implement types, identity helpers, and YAML parse**

`src/features/cacheBrowser/types.ts` — export the interfaces listed above.

`src/features/cacheBrowser/cacheIdentity.ts`:

```typescript
import * as path from 'path';
import type { CacheKind, ParsedCache } from './types';

const KNOWN_FILTERS = new Set(['cacheattribute', 'iscached', 'removecachedattribute']);
const CACHE_FIELDS = new Set(['cache', 'cachetouse']);

export function classifyCacheKind(entityType: string): CacheKind {
  const normalized = entityType.trim().toLowerCase();
  if (normalized === 'cache') {
    return 'local';
  }
  if (normalized === 'distributedcache') {
    return 'distributed';
  }
  return 'other';
}

export function isKnownCachingFilterType(entityType: string): boolean {
  return KNOWN_FILTERS.has(entityType.trim().toLowerCase().replace(/filter$/, ''));
}

export function isCacheFieldName(fieldName: string): boolean {
  return CACHE_FIELDS.has(fieldName.trim().toLowerCase());
}

export function toYamlPk(projectRoot: string, filePath: string): string {
  const relative = path.relative(projectRoot, filePath).replace(/\\/g, '/');
  return `/${relative.replace(/\.(ya?ml)$/i, '')}`;
}

export function cacheId(cache: ParsedCache): string {
  return `${cache.projectId}::${cache.filePath}::${cache.startOffset}`;
}

export function cacheListHint(cache: ParsedCache): string {
  if ((cache.fields.eternal ?? '').toLowerCase() === 'true') {
    return 'eternal';
  }
  const ttl = cache.fields.timeToLiveSeconds;
  return ttl ? `TTL ${ttl}s` : '';
}

export function scalarFieldMap(fields: unknown): Record<string, string> {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = String(value);
    }
  }
  return out;
}
```

`src/features/cacheBrowser/parseCacheYaml.ts`:

```typescript
import * as path from 'path';
import { parseMappingYaml } from '../envValuesEditor/yamlMaps';
import type { PolicyStudioProject } from '../projectRegistry/types';
import { classifyCacheKind, scalarFieldMap, toYamlPk } from './cacheIdentity';
import type { ParsedCache } from './types';

export function parseCacheYaml(
  content: string,
  filePath: string,
  project: PolicyStudioProject,
): { cache?: ParsedCache; warning?: string } {
  if (content.trim() === '') {
    return { warning: `Empty cache file: ${filePath}` };
  }

  const parsed = parseMappingYaml(content);
  if (parsed.error) {
    return { warning: `Invalid YAML in ${filePath}: ${parsed.error}` };
  }

  const entityType = typeof parsed.data.type === 'string' ? parsed.data.type.trim() : '';
  if (!entityType) {
    return { warning: `No type in ${filePath}` };
  }

  const fields = scalarFieldMap(parsed.data.fields);
  const basename = path.basename(filePath, path.extname(filePath));
  const typeIndex = content.search(/^type:\s*/m);
  const startOffset = typeIndex >= 0 ? typeIndex : 0;

  return {
    cache: {
      name: fields.name?.trim() || basename,
      kind: classifyCacheKind(entityType),
      entityType,
      fields,
      yamlPk: toYamlPk(project.rootPath, filePath),
      filePath,
      startOffset,
      endOffset: content.length,
      projectId: project.id,
      projectDisplayName: project.displayName,
    },
  };
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `npm test -- test/unit/cacheBrowser.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/cache-browser src/features/cacheBrowser/types.ts src/features/cacheBrowser/cacheIdentity.ts src/features/cacheBrowser/parseCacheYaml.ts test/unit/cacheBrowser.test.ts
git commit -m "$(cat <<'EOF'
feat(cache-browser): parse YAML cache entities into a shared model

EOF
)"
```

On Windows PowerShell, if heredoc is unavailable, use:

```bash
git commit -m "feat(cache-browser): parse YAML cache entities into a shared model"
```

---

### Task 2: Discover YAML caches

**Files:**
- Create: `src/features/cacheBrowser/discoverCaches.ts`
- Modify: `test/unit/cacheBrowser.test.ts`

**Interfaces:**
- Consumes: `parseCacheYaml`; `PolicyStudioProject`
- Produces:
  - `export function discoverCaches(project: PolicyStudioProject): { caches: ParsedCache[]; warnings: string[]; inventoryPaths: string[] }`
  - YAML: walk `Libraries/Cache Manager/` recursively; include `.yaml`/`.yml`; skip `_parent.yaml` (any case-insensitive match of that exact basename); empty/invalid → warning, not a cache
Implement YAML now and an internal `discoverYamlCaches`. Public `discoverCaches` concatenates YAML + XML. In this task `discoverXmlCaches` is a stub that returns empty arrays; Task 3 replaces the stub. Missing `Libraries/Cache Manager/` → empty YAML result, no warning.

- [ ] **Step 1: Write failing discovery tests**

```typescript
import fs from 'fs';
import { discoverCaches } from '../../src/features/cacheBrowser/discoverCaches';

describe('discoverCaches YAML', () => {
  it('finds local, distributed, and other caches and skips _parent.yaml', () => {
    const { caches, warnings, inventoryPaths } = discoverCaches(yamlProject());
    const names = caches.map((c) => c.name).sort();
    expect(names).toEqual(['CORS Profiles', 'Cron Expression Library', 'Custom Store']);
    expect(caches.find((c) => c.name === 'CORS Profiles')?.kind).toBe('local');
    expect(caches.find((c) => c.name === 'Cron Expression Library')?.kind).toBe('distributed');
    expect(caches.find((c) => c.name === 'Custom Store')?.kind).toBe('other');
    expect(caches.some((c) => c.filePath.endsWith('_parent.yaml'))).toBe(false);
    expect(warnings.some((w) => /empty/i.test(w))).toBe(true);
    expect(inventoryPaths).toHaveLength(3);
  });

  it('returns empty caches when Cache Manager is missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-none-'));
    fs.writeFileSync(path.join(tmp, 'values.yaml'), 'Policies: {}\n');
    fs.mkdirSync(path.join(tmp, 'Policies'));
    const result = discoverCaches(yamlProject(tmp));
    expect(result.caches).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
```

Add `import os from 'os';` and `import fs from 'fs';` at top of the test file.

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- test/unit/cacheBrowser.test.ts`

Expected: FAIL (`discoverCaches` not defined)

- [ ] **Step 3: Implement `discoverCaches.ts`**

```typescript
import * as fs from 'fs';
import * as path from 'path';
import type { PolicyStudioProject } from '../projectRegistry/types';
import { parseCacheYaml } from './parseCacheYaml';
import type { ParsedCache } from './types';

const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'out', 'dist', 'build']);
const PARENT_BASENAME = '_parent.yaml';

export function discoverCaches(project: PolicyStudioProject): {
  caches: ParsedCache[];
  warnings: string[];
  inventoryPaths: string[];
} {
  const yaml = discoverYamlCaches(project);
  const xml = discoverXmlCaches(project);
  return {
    caches: [...yaml.caches, ...xml.caches],
    warnings: [...yaml.warnings, ...xml.warnings],
    inventoryPaths: [...yaml.inventoryPaths, ...xml.inventoryPaths],
  };
}

function discoverYamlCaches(project: PolicyStudioProject): {
  caches: ParsedCache[];
  warnings: string[];
  inventoryPaths: string[];
} {
  const caches: ParsedCache[] = [];
  const warnings: string[] = [];
  const inventoryPaths: string[] = [];
  const root = path.join(project.rootPath, 'Libraries', 'Cache Manager');
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return { caches, warnings, inventoryPaths };
  }

  for (const filePath of listFiles(root, ['.yaml', '.yml'])) {
    if (path.basename(filePath).toLowerCase() === PARENT_BASENAME) {
      continue;
    }
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Unreadable cache file ${filePath}: ${message}`);
      continue;
    }
    const parsed = parseCacheYaml(content, filePath, project);
    if (parsed.warning) {
      warnings.push(parsed.warning);
    }
    if (parsed.cache) {
      caches.push(parsed.cache);
      inventoryPaths.push(path.resolve(filePath));
    }
  }

  return { caches, warnings, inventoryPaths };
}

export function discoverXmlCaches(_project: PolicyStudioProject): {
  caches: ParsedCache[];
  warnings: string[];
  inventoryPaths: string[];
} {
  return { caches: [], warnings: [], inventoryPaths: [] };
}

export function listFiles(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }
      out.push(...listFiles(full, extensions));
      continue;
    }
    if (entry.isFile() && extensions.includes(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}
```

Export `listFiles` and `EXCLUDED_DIRS` usage for Task 5 file walking. Keep `EXCLUDED_DIRS` in this file; Task 5 will import `listFiles`.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit** `feat(cache-browser): discover YAML caches under Cache Manager`

---

### Task 3: XML parse and discovery

**Files:**
- Create: `src/features/cacheBrowser/parseCacheXml.ts`
- Create: `test/fixtures/cache-browser/xml-project/PrimaryStore.xml`
- Modify: `src/features/cacheBrowser/discoverCaches.ts` (`discoverXmlCaches`)
- Modify: `test/unit/cacheBrowser.test.ts`

**Interfaces:**
- Consumes: `isWellFormedXml` from `src/features/circuitSearch/xmlPolicyParser.ts`; `classifyCacheKind`; `PolicyStudioProject`
- Produces:
  - `parseCacheXml(content: string, filePath: string, project: PolicyStudioProject): { caches: ParsedCache[]; warning?: string }`
  - Nested `<entity type="Cache|DistributedCache">` are included (recurse into entity bodies)
  - Other entity types are not inventory rows
  - `yamlPk` for XML: `/Libraries/Cache Manager/${name}`
  - Name from `fields`-equivalent: `<id field="name" value="…"/>` or `<fval name="name"><value>…</value></fval>`
  - Scalar fval entries populate `fields`
  - `discoverXmlCaches` walks all `.xml` under the project root (via `listFiles(project.rootPath, ['.xml'])`), skips unreadable files with warnings

- [ ] **Step 1: Write XML fixture** `test/fixtures/cache-browser/xml-project/PrimaryStore.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<entityStore>
  <entity type="CacheGroup">
    <id field="name" value="Cache Manager"/>
    <entity type="Cache">
      <id field="name" value="HTTP Sessions"/>
      <fval name="name"><value>HTTP Sessions</value></fval>
      <fval name="eternal"><value>true</value></fval>
    </entity>
    <entity type="DistributedCache">
      <id field="name" value="OAuth Tokens"/>
      <fval name="name"><value>OAuth Tokens</value></fval>
      <fval name="timeToLiveSeconds"><value>600</value></fval>
    </entity>
  </entity>
  <entity type="FilterCircuit">
    <id field="name" value="Lookup"/>
    <entity type="CacheAttribute">
      <id field="name" value="Cache Response"/>
      <fval name="cache"><value>/Libraries/Cache Manager/HTTP Sessions</value></fval>
    </entity>
  </entity>
  <entity type="SomethingElse">
    <id field="name" value="Not A Cache"/>
  </entity>
</entityStore>
```

- [ ] **Step 2: Write failing XML tests**

```typescript
import { parseCacheXml } from '../../src/features/cacheBrowser/parseCacheXml';

const xmlRoot = path.join(__dirname, '..', 'fixtures', 'cache-browser', 'xml-project');

function xmlProject(root = xmlRoot): PolicyStudioProject {
  return {
    id: 'xml-1',
    rootPath: root,
    workspaceFolder: root,
    relativePath: 'xml-project',
    displayName: 'xml-project',
    projectType: 'xml',
  };
}

describe('parseCacheXml', () => {
  it('parses nested Cache and DistributedCache into the same model and ignores other types', () => {
    const content = fs.readFileSync(path.join(xmlRoot, 'PrimaryStore.xml'), 'utf8');
    const { caches, warning } = parseCacheXml(content, path.join(xmlRoot, 'PrimaryStore.xml'), xmlProject());
    expect(warning).toBeUndefined();
    expect(caches.map((c) => c.name).sort()).toEqual(['HTTP Sessions', 'OAuth Tokens']);
    expect(caches.find((c) => c.name === 'HTTP Sessions')?.kind).toBe('local');
    expect(caches.find((c) => c.name === 'OAuth Tokens')?.kind).toBe('distributed');
    expect(caches.find((c) => c.name === 'HTTP Sessions')?.yamlPk).toBe(
      '/Libraries/Cache Manager/HTTP Sessions',
    );
    expect(caches.some((c) => c.name === 'Not A Cache' || c.name === 'Lookup')).toBe(false);
  });

  it('warns on invalid XML and returns no caches', () => {
    const { caches, warning } = parseCacheXml('<entity>', path.join(xmlRoot, 'broken.xml'), xmlProject());
    expect(caches).toEqual([]);
    expect(warning).toMatch(/invalid xml/i);
  });
});

describe('discoverCaches XML', () => {
  it('finds XML cache entities from PrimaryStore.xml', () => {
    const { caches } = discoverCaches(xmlProject());
    expect(caches.map((c) => c.name).sort()).toEqual(['HTTP Sessions', 'OAuth Tokens']);
  });

  it('returns an empty inventory for XML with no Cache entities', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-xml-none-'));
    fs.writeFileSync(path.join(tmp, 'PrimaryStore.xml'), '<entityStore></entityStore>\n');
    expect(discoverCaches(xmlProject(tmp)).caches).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

- [ ] **Step 4: Implement `parseCacheXml.ts` and fill in `discoverXmlCaches`**

`parseCacheXml.ts` must:

1. If `!isWellFormedXml(content)` return `{ caches: [], warning: \`Invalid XML in ${filePath}\` }`.
2. Find every `<entity …>` block with a nested-aware closer (copy the `findEntityCloseIndex` / `findAllEntityBlocks` approach from `xmlPolicyParser.ts` into this file — do not import those unexported functions). Recurse into each entity `body` so nested Cache entities inside a group are found.
3. For each entity whose type (case-insensitive) is `Cache` or `DistributedCache`, read name from `<id field="name" value="…"/>` or fval `name`; collect every `<fval name="X"><value>Y</value></fval>` as a scalar field; skip nested object-like values (fval text only).
4. `startOffset` / `endOffset` are the entity block offsets in the file.

`discoverXmlCaches`: `listFiles(project.rootPath, ['.xml'])`; read each; `parseCacheXml`; push caches; `inventoryPaths` get `path.resolve(filePath)` once per file that contributed at least one cache (usage skip is by file path, so the whole PrimaryStore.xml is an inventory file). **Important:** if PrimaryStore.xml is in `inventoryPaths`, the usage scan would skip the CacheAttribute inside it. Spec says exclude cache inventory files so we do not treat cache definitions as usages. XML usage in the same file as definitions would then be missed.

**Lock this now:** XML inventory paths are **not** excluded from usage scanning. YAML inventory paths **are** excluded (cache definition files under Cache Manager). XML usage lives in the same entity-store file as the caches, so `findCacheUsages` (Task 5) must skip YAML inventory paths only, not XML files that also contain filters.

Add a comment on `inventoryPaths`: YAML cache files only. Change Task 2’s `inventoryPaths` to only push YAML file paths (already the case). `discoverXmlCaches` returns `inventoryPaths: []`.

- [ ] **Step 5: Tests PASS; commit** `feat(cache-browser): parse XML Cache and DistributedCache entities`

---

### Task 4: Search

**Files:**
- Create: `src/features/cacheBrowser/searchCaches.ts`
- Modify: `test/unit/cacheBrowser.test.ts`

**Interfaces:**
- Consumes: `ParsedCache`
- Produces: `searchCaches(caches: ParsedCache[], query: string): ParsedCache[]`
  - Trim query; empty or whitespace → return `caches` in the same order
  - Case-insensitive substring match against: `name`, `kind`, `entityType`, every field key, every field value
  - Does not look at usages

- [ ] **Step 1: Failing tests**

```typescript
import { searchCaches } from '../../src/features/cacheBrowser/searchCaches';

describe('searchCaches', () => {
  const caches = discoverCaches(yamlProject()).caches;

  it('returns all caches for empty query', () => {
    expect(searchCaches(caches, '  ').map((c) => c.name)).toEqual(caches.map((c) => c.name));
  });

  it('matches name, kind, type, and field values', () => {
    expect(searchCaches(caches, 'cors').map((c) => c.name)).toEqual(['CORS Profiles']);
    expect(searchCaches(caches, 'local').map((c) => c.name)).toEqual(['CORS Profiles']);
    expect(searchCaches(caches, 'WidgetCache').map((c) => c.name)).toEqual(['Custom Store']);
    expect(searchCaches(caches, '600').map((c) => c.name)).toEqual(['Cron Expression Library']);
  });

  it('does not match usage circuit text', () => {
    expect(searchCaches(caches, 'Uses CORS')).toEqual([]);
    expect(searchCaches(caches, 'Authz Code Store')).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import type { ParsedCache } from './types';

export function searchCaches(caches: ParsedCache[], query: string): ParsedCache[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return caches;
  }
  return caches.filter((cache) => {
    const haystacks = [
      cache.name,
      cache.kind,
      cache.entityType,
      ...Object.keys(cache.fields),
      ...Object.values(cache.fields),
    ];
    return haystacks.some((part) => part.toLowerCase().includes(needle));
  });
}
```

- [ ] **Step 3: Tests PASS; commit** `feat(cache-browser): search cache inventory by name kind and fields`

---

### Task 5: Resolve refs and find usages

**Files:**
- Create: `src/features/cacheBrowser/resolveCacheRef.ts`
- Create: `src/features/cacheBrowser/findCacheUsages.ts`
- Modify: `test/unit/cacheBrowser.test.ts`

**Interfaces:**
- Consumes: `ParsedCache`, `cacheId`, `isCacheFieldName`, `isKnownCachingFilterType`, `listFiles`
- Produces:
  - `resolveCacheRef(value: string, caches: ParsedCache[]): ParsedCache | undefined`
    1. Strip quotes/whitespace
    2. Exact `yamlPk` match (unique)
    3. Last path segment of the value (after `/` or `\`) equals a cache `name` **or** last `yamlPk` segment — only if that match is unique among `caches`
    4. Bare name unique match on `cache.name`
    5. Else `undefined` (ambiguous or unknown)
  - `findCacheUsages(project, caches, skipPaths: Set<string>): { usages: CacheUsage[]; warnings: string[] }`
    - Walk `.yaml`/`.yml`/`.xml` under `project.rootPath` via `listFiles`
    - Skip resolved paths in `skipPaths` (YAML inventory files)
    - Skip `_parent.yaml`
    - Unreadable / invalid YAML or XML → warning, continue
    - YAML: line-oriented scan described below
    - XML: recurse entities; record when a cache field or known filter type has a resolvable value

**YAML scan algorithm (lock this):**

Walk lines. Track `typeStack: { indent: number; type: string }[]` — on `type: Foo` at indent N, pop entries with indent >= N then push. Track `nameStack` the same way for `name:` keys (any indent). Track `circuitName` as the most recent `name` seen while type is `FilterCircuit`.

On a line matching `^(\s*)([A-Za-z][\w]*)\s*:\s*(.+)$` with a scalar value (not starting a nested block — value not empty `{`/`[` and not nothing with following indent-only children; treat quoted or plain scalars on the same line):

- Let `fieldName` = key, `raw` = unquoted value
- Let `entityType` = top of typeStack
- If `isCacheFieldName(fieldName)` OR (`entityType` && `isKnownCachingFilterType(entityType)`): call `resolveCacheRef(raw, caches)`
- If resolved, push usage:
  - `usageKind`: `caching-filter` if `isKnownCachingFilterType(entityType)` else `cache-field`
  - `filterType`: entityType
  - `filterName`: top of nameStack if that name is not the circuit name
  - `circuitName` if known
  - `fieldName`
  - `matchPreview`: trimmed line
  - `startOffset`: offset of the line in the file
  - `cacheId` / `cacheName` from the resolved cache

- [ ] **Step 1: Failing tests**

```typescript
import { resolveCacheRef } from '../../src/features/cacheBrowser/resolveCacheRef';
import { findCacheUsages } from '../../src/features/cacheBrowser/findCacheUsages';

describe('resolveCacheRef', () => {
  const caches = discoverCaches(yamlProject()).caches;

  it('matches exact YamlPK, relative last segment, and unique bare name', () => {
    expect(resolveCacheRef('/Libraries/Cache Manager/CORS Profiles', caches)?.name).toBe(
      'CORS Profiles',
    );
    expect(resolveCacheRef('./CORS Profiles', caches)?.name).toBe('CORS Profiles');
    expect(resolveCacheRef('CORS Profiles', caches)?.name).toBe('CORS Profiles');
  });

  it('does not match ambiguous bare names', () => {
    const dupA: ParsedCache = { ...caches[0], name: 'Shared', filePath: 'a.yaml', startOffset: 1 };
    const dupB: ParsedCache = { ...caches[0], name: 'Shared', filePath: 'b.yaml', startOffset: 2 };
    expect(resolveCacheRef('Shared', [dupA, dupB])).toBeUndefined();
    expect(resolveCacheRef('/Libraries/Cache Manager/CORS Profiles', [dupA, dupB])?.filePath).toBe(
      caches[0].filePath,
    );
  });
});

describe('findCacheUsages', () => {
  it('finds cache-field and known-filter usages including Environment Configuration', () => {
    const discovered = discoverCaches(yamlProject());
    const skip = new Set(discovered.inventoryPaths);
    const { usages, warnings } = findCacheUsages(yamlProject(), discovered.caches, skip);
    expect(warnings).toEqual([]);
    const cors = usages.filter((u) => u.cacheName === 'CORS Profiles');
    expect(cors.some((u) => u.usageKind === 'caching-filter' && u.filterType === 'CacheAttribute')).toBe(
      true,
    );
    expect(cors.some((u) => u.fieldName === 'cacheToUse')).toBe(true);
    expect(cors.some((u) => u.filePath.includes('OAuth Store.yaml') && u.usageKind === 'cache-field')).toBe(
      true,
    );
    const cron = usages.filter((u) => u.cacheName === 'Cron Expression Library');
    expect(cron.some((u) => u.filterType === 'RemoveCachedAttribute' && u.fieldName === 'other')).toBe(
      true,
    );
    expect(usages.some((u) => u.cacheName === 'Custom Store')).toBe(false);
  });

  it('skips YAML inventory files so cache definitions are not usages', () => {
    const discovered = discoverCaches(yamlProject());
    const { usages } = findCacheUsages(
      yamlProject(),
      discovered.caches,
      new Set(discovered.inventoryPaths),
    );
    expect(usages.every((u) => !u.filePath.includes(`${path.sep}Cache Manager${path.sep}`))).toBe(
      true,
    );
  });

  it('records XML CacheAttribute usage in the same file as cache definitions', () => {
    const discovered = discoverCaches(xmlProject());
    const { usages } = findCacheUsages(xmlProject(), discovered.caches, new Set());
    expect(usages.some((u) => u.cacheName === 'HTTP Sessions' && u.filterType === 'CacheAttribute')).toBe(
      true,
    );
  });

  it('warns and continues when a usage file is invalid', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-bad-usage-'));
    fs.writeFileSync(path.join(tmp, 'values.yaml'), 'Policies: {}\n');
    fs.mkdirSync(path.join(tmp, 'Policies'));
    fs.mkdirSync(path.join(tmp, 'Libraries', 'Cache Manager'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'Libraries', 'Cache Manager', 'One.yaml'),
      '---\ntype: Cache\nfields:\n  name: One\n',
    );
    fs.writeFileSync(path.join(tmp, 'Policies', 'Broken.yaml'), '::::\n');
    const project = yamlProject(tmp);
    const discovered = discoverCaches(project);
    const { usages, warnings } = findCacheUsages(project, discovered.caches, new Set(discovered.inventoryPaths));
    expect(usages).toEqual([]);
    expect(warnings.some((w) => /Broken.yaml/i.test(w))).toBe(true);
  });
});
```

If `::::` is not reported as invalid by the YAML usage scanner (line-oriented scan may ignore it), still warn when `parseMappingYaml` fails **or** when XML `isWellFormedXml` fails. For YAML usage files, if the line scanner finds no `type:`/`cache:` it is valid to produce zero usages without a warning. **Adjust the invalid-file test to use a zero-permission or missing-read simulation is hard on Windows.** Use an XML usage file that is not well-formed instead:

`fs.writeFileSync(path.join(tmp, 'Policies', 'Broken.xml'), '<entity>');`

and expect a warning matching `Broken.xml`. YAML `::::` need not warn. Update the test accordingly so it is deterministic.

- [ ] **Step 2: Implement `resolveCacheRef.ts`**

```typescript
import type { ParsedCache } from './types';

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function lastSegment(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function uniqueMatch(caches: ParsedCache[], predicate: (cache: ParsedCache) => boolean): ParsedCache | undefined {
  const matches = caches.filter(predicate);
  return matches.length === 1 ? matches[0] : undefined;
}

export function resolveCacheRef(value: string, caches: ParsedCache[]): ParsedCache | undefined {
  const raw = stripQuotes(value);
  if (!raw) {
    return undefined;
  }

  const byPk = uniqueMatch(caches, (cache) => cache.yamlPk === raw);
  if (byPk) {
    return byPk;
  }

  const segment = lastSegment(raw);
  const bySegment = uniqueMatch(
    caches,
    (cache) => cache.name === segment || lastSegment(cache.yamlPk) === segment,
  );
  if (raw.includes('/') || raw.includes('\\') || raw.startsWith('./')) {
    return bySegment;
  }

  return uniqueMatch(caches, (cache) => cache.name === raw);
}
```

Bare name uses step 4 only (`cache.name === raw`). Relative `./CORS Profiles` uses last-segment uniqueness. Exact yamlPk wins first.

- [ ] **Step 3: Implement `findCacheUsages.ts`**

Walk files with `listFiles(project.rootPath, ['.yaml', '.yml', '.xml'])`. Skip `skipPaths` (compare `path.resolve`). Skip basename `_parent.yaml`. `.yaml`/`.yml` → `scanYamlUsages(content, filePath, project, caches)`. `.xml` → `scanXmlUsages` using the same entity-block helpers as `parseCacheXml` (export `findAllEntityBlocks` and `readFvals` from `parseCacheXml.ts` so this file can reuse them rather than duplicating).

For XML entities: gather type, name, all fval scalars. If type is known filter, try `resolveCacheRef` on every fval; else only on `cache` / `cacheToUse`. Circuit name: nearest ancestor FilterCircuit name (pass parent type/name while recursing).

For YAML invalid XML-in-yaml-project: well-formed check only for `.xml`.

Export `offsetAtLine(content, lineIndex)` for startOffset.

- [ ] **Step 4: Tests PASS; commit** `feat(cache-browser): resolve cache refs and collect usages`

---

### Task 6: Load session

**Files:**
- Create: `src/features/cacheBrowser/loadCacheSession.ts`
- Modify: `test/unit/cacheBrowser.test.ts`

**Interfaces:**
- Consumes: `discoverCaches`, `findCacheUsages`, `searchCaches` (not required inside loader)
- Produces:
  - `loadCacheSession(projects: PolicyStudioProject[]): CacheSession`
  - Concatenate caches/usages/warnings per project (usages resolved only against that project’s caches)
  - `projectLabel`: `''` if `projects.length === 0`; `projects[0].displayName` if length 1; otherwise `${projects.length} projects`
  - Unused caches remain in `caches` with zero matching usages

- [ ] **Step 1: Failing tests**

```typescript
import { loadCacheSession } from '../../src/features/cacheBrowser/loadCacheSession';
import { cacheId } from '../../src/features/cacheBrowser/cacheIdentity';

describe('loadCacheSession', () => {
  it('loads yaml caches, usages, empty-file warning, and project label', () => {
    const session = loadCacheSession([yamlProject()]);
    expect(session.projectLabel).toBe('yaml-project');
    expect(session.caches.map((c) => c.name).sort()).toEqual([
      'CORS Profiles',
      'Cron Expression Library',
      'Custom Store',
    ]);
    expect(session.warnings.some((w) => /empty/i.test(w))).toBe(true);
    const cors = session.caches.find((c) => c.name === 'CORS Profiles');
    const corsUsages = session.usages.filter((u) => u.cacheId === cacheId(cors!));
    expect(corsUsages.length).toBeGreaterThanOrEqual(3);
    const custom = session.caches.find((c) => c.name === 'Custom Store');
    expect(session.usages.filter((u) => u.cacheId === cacheId(custom!))).toHaveLength(0);
  });

  it('labels multiple projects and does not resolve refs across projects', () => {
    const session = loadCacheSession([yamlProject(), xmlProject()]);
    expect(session.projectLabel).toBe('2 projects');
    expect(session.caches.some((c) => c.projectId === 'yaml-1')).toBe(true);
    expect(session.caches.some((c) => c.projectId === 'xml-1')).toBe(true);
    const cors = session.caches.find((c) => c.name === 'CORS Profiles');
    expect(
      session.usages
        .filter((u) => u.cacheId === cacheId(cors!))
        .every((u) => u.projectId === 'yaml-1'),
    ).toBe(true);
  });

  it('returns empty inventory for a project with no caches', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-empty-proj-'));
    fs.writeFileSync(path.join(tmp, 'values.yaml'), 'Policies: {}\n');
    fs.mkdirSync(path.join(tmp, 'Policies'));
    const session = loadCacheSession([yamlProject(tmp)]);
    expect(session.caches).toEqual([]);
    expect(session.usages).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import type { PolicyStudioProject } from '../projectRegistry/types';
import { discoverCaches } from './discoverCaches';
import { findCacheUsages } from './findCacheUsages';
import type { CacheSession } from './types';

export function loadCacheSession(projects: PolicyStudioProject[]): CacheSession {
  const session: CacheSession = {
    caches: [],
    usages: [],
    warnings: [],
    projectLabel:
      projects.length === 0 ? '' : projects.length === 1 ? projects[0].displayName : `${projects.length} projects`,
  };

  for (const project of projects) {
    const discovered = discoverCaches(project);
    session.caches.push(...discovered.caches);
    session.warnings.push(...discovered.warnings);
    const usage = findCacheUsages(project, discovered.caches, new Set(discovered.inventoryPaths));
    session.usages.push(...usage.usages);
    session.warnings.push(...usage.warnings);
  }

  return session;
}
```

- [ ] **Step 3: Tests PASS; commit** `feat(cache-browser): load cache session for projects in scope`

---

### Task 7: Master–detail panel HTML

**Files:**
- Create: `src/features/cacheBrowser/cachePanelHtml.ts`
- Modify: `test/unit/cacheBrowser.test.ts`

**Interfaces:**
- Consumes: `CacheSession`, `searchCaches`, `cacheId`, `cacheListHint`
- Produces:
  - `renderCacheBrowserHtml(session: CacheSession, options: { nonce: string; cspSource: string; selectedId?: string; query: string }): string`
  - Groups: Local / Distributed / Other — omit empty groups; sort rows by `name` then `projectDisplayName`
  - Multi-project: show `projectDisplayName` on each row
  - Selected cache: settings table of scalar fields; usage rows; unused copy exactly `No policies or caching filters reference this cache yet.`
  - No caches (and empty query): `No caches under Libraries/Cache Manager.`
  - Query with zero hits: `No caches match.`
  - Warnings joined in a banner
  - Toolbar: title `Caches`, project label, search input, buttons `Refresh` and `Open YAML`
  - Webview posts `{ type: 'ready' | 'search' | 'select' | 'refresh' | 'openCache' | 'openUsage' }`

Reuse KPS/ENV styling tokens (`--vscode-*`). Escape all interpolated strings.

Helper `usagesForCache(session, cache)` filters `session.usages` by `cacheId(cache)`.

- [ ] **Step 1: Failing HTML tests**

```typescript
import { renderCacheBrowserHtml } from '../../src/features/cacheBrowser/cachePanelHtml';
import { cacheId } from '../../src/features/cacheBrowser/cacheIdentity';

const htmlOpts = { nonce: 'testnonce', cspSource: 'https://example', query: '' };

describe('cache panel html', () => {
  it('renders grouped inventory, unused copy, and usage rows', () => {
    const session = loadCacheSession([yamlProject()]);
    const cors = session.caches.find((c) => c.name === 'CORS Profiles')!;
    const html = renderCacheBrowserHtml(session, { ...htmlOpts, selectedId: cacheId(cors) });
    expect(html).toContain('Caches');
    expect(html).toContain('Local');
    expect(html).toContain('Distributed');
    expect(html).toContain('Other');
    expect(html).toContain('CORS Profiles');
    expect(html).toContain('Cron Expression Library');
    expect(html).toContain('Custom Store');
    expect(html).toContain('Open YAML');
    expect(html).toContain('Refresh');
    expect(html).toMatch(/0 uses/);
    expect(html).toContain('Cache Attribute');
    expect(html).toContain('Authz Code Store');
  });

  it('shows unused message for Custom Store', () => {
    const session = loadCacheSession([yamlProject()]);
    const custom = session.caches.find((c) => c.name === 'Custom Store')!;
    const html = renderCacheBrowserHtml(session, { ...htmlOpts, selectedId: cacheId(custom) });
    expect(html).toContain('No policies or caching filters reference this cache yet.');
  });

  it('shows empty inventory and no-match copy', () => {
    const empty: CacheSession = { caches: [], usages: [], warnings: [], projectLabel: 'x' };
    expect(renderCacheBrowserHtml(empty, htmlOpts)).toContain(
      'No caches under Libraries/Cache Manager.',
    );
    const session = loadCacheSession([yamlProject()]);
    expect(renderCacheBrowserHtml(session, { ...htmlOpts, query: 'zzz-no-such' })).toContain(
      'No caches match.',
    );
  });

  it('shows warning banner and project names when multiple projects', () => {
    const session = loadCacheSession([yamlProject(), xmlProject()]);
    const html = renderCacheBrowserHtml(session, htmlOpts);
    expect(html).toContain('2 projects');
    expect(html).toContain('yaml-project');
    expect(html).toContain('xml-project');
    expect(html).toMatch(/empty/i);
  });
});
```

- [ ] **Step 2: Implement `cachePanelHtml.ts`**

Structure:

- `escapeHtml`
- `usagesForCache(session, cache)`
- `groupedCaches(filtered)` → `{ local, distributed, other }`
- Toolbar + optional banner
- Left column: for each non-empty group, heading and buttons `data-id="${cacheId}"` showing name, `N uses`, hint, optional project name
- Right column: if no filtered caches, empty copy; else selected cache (default first filtered) details + usage buttons `data-usage="${index}"` (index into `usagesForCache` array posted to extension)
- Script: debounce 300 ms on search input → `postMessage({ type: 'search', query })`; click row → `select`; Refresh / Open YAML / usage clicks as specified; `selected` class on the active row

CSP: `default-src 'none'; style-src 'unsafe-inline' ${cspSource}; script-src 'nonce-${nonce}'`.

Include the current `query` as the search input’s `value`.

Usage row visible text: `[circuitName / ] filterName (filterType) — matchPreview` plus file basename.

- [ ] **Step 3: Tests PASS; commit** `feat(cache-browser): render master-detail caches panel`

---

### Task 8: VS Code command, tools hub, follow scope

**Files:**
- Create: `src/features/cacheBrowser/toolDescriptor.ts`
- Create: `src/features/cacheBrowser/cacheBrowserService.ts`
- Modify: `src/extension.ts` — construct `CacheBrowserService`, call `activate()`
- Modify: `package.json` — command + commandPalette `when: policyStudio.projectDetected`
- Modify: `test/unit/toolRegistrations.test.ts` — import `CACHE_BROWSER_TOOL`, add to `ALL_TOOLS`, expect `group === 'analyze'`
- Modify: `test/unit/cacheBrowser.test.ts` — tool descriptor assertions (command id, label `Caches`, order 4)

**Interfaces:**
- Consumes: `loadCacheSession`, `renderCacheBrowserHtml`, `getSharedProjectRegistryStore`, `getSharedToolsHubService`
- Produces:
  - `CACHE_BROWSER_TOOL: ToolsHubTool` — `id: 'cache-browser'`, `label: 'Caches'`, `iconId: 'database'`, `command: 'policyStudioTools.openCacheBrowser'`, `group: 'analyze'`, `order: 4`, `when: 'policyStudio.projectDetected'`, `available: true`
  - `CacheBrowserService.activate()` registers the tool and command; `onScopeChanged` reloads the session if the panel is open

**Service behaviour:**

1. `openBrowser()`: `projects = store.getProjectsInScope()`. If empty → `showWarningMessage('No Policy Studio projects in the current scope.')` and return. Else `loadAndShow(projects)`.
2. Create/reuse a single `WebviewPanel` (`viewType: 'policyStudio.cacheBrowser'`, title `Caches`, `enableScripts: true`, `retainContextWhenHidden: true`).
3. On `ready` / `search` / `select` / `refresh` / `openCache` / `openUsage` handle as:
   - `search`: store query, re-render (filter via `searchCaches` inside `renderCacheBrowserHtml`)
   - `select`: store `selectedId`, re-render
   - `refresh` and `onScopeChanged`: `loadCacheSession(getProjectsInScope())`, keep query; if selected id missing, clear selection
   - `openCache`: `openAtOffset(selected.filePath, selected.startOffset)`
   - `openUsage`: `openAtOffset(usage.filePath, usage.startOffset)`
4. `openAtOffset`: `openTextDocument` + `positionAt(offset)` + `showTextDocument` with selection, `viewColumn: Beside`
5. Follow scope: no dirty prompt (read-only)

`package.json` command entry:

```json
{
  "command": "policyStudioTools.openCacheBrowser",
  "title": "Open Cache Browser",
  "category": "Policy Studio"
}
```

Command palette `when`: `policyStudio.projectDetected`.

`src/extension.ts` add:

```typescript
import { CacheBrowserService } from './features/cacheBrowser/cacheBrowserService';
// inside activate(), after kpsEditor:
const cacheBrowser = new CacheBrowserService(context);
cacheBrowser.activate();
```

- [ ] **Step 1: Failing tool registration test** — add `CACHE_BROWSER_TOOL` to `ALL_TOOLS` and `expect(CACHE_BROWSER_TOOL.group).toBe('analyze')` before implementing the descriptor (FAIL).

- [ ] **Step 2: Implement descriptor, service, package.json, extension.ts, toolRegistrations**

Keep the service focused: no folder picker (in-scope projects only).

- [ ] **Step 3: Run** `npm test -- test/unit/cacheBrowser.test.ts test/unit/toolRegistrations.test.ts` **and** `npx tsc -p ./ --noEmit`

Expected: PASS / no type errors

- [ ] **Step 4: Commit** `feat(cache-browser): open Caches panel from command and tools sidebar`

---

## Manual check (after Task 8)

Open `test/example-repo/202602/policies/NAME_ONE/NAME_ONE_YAML` (CORS Profiles + Cron Expression Library). Command **Policy Studio: Open Cache Browser** should list both, search `600` should keep Cron Expression Library, unused CORS should show the unused copy, Open YAML should jump to the cache file.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| YAML Cache / DistributedCache / other under Cache Manager | 1–2 |
| Skip `_parent.yaml`; empty/invalid warnings | 1–2, 6 |
| XML Cache / DistributedCache same model | 3 |
| Search name/kind/type/fields; unused stay visible | 4, 6–7 |
| Usage cache/cacheToUse + known filters; Env Config; no cross-project | 5–6 |
| Ambiguous bare names unmatched | 5 |
| Master–detail panel, exact empty copy, Open YAML, jump usage | 7–8 |
| Command + Analyze tools hub + follow scope | 8 |
| No editor / no live watch / no server-settings / no sidebar view | — non-goals, not implemented |
