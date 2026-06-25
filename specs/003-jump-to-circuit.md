# Feature: Jump to Circuit

## Goal

Provide reliable navigation from a circuit reference to its definition anywhere in the Policy Studio project. This feature establishes a shared navigation service that other features (search, visual graph, editor links, documentation) can reuse.

## User Story

As a Policy Studio developer, I want to jump from a circuit reference to the circuit’s definition in one action, so that I can follow execution flow without manually searching policy files.

## Inputs

- A detected Policy Studio workspace (see `001-project-detection.md`).
- **Circuit reference** — a circuit name or identifier string, obtained from:
  - Circuit search results (`002-circuit-search.md`)
  - Future editor code lens, document link, or hover action on a reference in policy XML/YAML
  - Visual circuit graph node edges (`008-visual-circuit-graph.md`)
  - Programmatic call from other extension features via the shared navigation service API
- Optional **source context** — file URI, position, and referring filter name (for logging and disambiguation hints).
- Project circuit index (shared with search; maps circuit name → zero or more definition locations).

## Outputs

- **Success:** Active editor opens the policy file containing the circuit definition and reveals the circuit’s root element or named range.
- **Multiple matches:** Quick pick listing each candidate with file path, circuit name, and optional folder hint; user selection opens the chosen definition.
- **No match:** Non-blocking warning notification (e.g. “Circuit ‘X’ not found in this project”) with optional action to run circuit search pre-filled with the name.
- **Navigation service API** (internal module, not necessarily public extension API):
  - `resolveCircuitDefinitions(projectRoot, circuitName): CircuitDefinition[]`
  - `jumpToCircuit(circuitName, options?): Promise<JumpResult>`
  - `JumpResult` discriminated union: `opened`, `picked`, `notFound`, `cancelled`, `error`

## Behaviour

- Implement as `src/features/circuitNavigation/` (or equivalent) separate from UI commands so other features depend on the service, not on VS Code command handlers directly.
- On `jumpToCircuit`:
  1. Ensure project index is available (build lazily or reuse cache from `002-circuit-search.md`).
  2. Resolve `circuitName` to definition locations using normalized name matching (trim whitespace; case-insensitive compare unless Policy Studio semantics require exact match — document chosen rule in implementation).
  3. If exactly one definition: open file at circuit definition range.
  4. If multiple definitions: show quick pick; on selection, open that definition.
  5. If zero definitions: show warning; do not open arbitrary files.
- Expose a VS Code command `policyStudioTools.jumpToCircuit` accepting an optional circuit name argument (for palette and keybinding); when invoked without arguments, use word at cursor or selection in the active editor if it looks like a circuit reference.
- From search results: primary click or explicit “Go to definition” action calls `jumpToCircuit` with the referenced circuit name.
- Preserve navigation history where possible (use `vscode.window.showTextDocument` with standard editor behaviour so Go Back works).
- Index invalidation follows the same file-watcher rules as circuit search.

## Edge Cases

- **Empty or whitespace circuit name:** Show validation error; no file navigation.
- **Circuit name with special characters or namespaces:** Apply consistent normalization; document if fully qualified names differ from short names.
- **Reference to external or library circuit not in workspace:** Report not found; do not navigate outside workspace unless explicitly configured (non-goal for v1).
- **Duplicate definitions:** Never silently pick the first match; always show picker when count > 1.
- **Definition in unsaved buffer:** Prefer on-disk index; optionally merge open editor buffers in a later iteration.
- **YAML vs XML projects:** Resolve definitions in both layouts using the same service interface.
- **User cancels quick pick:** Return `cancelled`; no editor change.
- **Target file deleted after index build:** Show error with file path; suggest re-index or refresh.
- **Jump from non-policy file:** Still attempt resolution if circuit name is valid.

## Acceptance Criteria

- [ ] Shared navigation module exports `resolveCircuitDefinitions` and `jumpToCircuit` usable by other features without duplicating lookup logic.
- [ ] Command `policyStudioTools.jumpToCircuit` is registered and active only when a Policy Studio project is detected.
- [ ] Jumping to a uniquely named circuit opens the correct file and reveals the circuit definition.
- [ ] When multiple circuits share the same name, a quick pick is shown with distinguishable entries (at minimum file path per entry).
- [ ] When no circuit is found, a clear warning is displayed and no editor tab is opened spuriously.
- [ ] Circuit search integration: invoking jump from a reference-type search result navigates to the target circuit definition.
- [ ] Unit tests cover single match, multiple matches, not found, empty name, and name normalization.
- [ ] Integration test (or documented manual test) verifies quick pick flow and editor reveal range.

### Non-goals (v1)

- Renaming circuits or updating references (refactor/rename).
- Jumping to filter definitions by filter name only (unless filter name uniquely identifies a circuit entry point — out of scope unless specified elsewhere).
- Cross-workspace navigation to dependent projects.

### Test fixture requirements

- `test/fixtures/jump-to-circuit/unique/` — one circuit `PaymentService` in a known file.
- `test/fixtures/jump-to-circuit/duplicates/` — two definitions of `SharedAuth` in different paths.
- `test/fixtures/jump-to-circuit/missing/` — policy file referencing `NonExistentCircuit` with no definition present.
- `test/fixtures/jump-to-circuit/references/` — chain of references (A → B → C) for manual integration testing.

## Future Ideas

- Document links and code lens on circuit references in policy XML/YAML editors.
- Peek definition (inline peek view) in addition to full jump.
- Jump to filter within a circuit.
- Show preview snippet in quick pick rows.
- Breadcrumb or sidebar “call hierarchy” for incoming references to a circuit.
- Rename symbol workflow updating all references.
