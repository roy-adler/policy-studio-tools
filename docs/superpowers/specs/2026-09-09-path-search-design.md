# Design: Path Search (Service URI prefixes)

Date: 2026-09-09

## Goal

Let Policy Studio developers browse and search HTTP URI prefixes defined on YAML Service listeners (`XMLFirewall` / relative-path entities), always across **every** discovered project, see which project owns each path, open the listener YAML, and optionally jump to the bound circuit.

## Decisions (locked)

1. **Approach:** Dedicated feature module `src/features/pathSearch/` plus a dedicated sidebar **WebviewView** (same product shape as Circuit Search). Do not extend Circuit Search.
2. **Catalog + search:** Empty query shows the full inventory; non-empty query filters with a 300 ms debounce.
3. **Scope:** Always `getProjectRegistry().projects` (all discovered projects). **Ignore** sidebar / `getProjectsInScope()` for this view.
4. **Format:** YAML only in v1. No XML entity-store listener scrape.
5. **Canonical path:** Always `fields.uriprefix` from file content. Filename token decoding is for method/matcher display and search only — never reconstruct `uriprefix` from the filename alone.
6. **Discovery root:** `Environment Configuration/Service/**/*.yaml` and `*.yml`. Skip `_parent.yaml` and `solpacks.yaml`. Include only entities with `type: XMLFirewall` (case-sensitive as stored; trim and compare case-insensitively for robustness) that have a non-empty `fields.uriprefix`.
7. **Row richness:** Primary label = `uriPrefix`; secondary lines = project, interface name, HTTP method / URI matcher when known, bound `filterCircuit`.
8. **Actions:** Click row → open service YAML and reveal `uriprefix` range. Secondary “Go to circuit” → existing `jumpToCircuit` / reference jump on `filterCircuit` (best-effort; start-node / circuit-view bugs are out of scope).
9. **Tools hub:** Navigate group — “Search paths” → `policyStudioTools.searchPaths` (focuses the Path Search view).
10. **No live file watch in v1:** Rebuild inventory when the view opens, on Refresh in the webview, and when the project registry changes (re-discover projects). Optional explicit refresh button in the webview footer/toolbar.

## Non-goals (v1)

- XML entity-store relative-path / XMLFirewall equivalents
- Editing paths or renaming files to match Axway filename encoding
- Fixing circuit graph / start-node detection
- Regex path matching or “does this request match this prefix” evaluation
- Honoring active / selected project scope for this inventory
- TreeView instead of WebviewView

## On-disk layout (YAML)

```
PROJECT_yaml/
  values.yaml
  Environment Configuration/
    Service/
      _parent.yaml                    ← skip (type: NetService)
      solpacks.yaml                   ← skip
      Name_One Interface/
        _parent.yaml                  ← skip (type: HTTP)
        (slash),(asterisk).yaml       ← type: XMLFirewall, uriprefix: /
        (slash)api(slash)orders,GET.yaml
        (slash)api(slash)orders,GET 1.yaml   ← collision suffix
```

Axway filename rules (key fields concatenated with `,`):

| Character | Filename token |
|-----------|----------------|
| `/` | `(slash)` |
| `\` | `(bslash)` |
| `"` | `(quote)` |
| `:` | `(colon)` |
| `<` | `(lt)` |
| `>` | `(gt)` |
| `*` | `(asterisk)` |
| `?` | `(qmark)` |
| `\|` | `(pipe)` |

Trailing ` N` before `.yaml` (space + integer) is a collision suffix and is stripped before splitting key fields.

Interface name = immediate parent directory under `Service/` (e.g. `Name_One Interface`).

## Architecture

Feature root: `src/features/pathSearch/`

| Unit | Responsibility |
|------|----------------|
| `types` | `ServicePathEntry`, search response, warnings |
| `filenameTokens` | Decode Axway filename tokens; parse key fields + collision suffix |
| `discoverServicePaths` | Walk Service trees per project; skip scaffolding; parse listeners |
| `parseServicePathYaml` | Extract type, uriprefix, filterCircuit, uriprefix range |
| `searchPaths` | Case-insensitive substring filter over path, project, interface, method, matcher, circuit |
| `pathSearchService` | Activate, command, registry change → view refresh hook |
| `pathSearchViewProvider` | Sidebar WebviewView host (or live under `toolsSidebar` if that matches Circuit Search wiring — prefer feature-owned provider registered from the service) |
| `toolDescriptor` | Tools hub Navigate entry |

