# Policy Flow fixtures

Fixtures for `specs/010-policy-flow-view.md`. Each folder is a minimal Policy Studio
YAML entity store project (marker `values.yaml` plus a `Policies/` directory)
containing one or more scenarios.

**Primary (`yaml-es/`):** canonical multi-scenario project with filter names containing
spaces —

| Policy file | Scenario |
|-------------|----------|
| `Order Flow.yaml` | Branching: distinct success and failure targets |
| `Unreachable Flow.yaml` | Filter `Orphan` defined but not linked from the start path |
| `Dangling Flow.yaml` | Success link to non-existent filter `Ghost` |
| `No Start Flow.yaml` | Circuit without a `start` declaration |
| `Delegate Flow.yaml` + `Auth Flow.yaml` | `Call Auth` references circuit `Auth Flow` (delegation) |

**Per-scenario folders (YamlES):**

| Folder | Policy file | Scenario |
|--------|-------------|----------|
| `simple/` | `SimplePolicy.yaml` | Linear success chain: Validate → Transform → Respond |
| `branching/` | `BranchingPolicy.yaml` | Distinct success (Respond) and failure (HandleError) targets |
| `unreachable/` | `UnreachablePolicy.yaml` | Filter `Orphan` defined but not linked from the start path |
| `dangling/` | `DanglingPolicy.yaml` | Success link to non-existent filter `Ghost` |
| `circuit-ref/` | `CallerPolicy.yaml` + `AuthPolicy.yaml` | `CallAuth` references circuit `AuthPolicy` (delegation) |
| `no-start/` | `NoStartPolicy.yaml` | Circuit without a `start` declaration |
| `axway-es/` | `Health Check.yaml` | Axway entity-store YAML with start/success/failure fields |

A `large/` fixture (100+ filters) is intentionally not committed; generate one
locally if a performance smoke test is needed.

## Manual verification in VS Code (Extension Development Host)

1. Open one of the fixture folders (prefer `yaml-es/`, the primary format) as the workspace.
2. Run **Policy Studio: Show Policy Flow** from the command palette and pick the circuit,
   or click **Policy flow** in the Policy Studio sidebar under *Analyze*.
3. Verify:
   - Success edges are green and solid; failure edges are red and dashed.
   - The start filter shows a `START` badge and sits on the top layer.
   - Terminal filters show an end bar below the node.
   - `unreachable/`: `Orphan` is greyed out and labelled unreachable.
   - `dangling/`: `Ghost` appears as a dashed red "Missing filter" node.
   - `circuit-ref/`: `CallAuth` shows an "Open AuthPolicy" link that opens the
     referenced circuit's flow view.
   - `no-start/`: a warning banner explains the missing start filter.
4. Click a filter node — the policy file opens beside the panel with the filter revealed.
5. Edit and save the policy file — the open flow view refreshes without a window reload.
6. Sidebar (spec 009): open the Policy Studio activity bar icon → the *Tools* view lists
   **Search circuits**, **Jump to circuit** (Navigate), and **Policy flow** (Analyze);
   clicking each runs the corresponding command.
