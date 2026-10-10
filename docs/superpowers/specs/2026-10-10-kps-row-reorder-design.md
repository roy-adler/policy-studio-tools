# Design: KPS row reorder (drag & drop)

Date: 2026-10-10

## Goal

Let the user change the order of rows in a KPS datatable by dragging them in the grid, without retyping values, with the same target semantics as the other row edits (single stage or stage group) and without disturbing the grid's scroll position.

## Context

Row order in a KPS datatable is whatever order the file's JSON array contains, and some consumers process rows in that order. The original feature spec (012) specified adding and removing rows but not reordering. The editor already ships a grip-based drag & drop for this: a `moveRow` mutation in `kpsTableMutations.ts`, a `moveRow` webview message handled through the stage-target edit path in `kpsEditorService.ts`, and a drag script in `kpsPanelHtml.ts`. This design records that behaviour as locked decisions, updates the feature spec, and closes the test gap for the group view.

## Decisions (locked)

1. **Handle:** The grid prepends a narrow handle column (no header). Each row's `⋮⋮` grip is the only draggable element; the full row is the drop target. The handle column is UI chrome and is never written to JSON.
2. **Drag feedback:** The drag image is the full row (a dimmed clone); the source row is dimmed while dragged. A focus-coloured line above or below the hovered row shows the insertion point, chosen by the pointer position relative to the row's vertical midpoint. Hovering the row being dragged shows no indicator.
3. **Drop index:** Dropping in the top half of a row inserts before it; in the bottom half, after it. When the source row is above the insertion point, the index is decremented by one for the removal. A drop that resolves to the source row's current position — including a drop onto the row itself — is a no-op: no message is posted, nothing is marked dirty, and the grid is not re-rendered.
4. **Single-stage view:** The move reorders that stage's row list only and marks that stage dirty. There is no confirmation dialog, unlike Remove row.
5. **Group view:** The move runs through the group edit path: the first member's rows are cloned, the move is applied to the clone, and the reordered list is written to every member with each member marked dirty (the same clone-and-rewrite semantics as the other group edits). A stale group target is rejected.
6. **Group membership:** Group equality is a row multiset that ignores row order, so a reorder never changes group membership, badges, or selection, in a single-stage or a group view. A group target stays resolved after the move; a stage target never promotes to a group.
7. **Scroll:** An applied reorder re-renders the grid with its vertical and horizontal scroll position preserved, like Add row, Remove row, Create missing, and Save.
8. **Persistence:** Reordered rows are written on Save like any other edit: dirty stage files only, pretty-printed, original key order, no coercion.
9. **Feature spec:** Update `specs/012-kps-editor.md` to document the feature.

## Data model

No new model state. `moveRow(session, tableName, stageId, fromRowIndex, toRowIndex)` is a mutation in `kpsTableMutations.ts`: the stage must be present, out-of-range indices throw, `fromRowIndex === toRowIndex` returns without changing rows or the dirty flag, otherwise the row is spliced within the stage's list and the stage is marked dirty.

The panel posts `{ type: 'moveRow', tableName, target, fromRowIndex, toRowIndex }` where `target` is the active stage or group target. The service runs the mutation through `applyKpsTargetEdit`, so a stage target edits one stage and a group target edits all members; an applied edit re-renders with preserved grid scroll and keeps the resolved target as the selection.

## Drag and drop

The grid rows carry a `data-row-index` attribute. The panel script binds `dragstart` on each grip and `dragover`/`drop` on each row (and `dragend` on the grid body); bindings are idempotent per element and re-run after every re-render. The handlers compute the insertion point from the pointer's vertical position against the hovered row's midpoint, as in Decision 3, and post the `moveRow` message only when the resulting index differs from the source index.

## Testing

Unit tests cover:

- `moveRow` reorders rows within a stage and marks the stage dirty. (exists)
- `moveRow` with `fromRowIndex === toRowIndex` is a no-op: rows unchanged, stage not marked dirty. (exists)
- The grid HTML renders one `draggable="true"` grip per row, wired to post a `moveRow` message with the active target. (exists)
- A group target moves the row in every member's row list in one operation and marks every member dirty; stages outside the group are untouched. (new)
- A reorder leaves the computed stage groups unchanged (same row multiset) and keeps the group target resolved. (new)

## Non-goals

- Dragging a row to a different stage (cross-stage move)
- Keyboard- or menu-driven row reordering
- Dragging several rows at once
