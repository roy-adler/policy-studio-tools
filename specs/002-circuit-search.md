# Feature: Circuit Search

## Goal

Enable developers to find Policy Studio circuits and related content across an entire project quickly, without manually opening and reading every policy file. Search must remain responsive on large projects and degrade gracefully when policy files (YAML or XML) are malformed. YAML is the primary Policy Studio format; XML is supported as legacy (see `AGENTS.md`).

## User Story

As a Policy Studio developer, I want to search all circuits in my project by name, filter, attribute, policy content, script, or referenced circuit, so that I can locate relevant configuration and understand where specific logic is used.

## Inputs

- One or more discovered Policy Studio projects and the current **project scope** (see `000-multi-project-monorepo.md`).
- Project root path(s) from `getProjectsInScope()` — not assumed to equal the workspace folder root.
- Policy Studio project layout:
  - **YAML project (primary):** policy definitions under `Policies/`, `APIs/`, and related directories alongside `values.yaml`.
  - **XML project (legacy):** policy entities under directories referenced by `PrimaryStore.xml` and related entity store files.
- User search query string (free text).
- Optional search scope filters (future-friendly; initial implementation may expose all scopes by default):
  - Circuit name
  - Filter name
  - Attribute name
  - Policy content (YAML or XML)
  - Script content
  - Referenced circuit name
- VS Code command: `policyStudioTools.searchCircuits` (exact command id may be adjusted during implementation; spec assumes a dedicated command and command-palette entry).

## Outputs

- A searchable results view (VS Code tree view, webview panel, or quick pick with detail rows — implementation choice) containing zero or more **search result items**, each with:
  - **Project** — `projectDisplayName` (required when scope includes multiple projects).
  - **File path** — workspace-relative path to the policy file containing the match.
  - **Circuit name** — resolved circuit identifier or display name.
  - **Filter name** — present when the match is within or attributable to a specific filter; omitted or marked as N/A when match is at circuit level only.
  - **Match preview** — a short excerpt (typically one to three lines) showing the matched text with contextual surrounding content.
  - **Match kind** — which scope produced the hit (circuit name, filter name, attribute, XML content, script, referenced circuit).
  - **Jump target** — file URI and position or range for navigation (consumed by `003-jump-to-circuit.md` and editor integration).
- Progress indication while indexing or searching large projects.
- User-visible summary: total matches, files scanned, files skipped (invalid XML), and search duration.
- Empty-state message when no matches are found.
- Error or warning message when the project cannot be scanned (e.g. not a Policy Studio project).

## Behaviour

- Activate only when `policyStudio.projectDetected` is true.
- On command invocation, prompt the user for a search query (or focus an input in a dedicated search view if one exists).
- Resolve target projects via `getProjectsInScope()`; search each project index and merge results.
- Build or refresh a **per-project circuit index** that maps:
  - Circuit name → definition location(s)
  - File path → parsed circuit/filter structure (best effort)
  - Extracted filter names, attribute references, script bodies, and circuit reference targets
- Execute search against the index and raw file content where index granularity is insufficient (e.g. arbitrary XML substring).
- Return results ranked by relevance:
  1. Exact circuit name match
  2. Exact filter name match
  3. Prefix or word-boundary matches
  4. Substring matches in scripts, XML, and attributes
- Debounce or cancel in-flight searches when the user changes the query rapidly.
- For large projects:
  - Scan files incrementally; do not block the extension host for long periods.
  - Cap preview excerpt length and total results returned per query (configurable threshold with “show more” or stricter query guidance).
  - Reuse cached index across searches until project files change (file watcher invalidates cache).
- For invalid XML:
  - Skip structured parsing for that file; optionally fall back to plain-text search within the file.
  - Record the file in a skipped/invalid list surfaced once per search (not once per result).
  - Continue scanning remaining files.
- Selecting a result opens the policy file and reveals the match range in the editor.
- Selecting a result that references another circuit should expose an action to jump to the referenced circuit (delegates to `003-jump-to-circuit.md`).

