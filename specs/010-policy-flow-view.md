# Feature: Policy Flow View

## Goal

Render a single policy (circuit) as a visual flow graph inside VS Code, matching the mental model developers have from the Policy Studio canvas: each filter is a node, green arrows show the success path, red arrows show the failure path. Developers can understand and review policy logic without opening Policy Studio.

## User Story

As a Policy Studio developer, I want to see a policy's filters and their success/failure connections as a graph, so that I can follow the execution flow, spot dead ends and unreachable filters, and review logic changes without leaving my editor.

## Relationship to Other Specs

- `008-visual-circuit-graph.md` shows the **inter-circuit** graph (which circuits reference which). This spec shows the **intra-circuit** flow (filters inside one circuit). The two views link to each other but are separate features.
- Circuit resolution and navigation reuse the shared service from `003-jump-to-circuit.md`.
- Project discovery follows `000-multi-project-monorepo.md` via `getProjectForFile()` / `getProjectsInScope()`.

## Inputs

- A **target circuit**, identified by circuit name plus owning `projectId`, obtained from:
  - Command `policyStudioTools.showPolicyFlow` (from palette: quick pick of circuits in scope; with the cursor inside a circuit definition in the active editor: that circuit)
  - Circuit search results (`002-circuit-search.md`) — "Show flow" action
  - Node action in the visual circuit graph (`008-visual-circuit-graph.md`)
- **Per-circuit filter model** extracted from policy configuration (XML or YAML):
  - Filters: identifier, display name, filter type
  - **Start filter** of the circuit
  - **Success path** links (filter → next filter on success)
  - **Failure path** links (filter → next filter on failure)
  - Circuit references inside filters (e.g. Policy Shortcut–style filters) with target circuit name
- User interactions: zoom, pan, fit-to-screen, node selection, node click, layout re-run.

## Outputs

- A **Policy Flow panel** (webview) showing a directed graph:
  - **Nodes:** one per filter — display name, filter type (icon or badge when the type is known; generic node otherwise)
  - **Green edges:** success path connections
  - **Red edges:** failure path connections
  - **Start filter** visually marked (e.g. badge or distinct border)
  - **Terminal filters** (no outgoing success edge) visibly identifiable as flow end points
- **Diagnostics annotations in the graph:**
  - **Unreachable filters** — defined in the circuit but not reachable from the start filter — styled as detached/greyed with a warning badge
  - **Dangling links** — success/failure link pointing to a filter id that does not exist — dashed edge to a synthetic "missing" node
  - **No start filter** — banner in the panel explaining the circuit has no resolvable start point; all filters rendered without reachability analysis
- **Node interactions:**
  - Click filter node → open the policy file and reveal that filter's definition range
  - Filter node that references another circuit → secondary action "Open referenced policy" opening the Policy Flow view for the target circuit (resolution via `003-jump-to-circuit.md` service); missing target shown with the standard not-found warning
- **Legend** explaining green/red edges, start marker, and warning styles.
- Panel title and header show circuit name and `projectDisplayName` (when multiple projects are in scope).
- View is strictly **read-only** — no modification of policy files.

## Behaviour