Depends on `projectRegistry` (full registry) and `circuitNavigation` / existing jump helpers for circuit action. Does **not** reuse the circuit index for discovery.

### Domain model

```ts
interface ServicePathEntry {
  uriPrefix: string;
  projectId: string;
  projectDisplayName: string;
  interfaceName: string;
  httpMethod?: string;
  uriMatcher?: string;
  filterCircuit?: string;
  filePath: string;
  uriPrefixRange: { startLine: number; startCharacter: number; endLine: number; endCharacter: number };
}
```

Filename key fields after decode and suffix strip: first field often encodes path-like keys (informational); remaining fields map to matcher (`*`) and/or HTTP method (`GET`, `POST`, …) when they look like methods or `*`. Prefer:

1. If a key equals `*` (after decode) → `uriMatcher`
2. If a key matches common HTTP methods (case-insensitive) → `httpMethod`
3. Other keys ignored for display (still searchable as raw decoded basename if useful)

Canonical `uriPrefix` always from YAML `fields.uriprefix`.

## UX

View id: `policyStudio.pathSearch` (webview), under Activity Bar container `policy-studio`, placed after Circuit Search.

```
[ Search paths…                         ]

/api/orders                        GET
  PAYMENT_API_YAML · Orders Interface
  → /Policies/Orders/Create Order

/                                  *
  NAME_ONE_YAML · Name_One Interface
  → /Policies/Commons/JWT/JWT verify
```

- Empty / whitespace query → full catalog.
- No matches → “No paths match.”
- No projects / no listeners → guidance empty state.
- Footer: `N paths · M projects` (+ warning count when skipped/unreadable files).
- Click → open YAML at `uriPrefixRange`.
- Inline “Go to circuit” when `filterCircuit` is present.

Command palette: `policyStudioTools.searchPaths` focuses the view (mirror Circuit Search focus command pattern).

## Wiring

| Piece | Change |
|-------|--------|
| `package.json` | View `policyStudio.pathSearch`; commands `searchPaths` / optional `focusPathSearch`; contribute when `policyStudio.projectDetected` as appropriate |
| `extension.ts` | Activate `PathSearchService` |
| `specs/009-tools-sidebar.md` | Document Path Search view + Navigate tool |
| `specs/014-path-search.md` | Feature spec (canonical behaviour) |

## Testing

Fixtures under `test/fixtures/path-search/`:

- `yaml-project/` — Service tree with `(slash),(asterisk).yaml`, path+method file, collision-suffix file, `_parent` / `solpacks` ignored
- `two-projects/` — two YAML projects sharing the same `uriprefix` so ownership is visible in results

Unit tests:

- Token decode and collision suffix
- Discovery skip rules and XMLFirewall-only inclusion
- Parse uriprefix + filterCircuit + range
- Search substring across fields
- Multi-project: same path appears twice with distinct `projectDisplayName`
- Empty query returns full catalog

## Acceptance criteria

- [ ] Sidebar Path Search lists URI prefixes from all discovered YAML projects regardless of active scope
- [ ] Empty query shows catalog; filter narrows results
- [ ] Each row shows path, project, interface, method/matcher when known, and filterCircuit when present
- [ ] Click opens the service YAML at `uriprefix`
- [ ] “Go to circuit” invokes existing circuit jump when `filterCircuit` is set
- [ ] Fixtures cover `(slash)`, `(asterisk)`, comma key fields, and numeric collision suffix
- [ ] Unit tests cover discovery, parse, search, and multi-project ownership

## Downstream

- Update `009-tools-sidebar.md`: fourth sidebar view + Navigate tool registration.
- No change to `000` scope semantics; this feature intentionally bypasses scope for inventory.
- Circuit jump failures remain owned by `003` / circuit navigation; document as known limitation.