## Edge Cases

- **Empty query:** Show guidance; do not scan the full project until the user enters a non-empty query or confirms a “search all” action.
- **Whitespace-only query:** Treat as empty.
- **Case sensitivity:** Default to case-insensitive search; document if a case-sensitive option is added later.
- **Special characters and regex:** Treat the query as literal text unless the user explicitly enables regex mode (non-goal for v1; document as future idea).
- **Duplicate circuit names:** Return one result row per match location; include file path to disambiguate.
- **Circuit defined across multiple files or inherited definitions:** Return all known definition locations; label ambiguous names clearly.
- **Very large single policy file:** Stream or chunk reads; avoid loading entire multi-megabyte files into memory at once.
- **Binary or non-policy files in project tree:** Ignore by extension and known Policy Studio directory conventions.
- **Multiple projects in monorepo:** Scope follows `000-multi-project-monorepo.md`; default `activeProject` when editor is inside a project, otherwise user-selected scope; every result row includes project name when more than one project is in scope.
- **File changed on disk during search:** Use snapshot at search start; optionally note that results may be stale.
- **XML-based projects (legacy):** Apply equivalent extraction rules for XML policy representations; results are identical to YAML projects with the same semantics.
- **No circuits found in project:** Return empty results with a clear message, not an error.

## Acceptance Criteria

- [ ] Command `policyStudioTools.searchCircuits` is registered and visible in the command palette only when a Policy Studio project is detected.
- [ ] Searching by exact circuit name returns the correct file path and circuit name in results.
- [ ] Searching by filter name returns results with the matching filter name populated.
- [ ] Searching by attribute name finds filters or policies that reference that attribute.
- [ ] Searching by substring in policy XML content returns a match preview containing the query.
- [ ] Searching by substring in embedded script content returns a match preview from the script body.
- [ ] Searching by referenced circuit name finds filters or policies that call that circuit.
- [ ] Each result row includes file path, circuit name, filter name (when applicable), and match preview.
- [ ] Selecting a result opens the correct file and highlights the match range.
- [ ] Invalid XML in one file does not abort the entire search; remaining files are still scanned.
- [ ] Invalid XML files are reported in the search summary (count or list).
- [ ] Search completes within an acceptable time on a large fixture project (target: under 5 seconds for indexed re-search on a fixture simulating 500+ policy files; initial index build may take longer with progress UI).
- [ ] Unit tests cover index building, each search scope, and invalid XML fallback using dedicated fixtures.
- [ ] Integration test covers command invocation and result navigation in a VS Code test host (or documented manual test plan if harness not yet available).

### Non-goals (v1)

- Full-text search across non-policy project files (README, build scripts, etc.).
- Replacing VS Code’s built-in workspace text search.
- Editing policies from the search view.
- Semantic or natural-language search.

### Test fixture requirements

- `test/fixtures/circuit-search/minimal/` — small XML project with 2–3 circuits, known filter names, one script filter, one circuit reference.
- `test/fixtures/circuit-search/ambiguous-names/` — two circuits with the same name in different files.
- `test/fixtures/circuit-search/invalid-xml/` — mix of valid policy files and files with malformed XML; valid files must still be searchable.
- `test/fixtures/circuit-search/large/` — generated or copied fixture with many policy files (500+) for performance smoke tests (may be generated at test time to avoid bloating the repo).
- `test/fixtures/circuit-search/yaml-project/` — YAML-based project with equivalent searchable content (YAML is the primary format; this fixture is required, not optional).

## Future Ideas

- Regex and case-sensitive search toggles.
- Scope checkboxes (search only scripts, only circuit names, etc.).
- Search history and pinned queries.
- Export search results to CSV or Markdown.
- Scope persisted per workspace with quick-pick to switch between active / all / selected projects (`000-multi-project-monorepo.md`).
- Integration with `006-policy-diff.md` to jump to changed circuits matching a query.
