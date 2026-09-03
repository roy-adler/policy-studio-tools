# Design: Cache Browser

Date: 2026-09-03

## Goal

Let Policy Studio developers see every cache in a project (local, distributed, and anything else under Cache Manager), search that inventory, and jump to the policies and caching filters that use each cache — without a cache editor.

## Decisions (locked)

1. **Approach:** Dedicated feature module `src/features/cacheBrowser/` plus a dedicated webview panel. Do not extend Circuit Search.
2. **Layout:** Master–detail. Left: caches grouped by kind. Right: read-only settings + usage list.
3. **Kinds:** `Cache` → local, `DistributedCache` → distributed, any other entity under `Libraries/Cache Manager/` → other (raw type still shown).
4. **YAML discovery:** All `*.yaml` / `*.yml` under `Libraries/Cache Manager/`, except `_parent.yaml`. Empty or unreadable files are warnings, not inventory rows.
5. **XML discovery (legacy):** Entity-store entities with type `Cache` or `DistributedCache`. “Other” kinds are YAML-folder based in v1 (XML has no Cache Manager folder).
6. **Usage:** Direct cache references (`cache` / `cacheToUse` field values that resolve to a known cache) plus known caching filter types. Not a full-text grep.
7. **Search:** Case-insensitive substring over name, kind, entity type, and field keys/values. Empty query shows all. Search does not match usage text.
8. **Read-only:** Open YAML/XML and jump to usage. No create/edit/delete of caches in v1.
9. **Scope:** `getProjectsInScope()`. Follow the active project while the panel is open (rebuild session). Multi-project scope labels each row with the project name.
10. **No live file watch:** Refresh rebuilds from disk.

## Non-goals (v1)

- Cache create / edit / delete
- Global Server Settings cache (peer discovery / replicator)
- META-INF entity-type catalog browser
- Full-text grep for cache names
- Sidebar view (Circuit Search stays the sidebar search UI)

## On-disk layout (YAML)

```
PROJECT_yaml/
  values.yaml
  Libraries/
    Cache Manager/
      _parent.yaml                 ← skipped
      CORS Profiles.yaml           ← type: Cache (local)
      Cron Expression Library.yaml ← type: DistributedCache
      Some Other.yaml              ← any other type → kind other
  Policies/                        ← scanned for usage
```

YamlPK for a cache file is the project-relative path without extension, rooted at `/`, e.g. `/Libraries/Cache Manager/CORS Profiles`.

## Architecture

Feature root: `src/features/cacheBrowser/`

| Unit | Responsibility |
|------|----------------|
| `types` | `ParsedCache`, `CacheKind`, `CacheUsage`, session/warnings |
| `discoverCaches` | Find YAML files under Cache Manager; find XML Cache / DistributedCache entities |
| `parseCacheYaml` / `parseCacheXml` | Same domain model from both formats |
| `findCacheUsages` | Scan project YAML/XML (except cache inventory files) for cache fields and known caching filters |
| `searchCaches` | Filter inventory by query |
| `loadCacheSession` | Discover + parse + usage for projects in scope |
| `cacheBrowserService` | Command, webview host, refresh, follow active project, open/jump |
| `cachePanelHtml` | Master–detail webview |
| `toolDescriptor` | Tools sidebar, Analyze group |

Depends on `projectRegistry` (`getProjectsInScope()`, active project). Does not reuse the circuit index.

### Domain model

**Cache**

- `name` — `fields.name`, else file basename without extension
- `kind` — `local` \| `distributed` \| `other`
- `entityType` — raw YAML/XML type
- `fields` — scalar field map (string form) for display and search; nested maps/lists omitted
- `yamlPk` — `/Libraries/Cache Manager/…` from relative path (YAML); XML uses entity path/name when available
- `filePath`, `startOffset`, `endOffset`, `projectId`, `projectDisplayName`

**Usage**

- `usageKind` — `cache-field` \| `caching-filter`
- `cacheName` / cache identity (yamlPk or unique name)
- `filePath`, `circuitName?`, `filterName?`, `filterType?`, `fieldName?`, `matchPreview`, `startOffset`, project ids

### Kind rules

| Entity type | Kind |
|-------------|------|
| `Cache` | local |
| `DistributedCache` | distributed |
| anything else in Cache Manager (YAML) | other |

Type match is case-insensitive.

### Usage rules

**Cache field (any entity or filter):** a scalar field named `cache` or `cacheToUse` whose value resolves to a known cache in that project.

**Known caching filters** (case-insensitive, optional `Filter` suffix):

