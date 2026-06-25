# Feature: Visual Circuit Graph

## Goal

Provide an interactive visual graph of Policy Studio circuits and the references between them. Help developers understand architecture, find entry points, and spot broken or circular dependencies at a glance.

## User Story

As a Policy Studio developer, I want to see a graph of circuits and how they call each other, so that I can understand system structure, identify entry points, and detect missing or circular references quickly.

## Inputs

- A detected Policy Studio workspace (see `001-project-detection.md`).
- Project circuit index: circuit names, definition locations, and outbound circuit references (shared with `002-circuit-search.md` / `003-jump-to-circuit.md`).
- User interactions:
  - Open graph command: `policyStudioTools.showCircuitGraph`
  - Search/filter box for circuit names
  - Click node, zoom, pan, fit-to-screen
  - Toggle visibility options (orphans, external refs, layout direction)

## Outputs

- **Graph view** (webview or native canvas — implementation choice) displaying:
  - **Nodes:** one per circuit (label = circuit name; tooltip = file path)
  - **Directed edges:** from caller circuit to referenced circuit
- **Visual annotations:**
  - **Entry-point circuits** — highlighted when they have no incoming edges from other in-project circuits (or match known API listener attachment — refine during implementation)
  - **Missing references** — edge or stub node styled as broken when reference target has no definition in project
  - **Circular references** — cycles highlighted (edge colour, badge, or cycle list panel)
- **Side panel or legend** explaining colours and listing detected cycles and missing refs.
- **Filter/search state:** only matching nodes and their connected neighbours shown when filter active (configurable depth).
- **Node click action:** invokes `jumpToCircuit` (`003-jump-to-circuit.md`) for the circuit definition.

## Behaviour

- Build directed graph `G = (V, E)`:
  - `V` = all circuits found in project index
  - `E` = `(caller, callee)` for each circuit reference extracted from policy configuration
- Compute analysis sets:
  - **Entry points:** nodes with in-degree zero within project graph (with optional override for circuits bound to inbound listeners)
  - **Missing refs:** callee name not in `V` — render as dashed edge to synthetic “missing” node labelled with target name, or orphan callee stub
  - **Cycles:** run cycle detection (e.g. Tarjan or DFS); highlight all edges participating in at least one cycle
- Layout:
  - Automatic hierarchical or force-directed layout suitable for 50–200 nodes
  - Re-layout on filter change without losing selection when possible
- Large project support:
  - Initial view shows entry points and first hop only, or top N nodes by degree — user expands neighbourhood (“show callers/callees”)
  - Search narrows to matching nodes plus 1-hop neighbours by default
  - Virtualize or simplify rendering when node count exceeds threshold (e.g. 300): cluster low-connectivity circuits into “Other” group (optional v1; minimum is filter/search)
- Refresh graph on policy file changes (debounced re-index).
- Graph is read-only — does not edit policies.

## Edge Cases

- **No circuits:** Empty graph with message.
- **Single circuit, no references:** One node, no edges; marked as entry point.
- **Duplicate circuit names:** Merge or split nodes — default: one node per unique name with multiple definition paths in tooltip; if definitions disagree on references, show union of edges with warning badge.
- **Self-reference:** Circuit references itself — edge shown; included in cycle detection.
- **Reference to external/library circuit:** Treated as missing unless external catalogue added later.
- **Disconnected subgraphs:** All components visible; entry points per component highlighted.
- **Very dense graph:** Performance degrades gracefully; suggest user apply search filter.
- **YAML vs XML:** Same graph model regardless of serialization.

## Acceptance Criteria

- [ ] Command `policyStudioTools.showCircuitGraph` opens the graph view for a detected project.
- [ ] Nodes represent circuits; edges represent reference/call relationships from fixture data.
- [ ] Entry-point circuits are visually distinct from non-entry circuits.
- [ ] A reference to a non-existent circuit is indicated as a missing reference.
- [ ] A circular reference (A → B → A) is detected and visually highlighted.
- [ ] Clicking a node opens the circuit definition via the shared jump-to-circuit service.
- [ ] Search/filter by circuit name reduces visible nodes and remains interactive on a medium fixture (50+ circuits).
- [ ] Graph refreshes after a policy file change without requiring window reload.
- [ ] Unit tests cover graph construction, entry-point detection, missing ref detection, and cycle detection.
- [ ] Integration test (or documented manual test) verifies click-to-navigate on a known fixture node.

### Non-goals (v1)

- Editing graph layout persistence across sessions (nice-to-have later).
- Export graph as image/SVG (future).
- Real-time runtime metrics on edges.
- Filtering by filter type or HTTP method.

### Test fixture requirements

- `test/fixtures/circuit-graph/linear/` — A → B → C chain.
- `test/fixtures/circuit-graph/cycle/` — A → B → A (and optionally longer cycle).
- `test/fixtures/circuit-graph/missing-ref/` — circuit referencing undefined name.
- `test/fixtures/circuit-graph/entry-points/` — multiple components with clear entry nodes.
- `test/fixtures/circuit-graph/duplicates/` — same circuit name in two files (disambiguation behaviour).
- `test/fixtures/circuit-graph/medium/` — 50+ circuits for filter/search performance smoke test.

## Future Ideas

- Export graph as PNG/SVG/Mermaid for documentation (`007-export-documentation.md`).
- Show filter-level subgraph inside a circuit node on expand.
- Diff two graph versions side-by-side (`006-policy-diff.md`).
- Cluster by folder or API product.
- Click edge to show referencing filter location.