- Implement under `src/features/policyFlowView/` with the parsing/graph-building logic separated from the webview rendering so it is unit-testable without VS Code UI.
- On open:
  1. Resolve the target circuit definition (reuse circuit index from `002-circuit-search.md` / `003-jump-to-circuit.md`).
  2. Parse the circuit's filter list, start filter, and success/failure links into a flow graph model:
     - `FlowNode { id, name, filterType, location: { file, range }, circuitRef?: string }`
     - `FlowEdge { from, to, kind: 'success' | 'failure' }`
  3. Run reachability analysis from the start filter; mark unreachable nodes and dangling edges.
  4. Render with an automatic top-down hierarchical layout (start filter at top, flow downwards — matching Policy Studio's default orientation). Exact layout library is an implementation choice.
- Layout must stay readable for typical policies (roughly 5–50 filters) and remain interactive up to ~150 filters; beyond that, render anyway but show a hint that the view may be slow.
- **Refresh:** re-parse and re-render when the underlying policy file changes on disk (debounced); preserve zoom/pan when node set is unchanged.
- **Multiple panels:** each opened circuit gets its own panel (or the panel is reused per circuit — implementation choice, but two different circuits must never share stale state).
- **Colour accessibility:** success/failure must be distinguishable by more than colour alone (e.g. solid vs. distinct arrowhead/label or line style), so the view works for red–green colour-blind users. Green/red remain the primary encoding to match Policy Studio conventions.
- XML and YAML project layouts produce the same flow graph model.

## Edge Cases

- **Circuit not found:** Standard not-found warning (as in `003-jump-to-circuit.md`); no empty panel left open.
- **Empty circuit (no filters):** Panel with empty state message.
- **Single filter, no links:** One node, marked as start and terminal.
- **Filter with failure path but no success path (or vice versa):** Render present edges only; absence of a success edge marks a terminal node — not an error by itself.
- **Success and failure pointing to the same filter:** Two parallel edges (green and red), both visible and distinguishable.
- **Loops within the policy** (filter links forming a cycle): Render normally; layout must not hang; no cycle warning required in v1.
- **Duplicate circuit names:** Disambiguate via quick pick before opening (same rule as jump-to-circuit — never silently pick one).
- **Unknown filter type:** Render as generic node with the raw type string in the tooltip; never fail parsing because a type is unrecognized.
- **Malformed circuit definition (invalid XML/YAML):** Show parse error state in the panel with file path; do not crash the extension host.
- **File deleted while panel open:** Show stale-state banner with option to close or retry.

## Acceptance Criteria

- [ ] Command `policyStudioTools.showPolicyFlow` opens the flow view for a chosen circuit in a detected project.
- [ ] Filters of a fixture policy appear as nodes; success links render green, failure links render red, and the two are distinguishable without relying on colour alone.
- [ ] The start filter is visually marked and placed at the top of the layout.
- [ ] An unreachable filter in a fixture is visually flagged.
- [ ] A success/failure link to a non-existent filter id is rendered as a dangling/missing indicator, not silently dropped.
- [ ] Clicking a filter node opens the policy file at that filter's definition.
- [ ] A filter referencing another circuit offers navigation to that circuit's flow view via the shared jump-to-circuit service.
- [ ] Editing and saving the policy file refreshes the open flow view without a window reload.
- [ ] The view never writes to policy files.
- [ ] Unit tests cover flow model extraction (nodes, success edges, failure edges, start filter), reachability analysis, and dangling-link detection — independent of the webview.
- [ ] Integration test (or documented manual test) verifies the panel opens for a fixture circuit and click-to-navigate works.

### Non-goals (v1)

- Editing the policy from the graph (moving filters, re-wiring paths).
- Rendering filter configuration details beyond name/type (full property inspection stays in the editor).
- Overlaying runtime/trace data on the flow (see future ideas; `004-trace-viewer.md`).
- Pixel-accurate reproduction of Policy Studio's stored canvas coordinates — layout is computed, not read from Policy Studio layout metadata.
- Export as image/SVG.

### Test fixture requirements

- `test/fixtures/policy-flow/simple/` — linear policy: start → filter A → filter B (success path only).
- `test/fixtures/policy-flow/branching/` — filter with distinct success and failure targets.
- `test/fixtures/policy-flow/unreachable/` — a filter defined but not linked from the start path.
- `test/fixtures/policy-flow/dangling/` — success link pointing to a non-existent filter id.
- `test/fixtures/policy-flow/circuit-ref/` — policy containing a filter referencing another circuit.
- `test/fixtures/policy-flow/no-start/` — circuit without a resolvable start filter.
- `test/fixtures/policy-flow/large/` — generated policy with 100+ filters for performance smoke test (may be gitignored and generated in CI).

## Future Ideas

- Overlay trace results on the flow: highlight the actual path a request took, from `004-trace-viewer.md` data.
- Read Policy Studio's stored canvas coordinates when available and offer "Studio layout" as an alternative to auto-layout.
- Inline expansion of referenced circuits (nested flow) inside the current view.
- Filter property preview on hover or side panel.
- Export flow as PNG/SVG/Mermaid for documentation (`007-export-documentation.md`).
- Diff view highlighting flow changes between two versions of a policy (`006-policy-diff.md`).
