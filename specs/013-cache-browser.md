# Feature: Cache Browser

## Goal

Show every cache in a Policy Studio project, let the developer search that inventory, and jump to the policies and caching filters that use each cache. YAML is the primary format; XML remains supported as legacy. This is a read-only view, not a cache editor.

## User Story

As a Policy Studio developer, I want to browse local and distributed caches (and any other entities under Cache Manager), search them, and see where they are used, so that I can understand caching without opening every library and policy file.

## Inputs

- **Project scope:** `getProjectsInScope()` from `000-multi-project-monorepo.md` for the default inventory. The panel also offers an **All projects** toggle that loads caches from every discovered Policy Studio project in the registry (`getProjectRegistry().projects`), independent of the sidebar scope picker.
- **YAML caches (primary):** `Libraries/Cache Manager/**/*.yaml` and `*.yml` inside a detected YAML project. Skip `_parent.yaml`.
- **XML caches (legacy):** entity-store entities with `type="Cache"` or `type="DistributedCache"`.
- **Usage scan:** all `.yaml`/`.yml`/`.xml` under the same project roots, excluding cache inventory files (and `_parent.yaml` under Cache Manager). Includes Policies, APIs, Environment Configuration, and other library entities that may hold a `cache:` field (for example an OAuth store).
- VS Code command: `policyStudioTools.openCacheBrowser`.
- Tools sidebar registration via `ToolsHubService.registerTool` (`009-tools-sidebar.md`).

## Outputs

- Webview panel **Caches** (master–detail):
  - **Toolbar:** project label, **All projects** toggle, search box, Refresh, Open YAML (selected cache file).
  - **Left:** caches grouped by kind (Local, Distributed, Other). Each row shows name, usage count, and a short hint (`eternal` or TTL when present). Multi-project rows include `projectDisplayName`.
  - **Right:** selected cache settings (scalar fields) and usage list.
  - **Warnings:** skipped empty/invalid **cache inventory** files; unreadable policy files during usage scan. Do **not** warn about invalid YAML in policy/usage files when the line-oriented usage scan still runs.
- Click usage → open that file and reveal the match range.
- Empty inventory and empty search states as described below.

## Behaviour

### Discovery

1. For each project in scope:
   - **YAML:** walk `Libraries/Cache Manager/`. Include every `.yaml`/`.yml` file except `_parent.yaml`. Empty or unreadable files → warning, skip.
   - **XML:** parse entity-store XML; include entities whose type is `Cache` or `DistributedCache` (case-insensitive).
2. Parse each included file/entity into the shared cache model (YAML first, XML equivalent).
3. **Kind:** `Cache` → local, `DistributedCache` → distributed, any other YAML entity still under Cache Manager → other. Preserve the raw entity type.
4. **Name:** `fields.name` if present, else file basename without extension.
5. **YamlPK (YAML):** `/` + project-relative path without extension, e.g. `/Libraries/Cache Manager/CORS Profiles`.
6. **Other kinds in XML:** not discovered in v1 (no Cache Manager folder). XML inventory is Cache + DistributedCache only.

### Usage

Scan project YAML/XML in the same projects, excluding files already in the cache inventory. Record a usage when:

1. **Cache field:** any entity/filter has a scalar field named `cache` or `cacheToUse` whose value resolves to a known cache in that project, or
2. **Known caching filter:** filter type is one of (case-insensitive, optional `Filter` suffix): `CacheAttribute`, `IsCached`, `RemoveCachedAttribute`. For these, inspect all scalar fields for a resolvable cache reference.

**Resolve** a field value against caches in the same project only:

1. Exact YamlPK
2. Relative path last segment matching a cache name or path segment (`./CORS Profiles`)
3. Bare name if it uniquely matches one cache’s `name`

Ambiguous bare names do not match. Do not match across projects.

Usage kind is `cache-field` or `caching-filter`. Unused caches stay in the inventory with count `0`.

### Search

- Case-insensitive substring over name, kind (`local` / `distributed` / `other`), entity type, and scalar field keys/values.
- Empty or whitespace query shows the full inventory.
- Debounce 300 ms in the webview.
- Search does not match usage circuit/filter text.

### Panel

- Open when `policyStudio.projectDetected` is true (command + Tools → Analyze → Caches).
- Selecting a list row fills the right pane.
- **Open YAML** opens the selected cache file at its recorded range (XML projects open the entity-store file at the entity range).
- Clicking a usage row opens that policy file at the match.
- Refresh rebuilds discovery, parse, and usage from disk. No live file watcher in v1.
- Follow active project: when inventory scope is **current scope**, rebuild the session for the newly selected scope. When **All projects** is enabled, scope changes do not shrink the inventory.

### Empty and error states

- No caches → panel opens with “No caches under Libraries/Cache Manager.”
- Search with no hits → “No caches match.”
- Selected unused cache → “No policies or caching filters reference this cache yet.”
- No project detected → do not open the panel; show a clear error.
- Invalid/empty cache file or unreadable policy file → warning banner; continue with the rest.

## Edge cases

- **`_parent.yaml`:** never listed.
- **Empty cache file:** warning; skip.
- **Invalid YAML/XML cache file:** warning; skip; continue.
- **Invalid policy during usage scan:** warning; skip that file; keep other usages.
- **Duplicate names in one project:** two inventory rows; bare-name usage matches neither; YamlPK/relative path can still match.
- **`fields.name` differs from filename:** display name from fields; matching uses both name and YamlPK.
- **Nested non-scalar fields:** omitted from settings and search.
- **XML project with no matching entities:** empty inventory (valid).
- **Multiple projects in scope:** show all in-scope caches; label with project name.
- **Concurrent external edits:** Refresh required.

## Acceptance Criteria

- [ ] Command `policyStudioTools.openCacheBrowser` opens the Caches panel for projects in scope.
- [ ] Tools sidebar Analyze group includes Caches when a project is detected.
- [ ] YAML `type: Cache` and `type: DistributedCache` under `Libraries/Cache Manager/` appear as local and distributed.
- [ ] Other YAML entities in that folder (except `_parent.yaml`) appear as other.
- [ ] Search filters the left list; unused caches remain with usage count 0.
- [ ] Usage includes `cache` / `cacheToUse` refs and known caching filters; click jumps to the match.
- [ ] Ambiguous bare cache names are not matched.
- [ ] XML `Cache` / `DistributedCache` entities produce the same domain model.
- [ ] Empty/invalid files produce warnings and do not crash the session.
- [ ] Unit tests cover discovery, parse (YAML + XML), search, and usage using fixtures under `test/fixtures/cache-browser/`.

## Non-goals

- Creating, editing, or deleting caches
- Global Server Settings cache (peer discovery / replicator)
- META-INF type catalog browser
- Full-text grep for cache names
- Live file watching
- Embedding this UI in the Activity Bar sidebar

## Notes

- Design discussion: `docs/superpowers/specs/2026-09-03-cache-browser-design.md`
- Pattern reference: `specs/012-kps-editor.md` (panel + tools hub), `specs/002-circuit-search.md` (do not extend)
- Manual demo files: `test/example-repo/202602/policies/NAME_ONE/NAME_ONE_YAML/Libraries/Cache Manager/`
