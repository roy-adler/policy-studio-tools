# Feature: Path Template Validator

## Goal

Validate URI path templates used in Policy Studio routing configuration and surface clear diagnostics in VS Code before policies are deployed. Catch common placeholder, regex, slash, duplication, and wildcard mistakes early.

## User Story

As a Policy Studio developer, I want path templates in my routing policies validated as I edit them, so that I avoid deployment-time routing errors and understand what syntax is valid.

## Inputs

- A detected Policy Studio workspace (see `001-project-detection.md`).
- Path template strings extracted from routing-related policy configuration, including but not limited to:
  - HTTP path patterns on API / resource filters
  - URI template fields in route, proxy, and dispatch filters
  - Path segments in YAML policy definitions equivalent to XML routing config
- Active document context when the user edits a policy file (for live diagnostics).
- Optional workspace-wide validation command: `policyStudioTools.validatePathTemplates`.

## Outputs

- **VS Code diagnostics** (errors, warnings, hints) attached to the document range containing each path template, with:
  - Stable diagnostic code (e.g. `policyStudio.pathTemplate.duplicateParam`)
  - Human-readable message describing the issue
  - Optional related information pointing to documentation or examples
- **Validation result model** (for programmatic use):
  - `template: string`
  - `location: { file, range }`
  - `severity: 'error' | 'warning' | 'info'`
  - `ruleId: string`
  - `suggestedFix?: QuickFixDescriptor` (descriptor only in v1; quick fix application may be partial)
- **Examples of valid templates** shown in:
  - Extension README or bundled `docs/path-templates.md` linked from diagnostics
  - Hover or code action “Show valid path template examples”
- Summary output for workspace command: count of errors/warnings across scanned files.

## Behaviour

- Register a diagnostic collection `policyStudio.pathTemplate`.
- When a policy document is opened or changed, extract path template literals and validate each against the rule set below.
- Debounce validation on typing (e.g. 300–500 ms) to avoid excessive work.
- Workspace validation command scans all policy files in the project using the same rules.

### Validation rules (v1)

| Rule ID | Severity | Condition |
|---------|----------|-----------|
| `emptyTemplate` | Error | Template is empty or whitespace only |
| `missingLeadingSlash` | Warning | Absolute path template does not start with `/` when context implies absolute path |
| `duplicateParam` | Error | Same placeholder name appears more than once (e.g. `/api/{id}/{id}`) |
| `unclosedPlaceholder` | Error | `{` without matching `}` or nested braces |
| `invalidPlaceholderName` | Error | Placeholder name empty or contains invalid characters |
| `unsupportedWildcard` | Warning | `*` or `**` used in a way not supported by API Gateway path matching semantics |
| `invalidRegexGroup` | Error | Regex portion malformed (unclosed parens, invalid escape) when template uses regex syntax |
| `ambiguousRegexLiteral` | Warning | Characters that may be interpreted as regex metacharacters without clear delimiter |
| `consecutiveSlashes` | Warning | `//` in path (except documented exception if any) |
| `trailingSlash` | Info | Trailing `/` may change matching behaviour — informational only |

- Rules must be backed by unit tests with accepted/rejected examples aligned to Axway API Gateway path template behaviour (refine against official documentation during implementation).
- Diagnostics must map to the exact template string range in the source file (XML attribute, element text, or YAML value).
- Design `QuickFixDescriptor` structure so future code actions can apply fixes without changing the rule engine API.

### Examples to document (non-exhaustive)

- `/api/v1/pets` — static path
- `/api/v1/pets/{petId}` — single path parameter
- `/api/v1/pets/{petId}/orders/{orderId}` — multiple distinct parameters
- `/files/{path:.*}` — regex-constrained parameter (if supported by target platform; mark with platform note)

## Edge Cases

- **Template in CDATA or multiline XML:** Extract full value; diagnostic range covers full template.
- **Escaped braces in static segments:** Do not treat as placeholders when correctly escaped per format rules.
- **Multiple templates in one file:** Each validated independently.
- **Non-routing path-like strings:** Reduce false positives by only validating known routing elements/attributes (allowlist); do not validate arbitrary strings that resemble paths.
- **YAML vs XML:** Same rules on extracted template strings regardless of serialization.
- **Invalid XML file:** Skip structured extraction; optionally no diagnostics until file is parseable.
- **Generated or third-party policies:** User can ignore warnings via standard VS Code diagnostic suppression (if configured) — no custom silencing required in v1.

## Acceptance Criteria

- [ ] Diagnostics appear on invalid path templates in a representative routing policy fixture.
- [ ] Each rule in the validation table has at least one positive and one negative unit test.
- [ ] `missingLeadingSlash`, `duplicateParam`, `unclosedPlaceholder`, and `unsupportedWildcard` rules are implemented.
- [ ] Valid templates in fixtures produce zero errors.
- [ ] Diagnostic messages are actionable and include the rule id or code.
- [ ] Documentation lists valid template examples and links from at least one diagnostic-related UI surface.
- [ ] Workspace validate command reports summary counts for a multi-file fixture.
- [ ] Validation on edit is debounced and does not cause noticeable typing lag on typical files.
- [ ] Quick fix descriptors exist in the result model for at least two rules (implementation of apply-fix code actions may follow in a later task).

### Non-goals (v1)

- Validating backend URLs or query strings (only path templates).
- Simulating live request matching against real HTTP traffic.
- Auto-fixing all rule violations.
- Validating OpenAPI path definitions outside Policy Studio policy files.

### Test fixture requirements

- `test/fixtures/path-template-validator/valid/` — policies with only valid templates.
- `test/fixtures/path-template-validator/invalid/` — one file per rule violation type where possible.
- `test/fixtures/path-template-validator/mixed/` — multiple templates per file with mixed severities.
- `test/fixtures/path-template-validator/non-routing/` — path-like strings in non-routing context that must not produce false positives.

## Future Ideas

- Code actions: insert leading slash, rename duplicate parameter, remove unsupported wildcard.
- Validate HTTP method + path combination uniqueness across the project.
- Cross-check path templates against exported OpenAPI specs.
- Configurable rule severity per workspace.
- Quick fix preview with diff.
