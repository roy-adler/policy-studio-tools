# Feature: Trace Viewer

## Goal

Let developers open and inspect Axway API Gateway / Policy Studio `.trc` trace files inside VS Code in a structured, readable view. The viewer must highlight failures and important message data, support in-trace search, and remain usable on very large traces without freezing the UI.

## User Story

As an API Gateway developer, I want to open trace files and explore execution steps, failures, headers, bodies, and attributes in a clear tree view, so that I can diagnose routing and policy issues without leaving my editor.

## Inputs

- A `.trc` trace file opened from the workspace explorer, editor tab, or command `policyStudioTools.openTrace`.
- File path and raw trace file bytes (read-only).
- Optional user actions:
  - Expand/collapse tree nodes
  - In-view search query
  - Jump to parent/child filter in tree
  - Copy field value to clipboard

## Outputs

- A dedicated **Trace Viewer** panel (custom editor, webview, or tree view — implementation choice) showing:
  - **Trace metadata** — file name, size, timestamp if present in trace header, service/instance hints if parseable.
  - **Structured tree** of trace entries (filters/stages) with hierarchy reflecting execution order and nesting.
  - **Per-entry details** including where available:
    - Filter name and type
    - Status (success, failure, skipped)
    - Duration or timing markers
    - Request and response bodies (with content-type hint)
    - HTTP headers (request/response)
    - Message attributes
    - Error messages and stack traces
- Visual highlighting:
  - Failed filters clearly marked (icon, colour, or badge)
  - Errors and warnings distinguished from informational fields
  - Large body content collapsed by default with expand action
- In-trace **search results** — matching nodes listed or filtered in the tree with match highlighting.
- Read-only guarantee — no write-back to the `.trc` file.
- Loading progress for large files; cancellable parse if user closes the viewer.

## Behaviour

- Register `.trc` file association so double-click opens the Trace Viewer (custom editor provider) rather than raw text by default; retain “Open With…” → Text Editor for raw access.
- Parse trace format incrementally:
  - Detect format variant (Policy Studio / API Gateway trace dialects); support at least the common text/XML trace layout used in Axway traces (exact grammar defined during implementation against real samples).
  - Build a lazy tree: load top-level entries first; fetch child details on expand.
- For very large trace files:
  - Stream file reads; avoid loading entire file into a single string when size exceeds threshold (e.g. 10 MB).
  - Virtualize tree rendering so only visible nodes are materialized in the UI.
  - Offload heavy parsing to a worker or chunked async tasks yielding to the event loop.
  - Show file size warning above threshold with option to proceed or open as text only.
- Search within trace:
  - Filter tree nodes whose labels or detail fields contain the query (case-insensitive default).
  - Navigate next/previous match.
- Failed filter detection:
  - Mark entries with explicit failure status, non-success result codes, or presence of error/exception fields.
- Bodies and headers:
  - Pretty-print JSON/XML bodies when detectable; otherwise show raw text in a monospace block.
  - Truncate very long values in the tree; full content on selection or expand.
- Closing the viewer releases parsed structures and cancels ongoing parse work.

## Edge Cases

- **Empty trace file:** Show empty state with message.
- **Unrecognized trace format:** Show parse error with option to open as plain text; do not crash the extension host.
- **Partially corrupted trace:** Parse recoverable sections; show warning banner listing skipped regions.
- **Huge single field (multi-MB body):** Do not pretty-print entire field synchronously; offer lazy load on expand.
- **Binary or non-UTF-8 content in bodies:** Detect encoding where possible; show hex or base64 summary with warning.
- **Multiple traces open:** Each tab/panel independent; no global mutable parse cache keyed only by file name without URI.
- **File modified externally while open:** Prompt to reload or ignore; default read-only snapshot at open time.
- **Trace from different API Gateway version:** Best-effort parse; unknown elements shown as generic nodes.

## Acceptance Criteria

- [ ] `.trc` files can be opened in the Trace Viewer from the workspace.
- [ ] Trace entries appear in a hierarchical tree reflecting execution structure.
- [ ] Failed filters are visually distinguishable from successful steps.
- [ ] Request body, response body, headers, message attributes, and error messages are visible for representative trace entries in fixtures.
- [ ] In-trace search finds and highlights matching content.
- [ ] Opening a large trace fixture (target: 50 MB synthetic or sampled file) does not freeze VS Code for more than 2 seconds at a time without progress feedback.
- [ ] Trace files are never modified on disk by the viewer (verify with file watcher hash or mtime in tests).
- [ ] Unrecognized or corrupt traces show a user-friendly error, not an unhandled exception.
- [ ] Unit tests cover parser logic on small fixture traces (success, failure, nested filters).
- [ ] Integration test opens a fixture `.trc` and asserts tree contains expected filter names.

### Non-goals (v1)

- Editing or re-running traces.
- Live tailing of active gateway traces.
- Comparing two trace files side-by-side (see future ideas).
- Export to external APM tools.

### Test fixture requirements

- `test/fixtures/trace-viewer/success.trc` — short successful request through multiple filters with headers and small JSON bodies.
- `test/fixtures/trace-viewer/failure.trc` — trace with at least one failed filter and error message.
- `test/fixtures/trace-viewer/nested.trc` — nested circuit or filter invocation hierarchy.
- `test/fixtures/trace-viewer/attributes.trc` — trace with rich message attributes.
- `test/fixtures/trace-viewer/corrupt.trc` — truncated or malformed tail for error-handling tests.
- `test/fixtures/trace-viewer/large.trc` — generated large file for performance smoke tests (may be gitignored and generated in CI).

## Future Ideas

- Diff two `.trc` files highlighting divergent steps.
- Link from trace filter name to circuit definition (`003-jump-to-circuit.md`).
- Filter tree to failures only.
- Timeline/waterfall view of filter durations.
- Export trace summary to Markdown for incident reports.
