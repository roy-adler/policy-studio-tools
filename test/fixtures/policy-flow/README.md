# Policy Flow fixtures

Fixtures for `specs/010-policy-flow-view.md`. Each folder is a minimal Policy Studio
project (marker `PrimaryStore.xml` or `values.yaml`) containing one scenario:

| Folder | Scenario |
|--------|----------|
| `simple/` | Linear success chain: Validate → Transform → Respond |
| `branching/` | Distinct success (Respond) and failure (HandleError) targets |
| `unreachable/` | Filter `Orphan` defined but not linked from the start path |
| `dangling/` | Success link to non-existent filter `Ghost` |
| `circuit-ref/` | `CallAuth` references circuit `AuthPolicy` (delegation) |
| `no-start/` | Circuit without a `start` declaration |
| `axway-es/` | Axway entity-store XML dialect with `fval` start/success/failure |
| `yaml-es/` | YAML entity-store dialect |

A `large/` fixture (100+ filters) is intentionally not committed; generate one
locally if a performance smoke test is needed.

## Manual verification in VS Code (Extension Development Host)

1. Open one of the fixture folders (e.g. `branching/`) as the workspace.
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
