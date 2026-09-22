# Design: KPS stage groups

Date: 2026-09-22

## Goal

When a KPS table has the same rows in two or more stages, the KPS editor offers one group view that edits those stages together, while every stage stays individually selectable.

## Decisions (locked)

1. **Approach:** Groups are computed from current row content after load and after every edit. Nothing stores a separate link between stages.
2. **Who can join:** Only stages whose file is present and parsed. Missing and error stages stay individual badges.
3. **Equality:** Two present stages match when they contain the same rows as a multiset. Row order does not matter. Duplicate rows count. Compared content is what would be written: editable scalar values, list arrays on the cell, and preserved nested values. Cell warnings and JSON key order do not matter. Element order inside a list does matter: `[1, 2]` and `[2, 1]` are different.
4. **Groups:** Each equivalence class of two or more stages is one group. A stage that matches nobody has no group badge. Several groups can exist on one table.
5. **Label and order:** Badge text is the member stage ids in discovery order, joined by `/` (example: `DEVL/TEST`). The grid shows the row order of the first member in that order.
6. **Default selection:** On open and on every table switch, the largest group becomes active. A tie goes to the group whose first member appears earliest in discovery order. With no group, the first present stage is selected, otherwise the first stage. Switching tables does not keep the previous table's stage or group.
7. **Stage bar:** Group badges first, ordered by each group's first member, then every stage badge in discovery order (members, unmatched, missing, and error). While a group is active, that group badge and its member badges are highlighted. A click on a stage badge selects only that stage; group badges stay visible and inactive. A click on a group badge selects that group.
8. **Group edit:** Clone the first member's rows, run the existing set-cell, add-row, or remove-row logic on the clone (including list parsing), and on success replace every member's rows with a deep copy of that result and mark each member dirty. The first successful edit also rewrites every member to the displayed row order.
9. **Rejected edit:** Invalid scalar or list input changes no member, does not mark dirty, and sets the existing banner warning.
10. **Single-stage edit:** The existing mutation runs on that stage only. Groups are then recomputed. Selection stays on that stage, including when it leaves or joins a group.
11. **Dissolved group:** If the active group's exact member set no longer exists, selection falls back to the first of those members as a single stage.
12. **Create missing:** Selection stays on the stage that was created. An empty file can join a group of other empty stages on the next compute.
13. **Save and open:** Save still writes only dirty stage files through the current writer, so list cells stay JSON arrays. In a group view, Open JSON is disabled. A single-stage view still opens that stage's file. Store Group and Type Group are unchanged. Reload, Switch KPS, and dirty-discard confirms are unchanged.
14. **Feature spec:** Update `specs/012-kps-editor.md`. Stages whose rows match are edited together as a group. Stages that do not match, including the unmatched members of a partial group, stay per-stage. Diff highlighting of unequal tables stays out of scope.

## Data model

Grouping is a pure function over one `KpsTableModel` and the session's `stageIds` order. It returns groups of member ids. It does not live on `KpsSession`.

Selection lives on the editor service:

- `{ kind: 'group', memberIds: string[] }`
- `{ kind: 'stage', stageId: string }`

Edit messages carry that same target. A group edit applies only when `memberIds` is still exactly one current group. A stage edit applies only to that stage.

Row copies are deep, including list arrays and nested extras, so a later single-stage edit cannot alias another stage.

## Edit and display

The stage bar renders group buttons, then the existing stage buttons. The grid for a group is the first member's rows. Add row, remove row, and cell commit post the active target. Create missing remains on the individual missing stage.

After each mutation the panel recomputes groups and resolves selection with the rules above. A group edit that succeeds keeps the same member set selected. A single-stage edit does not move selection onto a group that appears or shrinks.

## Testing

Unit tests cover:

- Same rows in different order form one group.
- Different list element order, or a different nested value, does not.
- A scalar sitting in a list column does not match an array.
- Missing and error stages are excluded.
- Two disjoint groups, and a stage with no partner, are recognized.
- A successful group edit, including a list cell, writes one row list to every member and marks them dirty.
- A rejected scalar or list edit leaves every member unchanged.
- A single-stage edit removes that stage from its group and leaves the others together.
- The stage bar HTML contains the group badge, member highlighting while the group is active, and the individual stage badges.

## Non-goals

- Linking stages whose rows differ
- Diff highlighting for unequal tables
- Editing a missing or error stage through a group
- A per-item add/remove control for list cells
- Changing pretty-print or save rules