- `CacheAttribute`
- `IsCached`
- `RemoveCachedAttribute`

For those filter types, inspect all scalar fields for a resolvable cache reference (not only `cache` / `cacheToUse`).

**Resolution order** (same project only):

1. Exact YamlPK (`/Libraries/Cache Manager/CORS Profiles`)
2. Relative path whose last segment equals a cache name or yamlPk segment (`./CORS Profiles`)
3. Bare name if it uniquely matches one cache’s `name` in that project

Ambiguous bare names do not match. Do not guess across projects.

### Search

Case-insensitive substring on: name, kind label (`local` / `distributed` / `other`), entity type, every field key and scalar value. Unused caches remain in the list with usage count `0`.

## UI & behaviour

- **Command:** `policyStudioTools.openCacheBrowser` (label: Open cache browser).
- **Tools hub:** Analyze; `when: policyStudio.projectDetected`.
- **Panel title:** Caches.
- **Toolbar:** project name (or “N projects”), search box, Refresh, Open YAML (opens the selected cache file at its range).
- **Left list:** groups Local / Distributed / Other (omit empty groups). Each row: name, usage count, short hint (`eternal` or `TTL Ns` when those fields exist). Multi-project: show `projectDisplayName`.
- **Right pane:** name, kind, entity type, path; settings table of scalar fields; usage list (circuit/filter/file preview). Click usage → open that file at the match. Empty usage: “No policies or caching filters reference this cache yet.”
- **Empty inventory:** panel still opens with “No caches under Libraries/Cache Manager.”
- **No search hits:** “No caches match.”
- **Warnings:** banner for skipped empty/invalid files and unreadable policy files during usage scan.
- **No project:** command does not open the panel; show the same class of error as other tools.
- **Follow active project:** rebuild session for the new project (read-only; no discard prompt).

## Data flow

1. Resolve projects via `getProjectsInScope()`.
2. Discover cache files/entities per project.
3. Parse into `ParsedCache[]`; collect warnings.
4. Scan project YAML/XML in those projects (except files already in the cache inventory); attach `CacheUsage[]`.
5. Webview shows the inventory; search filters the left list in memory (debounce 300 ms).
6. Refresh or active-project change repeats 1–5.

## Edge cases

- `_parent.yaml` — never an inventory row.
- Empty cache file — warning; skip.
- Invalid YAML/XML cache file — warning; skip; continue.
- Invalid policy file during usage scan — warning; skip that file; keep other usages.
- Duplicate cache names in one project — two rows; bare-name usage does not match either; YamlPK / relative path still can.
- Cache `fields.name` differs from filename — display `fields.name`; match both name and yamlPk path.
- Nested non-scalar cache fields — omitted from the settings table and search.
- XML project with no Cache / DistributedCache entities — empty inventory (valid).
- Concurrent external edits — no live watch; Refresh picks them up.

## Testing

Fixture layout:

```
test/fixtures/cache-browser/
  yaml-project/
    values.yaml
    Libraries/Cache Manager/_parent.yaml
    Libraries/Cache Manager/CORS Profiles.yaml          # Cache, eternal
    Libraries/Cache Manager/Cron Expression Library.yaml # DistributedCache
    Libraries/Cache Manager/Custom Store.yaml            # other type
    Libraries/Cache Manager/Empty.yaml                   # empty → warning
    Policies/UsesCors.yaml                               # cache: YamlPK + CacheAttribute
    Environment Configuration/OAuth Store.yaml           # cache: field on a non-filter entity
  xml-project/
    PrimaryStore.xml                                     # Cache + DistributedCache + usage
```

Use `test/example-repo/202602/policies/NAME_ONE/` for manual demos (CORS Profiles + Cron Expression Library).

Unit tests (write first): discover/skip parent/empty; kind classification; YAML + XML parse to the same model; search; usage YamlPK / unique name / known filters; ambiguous name non-match; invalid file isolation.

## Acceptance

- Command opens a master–detail Caches panel for projects in scope
- Local, distributed, and other YAML Cache Manager entities appear
- Search filters the list; unused caches stay visible
- Usage lists cache-field refs and known caching filters; click jumps to the file
- XML Cache / DistributedCache entities produce the same model
- Tools hub registration under Analyze
- Spec in `/specs` + fixtures + unit tests

## Related

- Feature spec: `specs/013-cache-browser.md`
- Tools sidebar: `specs/009-tools-sidebar.md`
- Project scope: `specs/000-multi-project-monorepo.md`
- Circuit search (do not extend): `specs/002-circuit-search.md`
