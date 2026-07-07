# Feature: Policy Diff

## Goal

Compare two versions of a Policy Studio project semantically — circuits, filters, scripts, routing paths, backends, and references — rather than as raw YAML/XML text. Reduce noise from formatting-only changes and give developers a meaningful change summary for reviews and troubleshooting.

## User Story

As a Policy Studio developer, I want to see what actually changed between two project snapshots (files, folders, or Git revisions), so that I can review policy changes without wading through irrelevant formatting diffs.

## Inputs

- Optional anchor project from current scope (`000-multi-project-monorepo.md`) when comparing paths relative to a monorepo layout.
- **Left and right comparison sources** (generic v1 interface; Git integration deferred):
  - Two directories on disk (e.g. exported project folders)
  - Two arbitrary sets of policy files selected via file picker
  - Later: Git tree-ish pairs (`HEAD` vs working tree, commit vs commit) — same semantic engine, different source adapters
- Policy files from YAML (primary) and XML (legacy) project layouts.
- Optional scope filters (future-friendly): circuits only, routing only, scripts only.

## Outputs

- **Semantic diff report** structured as:
  - **Circuits:** added, removed, renamed (inferred), modified
  - **Filters (within modified circuits):** added, removed, reordered, modified
  - **Scripts:** changed script bodies with before/after excerpt or unified diff
  - **Message bodies:** changed static request/response body content
  - **Routing paths:** changed path templates with old → new values
  - **Backend URLs:** changed host/path/port values
  - **Circuit references:** added, removed, or changed call targets
- **Presentation** (implementation choice):
  - Tree view or webview listing changes grouped by category and circuit name
  - Clicking an item opens a diff view (VS Code diff editor) at the relevant file, or an inline before/after panel for extracted fields
- **Summary header:** counts per change type; files only in left or right; unparseable files listed separately.
- **Equivalence note:** Explicitly states that formatting-only XML changes produce no semantic change entries.

## Behaviour

- Parse policies on both sides into a **canonical semantic model**:
  - Normalize insignificant whitespace, key/attribute order, and indentation (YAML and XML) before comparison.
  - Extract comparable fields: circuit identity, filter sequence and configuration, embedded scripts, routing paths, backend URLs, referenced circuit names, relevant message attributes.
- Match entities across sides:
  - Primary key: circuit name + file relative path (configurable strategy when files move)
  - Rename detection (heuristic v1): same file path and high filter similarity with different circuit name → suggest rename rather than remove+add
- Classify changes:
  - **Added / removed:** entity present on one side only
  - **Modified:** same identity with differing semantic fields
  - Ignore pure formatting differences in XML serialization
- For modified scripts and bodies, show textual diff with context lines (not entire file diff unless needed).
- Unparseable files on either side: list in “could not compare” section; do not fail entire diff.
- Command: `policyStudioTools.comparePolicies` prompts for left and right sources (folder pickers in v1); picker may offer discovered project roots from the registry as shortcuts.
- Design **source adapter interface** so Git integration plugs in later without rewriting the semantic diff engine:
  - `loadPolicySnapshot(source: DiffSource): PolicySnapshot`
  - `DiffSource = { kind: 'directory', path } | { kind: 'fileSet', files } | { kind: 'git', ... }` (git kind specified but not implemented in v1)

## Edge Cases

- **Identical projects:** Empty change list with confirmation message.
- **Left or right empty:** All entities reported as added or removed.
- **File moved but content unchanged:** Prefer rename/move detection when relative path changes but circuit fingerprint matches; otherwise show as remove + add.
- **Duplicate circuit names on one side:** Disambiguate by file path in report; flag ambiguity in summary.
- **YAML vs XML comparison:** Compare semantic model only; format difference between sides does not appear as content change if semantics match (important for reviewing an XML → YAML project migration).
- **Large projects:** Stream or batch parse; show progress; avoid building full text diff for unchanged files.
- **Scripts differing only by line endings:** Normalize CRLF/LF before script compare.
- **Binary or non-policy files:** Ignored unless explicitly included by source adapter.
- **Partial project export:** Compare only overlapping files; note files exclusive to each side.

## Acceptance Criteria

- [ ] Command `policyStudioTools.comparePolicies` compares two user-selected directories and produces a semantic change report.
- [ ] Adding a circuit appears only under “added circuits”, not as a raw XML file diff noise entry.
- [ ] Removing a filter appears under the parent circuit’s filter changes.
- [ ] Changing a script body produces a “changed script” entry with identifiable before/after content.
- [ ] Changing a routing path produces an entry with old and new path template values.
- [ ] Changing a backend URL produces an entry with old and new URL values.
- [ ] Reformatting a policy file (YAML or XML) without semantic change produces zero circuit/filter change entries (formatting-only fixture).
- [ ] Unparseable policy file on one side is listed in warnings; other files still compared.
- [ ] Summary counts match the detailed change list.
- [ ] Unit tests cover added/removed/modified circuits, script diff, path change, URL change, and formatting-only XML.
- [ ] Source adapter interface is defined and directory-based adapter is implemented.

### Non-goals (v1)

- Git UI integration (diff against `HEAD`, branch compare, PR comments).
- Three-way merge or conflict resolution.
- Deploying or exporting policies.
- Diffing non-policy configuration (Keystore, env vars) unless later specified.

### Test fixture requirements

- `test/fixtures/policy-diff/baseline/` — small consistent project snapshot.
- `test/fixtures/policy-diff/changed-circuit/` — same layout with one modified filter script.
- `test/fixtures/policy-diff/added-removed/` — one circuit added, one removed vs baseline.
- `test/fixtures/policy-diff/routing-url/` — path template and backend URL changes only.
- `test/fixtures/policy-diff/formatting-only/` — semantically identical YAML (and XML) with different indentation/line breaks.
- `test/fixtures/policy-diff/invalid/` — includes one malformed file alongside valid changes.

## Future Ideas

- Git adapters: working tree vs `HEAD`, commit range, staged vs unstaged.
- Side-by-side circuit graph diff (`008-visual-circuit-graph.md`).
- Export diff report to Markdown for PR descriptions.
- CI check failing on unintended routing or URL changes.
- Rename refactoring confirmation UI.
