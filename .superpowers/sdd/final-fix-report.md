# Cache Browser Whole-Branch Fix Wave

Date: 2026-09-03
Branch: `feat/cache-browser`

## Scope completed

- Preserved search focus, caret, and inventory scroll across host-rendered webview updates.
- Prevented `fields.type` from replacing the enclosing YAML entity/filter type during usage scanning.
- Continued the YAML line scan after `parseMappingYaml` reports unsupported or invalid input, while retaining the warning.
- Restricted XML cache discovery to XML Policy Studio projects and clarified XML read warnings.
- Bounded overflowing warning banners.
- Caught cache/usage navigation failures and displayed a Refresh-oriented error message.

## Regression coverage

- YAML projects ignore XML cache entities during inventory discovery.
- Known caching filters still resolve cache references when `fields.type` precedes the cache-bearing scalar.
- Unsupported mapping YAML still yields line-scanned cache usages and a warning.
- Rendered panel HTML posts/restores search selection and inventory scroll.
- Warning banner CSS limits height and enables scrolling.

## Verification

- `npm test -- test/unit/cacheBrowser.test.ts` — exit 0; 1 file passed; 42 tests passed.
- `npm test` — exit 0; 19 files passed; 321 tests passed.
- `npx tsc -p ./ --noEmit` — exit 0.
- `git diff --check` — exit 0 for the working tree; Git reported only an existing LF/CRLF warning for `test/fixtures/circuit-search/large/values.yaml`.

## Remaining concerns

- The requested large-fixture performance test/tree-walk consolidation, service helper cleanup, `panelShowMode` cleanup, and known-filter field-sweep spec change remain deferred.
- Unrelated example-repository fixture differences were present outside normal `git status`; they were not staged or included in this fix wave.
