# Feature: Export Documentation

## Goal

Generate human-readable documentation from a Policy Studio project to support onboarding, architecture reviews, and operational handover. Markdown is the primary output format; the architecture must allow HTML and PDF export later without rewriting the content model.

## User Story

As a team lead or developer, I want to export documentation describing circuits, routing, backends, attributes, scripts, and references in my Policy Studio project, so that new team members and reviewers can understand the system without opening every policy file.

## Inputs

- Project(s) from current scope via `getProjectsInScope()` (see `000-multi-project-monorepo.md`).
- Per-project root and all in-scope policy files (YAML primary, XML legacy layouts).
- User options at export time (defaults acceptable for v1):
  - Output directory or single output file path
  - Include or exclude sections: circuits, filters, routing, backends, attributes, scripts, references
  - Optional circuit name filter (export subset)
- VS Code command: `policyStudioTools.exportDocumentation`.

## Outputs

- **Primary:** Markdown documentation file(s) written to user-selected location (workspace or save dialog).
- **Document structure (minimum):**
  1. **Title and metadata** — project name, export timestamp, tool version, source workspace path
  2. **Table of contents** — linked headings for each circuit
  3. **Project overview** — counts (circuits, APIs, entry points), high-level reference graph summary
  4. **Per-circuit sections:**
     - Circuit name and source file path
     - Purpose/description if present in policy metadata or first comment block
     - Filter pipeline (ordered list with filter type/name)
     - Routing paths (method + path template where applicable)
     - Backend URLs / connection targets
     - Message attributes read or written (best effort static analysis)
     - Embedded scripts (full content or collapsed with expand link in Markdown — default: truncated with line count, full in appendix optional)
     - Outbound circuit references (linked names for cross-reference)
  5. **Appendix (optional v1):**
     - Index of all path templates
     - Index of all backend URLs
     - Index of attributes by name
- **Intermediate documentation model** (internal, renderer-agnostic):
  - `DocumentationModel { metadata, circuits[], indices }`
  - Renderers: `MarkdownRenderer`, future `HtmlRenderer`, `PdfRenderer`
- **Export result summary** notification: files written, circuits documented, warnings (unparseable files, incomplete sections).

## Behaviour

- Activate only when a Policy Studio project is detected.
- On command:
  1. For each project in scope, parse into a semantic model (reuse parsers from search/diff where possible).
  2. Build one `DocumentationModel` per project, or a combined model with a top-level section per project when scope is `allProjects`.
  3. Render Markdown via `MarkdownRenderer`.
  4. Write to disk (one file per project by default); offer to open generated file in editor.
- Cross-references between circuits use Markdown links with anchor ids (e.g. `[AuthCircuit](#authcircuit)`).
- Scripts:
  - Fence with appropriate language tag (`javascript`, `groovy`, etc. when detectable).
  - Truncate scripts longer than configurable line threshold with note “truncated — see source file”.
- Routing and backends:
  - Group by circuit; deduplicate identical URLs across filters where obvious.
- Attributes:
  - List attribute names with context (filter name, get/set if determinable).
- Unparseable files:
  - Listed in a “Documentation warnings” section; skip file content.
- Do not modify source policy files.
- Output path must be outside or inside workspace per user choice; confirm overwrite if file exists.

## Edge Cases

- **Empty project / no circuits:** Generate minimal doc stating no circuits found.
- **Very large project:** Progress UI; optional circuit filter to export subset; avoid OOM by streaming Markdown write.
- **Duplicate circuit names:** Document each definition separately with file path disambiguation.
- **Circular references:** Document as-is; note cycle in overview (cross-link to graph feature).
- **Sensitive data in scripts or URLs:** No redaction in v1; add warning in export dialog that output may contain secrets.
- **Non-ASCII content:** UTF-8 encoding for Markdown output.
- **Read-only output location:** Show error; no partial files without cleanup.

## Acceptance Criteria

- [ ] Command `policyStudioTools.exportDocumentation` generates Markdown for a fixture project.
- [ ] Output includes a table of contents and per-circuit sections.
- [ ] Each circuit section lists source file path and ordered filters.
- [ ] Routing paths and backend URLs from fixture policies appear in the documentation.
- [ ] Referenced circuit names appear and use cross-reference links.
- [ ] Scripts from fixture policies appear in fenced code blocks (full or truncated per rules).
- [ ] Message attributes referenced in fixtures are listed.
- [ ] `DocumentationModel` is separate from `MarkdownRenderer` (unit test renders model without touching filesystem).
- [ ] Unparseable fixture file produces a warning section without aborting export.
- [ ] Generated Markdown opens correctly in VS Code preview (valid heading anchors and links).
- [ ] Unit tests cover model building and Markdown rendering for minimal and multi-circuit fixtures.

### Non-goals (v1)

- HTML or PDF export (architecture only).
- Diagrams embedded in export (see `008-visual-circuit-graph.md` for future integration).
- Publishing to Confluence/wiki directly.
- Auto-redaction of credentials.

### Test fixture requirements

- `test/fixtures/export-documentation/minimal/` — one circuit, one filter, one path, one backend URL.
- `test/fixtures/export-documentation/multi-circuit/` — multiple circuits with cross-references.
- `test/fixtures/export-documentation/scripts/` — circuits with short and long embedded scripts.
- `test/fixtures/export-documentation/attributes/` — filters referencing named message attributes.
- `test/fixtures/export-documentation/invalid/` — one bad file plus valid circuits for warning behaviour.
- `test/fixtures/export-documentation/yaml-project/` — YAML layout (primary format; required fixture).

## Future Ideas

- HTML export with styled templates; PDF via HTML print pipeline.
- Include Mermaid diagram of circuit references in Markdown export.
- Configurable templates (custom Handlebars/Mustache themes).
- Diff documentation between two exports (`006-policy-diff.md`).
- Export single circuit from editor context menu.
- CI task to verify documentation is up to date.
