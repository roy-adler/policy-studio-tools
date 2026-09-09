# ENV editor tree UX — search, persistence, missing highlight

**Date:** 2026-08-11  
**Feature spec:** `specs/011-env-values-editor.md`

## Summary

Improve the ENV values editor tree so save/reload keep place, missing keys are yellow, search filters the tree by key or value, and singleton chains auto-expand.

## Behaviour

1. **Persistence:** Service keeps `selectedPath`, `expandedPaths`, and `searchQuery` across save/reload/edit re-renders; clear only when ENV root changes. Selecting a leaf updates the selected class and detail pane in the webview — the host must not replace `webview.html` (that resets tree scroll to the top).
2. **Missing yellow:** Leaf + ancestor styling for missing stage cells.
3. **Search:** Case-insensitive substring on dotted path / segment names and on scalar/list values across stages; filter tree to matches + ancestors.
4. **Auto-expand:** From an opened node (or filtered single chain), expand while `children.length === 1` until leaf or multi-child node.

## Files

- `src/features/envValuesEditor/envTreeView.ts` — filter, missing-descendant, auto-expand (pure)
- `src/features/envValuesEditor/envValuesPanelHtml.ts` — search UI, styles, expand messages
- `src/features/envValuesEditor/envValuesEditorService.ts` — persist UI state
- `test/unit/envValuesEditor.test.ts` — coverage
