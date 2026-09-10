# Design: ENV key usages in the Environment Values Editor

Date: 2026-09-10

## Goal

When a leaf is selected in the ENV values editor, show where that key is referenced from Policy Studio policy files as `{{<env.path>}}` (optional dotted suffix such as `.attributeValue`), and jump to the match on click.

## Decisions (locked)

1. **Surface:** Usage list in the ENV editor detail pane (not a separate tool). Selecting a leaf shows where it is used, including when it is unused.
2. **Match form:** Any `{{…}}` whose trimmed inner text equals the ENV key or is that key plus a dotted suffix (`.attributeValue` or any other `.segment`). The whole ENV key must appear; a different placeholder name (`{{id}}`) is not a usage. `A.AAA` is not a usage of `A.AA`.
3. **Navigation:** Click a usage row → open the file and highlight the full `{{…}}` range (same idea as jump-to-circuit).
4. **Scan:** On ENV editor load and Reload, walk sibling Policy Studio project(s) next to the open `ENV/` folder. Reuse the existing policy-file walk (`.yaml` / `.yml` / `.xml`). Read file text; do not parse circuits.
5. **UI:** Per-stage value editors stay first. Key heading gets a count badge (`N usages`). Below the values, a “Used in” list of `relativePath` + line, one row per match. Unused: red `0 usages` badge and “Not used in any policy.” No unused coloring in the tree.
6. **Out of v1:** Tree unused-highlight; interpolations that do not match any ENV key; live watch of policy files (Reload rescans).

## Architecture

Feature root remains `src/features/envValuesEditor/`.

| Unit | Responsibility |
|------|----------------|
| `findEnvAttributeUsages` | Discover sibling policy projects for an ENV root; walk policy files; extract interpolations; map to ENV keys |
| `envValuesPanelHtml` | Badge + usage list (or unused empty state) in the detail pane |
| `envValuesEditorService` | Load usages with the session; handle `openUsage` → open file at range |
| `types` | `EnvAttributeUsage` (file path, relative path, line, range) and a key → usages map |

Does not depend on circuit parsers. May reuse `discoverPolicyFiles` from `circuitSearch` for the file walk. Jump uses VS Code `showTextDocument` + selection, consistent with `circuitNavigation`.

### Data flow

1. Resolve ENV root (existing session load).
2. Resolve sibling Policy Studio project(s) under `dirname(envRoot)`. If the session already has a registry project, still scan every sibling that looks like a Policy Studio project next to that ENV (one ENV bundle can sit beside one YAML project today; scanning all siblings stays correct if more appear).
3. For each `.yaml` / `.yml` / `.xml` policy file, find `{{…}}` placeholders; record range and 1-based line. Lookup for a selected key keeps those whose inner text is that key or that key plus a dotted suffix.
4. Index by ENV key. Selecting a leaf looks up that key. Missing key → empty list (unused).
5. Click posts `openUsage` with absolute path + range; host opens the document and reveals the range.
6. Reload repeats steps 2–4. Save does not rescan.

## UI & behaviour

- **Used:** Blue/theme badge `N usages` on the heading (`N` = match count, not unique files). Section “Used in” with one clickable row per match: relative path from the policy project root and `L<line>`.
- **Unused:** Red badge `0 usages`. No clickable rows. Italic “Not used in any policy.”
- Intermediate tree nodes are not selectable as values today; usages are only shown for leaves.
- Several matches in one file → several rows.

## Edge cases

- Unreadable policy file → skip; keep the editor; add a short warning.
- No sibling Policy Studio project → empty usage map; unused empty state for every leaf; session warning (banner) that no policy project was scanned.
- Unparseable YAML/XML → still text-scan (regex does not need a valid document).
- Click when the file is gone → error toast; editor stays usable.
- Folder-picked ENV with no sibling project → same as no sibling project.

## Testing

Fixture under `test/fixtures/env-values-editor/` (or a dedicated subfolder) with a sibling policy project containing:

- YAML interpolation(s) for a known ENV key
- XML interpolation for the same string form
- A key in `values.yaml` with no interpolation (unused)
- Whitespace inside braces (still matches)
- A `{{id}}` placeholder that must not count as a usage of `A.AA`
- A `{{A.AA}}` placeholder that must count as a usage of `A.AA` (suffix not required)

Unit tests: extract + map; used vs unused lookup; skip unreadable files; HTML contains badge, list, unused red state, and “Not used in any policy.”

## Related

- Feature spec: `specs/011-env-values-editor.md`
- ENV editor design: `docs/superpowers/specs/2026-08-06-env-values-editor-design.md`
