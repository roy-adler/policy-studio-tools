# Policy Studio Tools — Agent Notes

VS Code extension providing tools for Axway Policy Studio projects (search,
navigation, visualization, validation).

## Policy formats: YAML first, XML legacy

**Axway moved Policy Studio to a YAML entity store. YAML is the primary,
most relevant format. XML remains fully supported as the legacy format and
must never be removed.**

Practical rules for every feature:

- Both formats must produce the **same domain model** (`ParsedCircuit` /
  `ParsedFilter` in `src/features/circuitSearch/types.ts`); features operate on
  the model, never on the serialization.
- New parsing capabilities are implemented for **both** formats, YAML first.
- Test fixtures must cover the YAML dialect for every scenario, not just XML.
- Project markers:
  - **YAML project (primary):** `values.yaml` plus a `Policies/`, `APIs/`, or
    `META-INF/` directory
  - **XML project (legacy):** `PrimaryStore.xml` at the project root

### Supported dialects

| Dialect | Parser | Notes |
|---------|--------|-------|
| YAML entity store | `src/features/circuitSearch/yamlPolicyParser.ts` (`parseYamlEsPolicy`) | `type: FilterCircuit` (top-level or `meta.type`), `fields.name`, `fields.start`, `children` as either a **list** (`- type: …` / `fields` / `routing`) or a **map** (named keys with `meta`/`fields`). Flow links: `routing.success` / `routing.failure` (primary) or `successNode` / `failureNode` (legacy map dialect). Refs may use `./`, `../`, or fully qualified paths. |
| Legacy simple YAML | same file (`parseLegacyYamlPolicy`) | our older `filters:` list format, kept for backwards compatibility |
| Axway XML entity store | `src/features/circuitSearch/xmlPolicyParser.ts` (`parseAxwayEntityStoreXml`) | `<entity type="FilterCircuit">` with `fval` fields |
| Simplified XML | same file (`parseSimplifiedPolicyXml`) | `<Circuit>`/`<Filter>` with attributes, kept for legacy XML parser coverage \(inline tests; no on-disk scenario fixtures\) |

## Development workflow

- **Spec-driven:** specs live in `/specs` (`.cursor/rules/spec-driven-development.mdc`).
  Read the spec before implementing; update the spec first if it is unclear or wrong.
- **TDD:** write failing tests before implementation code (vitest, `npm test`).
- **Structure:** each feature lives under `src/features/<featureName>`; pure
  logic separated from the VS Code adapter so it is unit-testable without the
  VS Code API.
- **Shared services:** project discovery/scope via
  `src/features/projectRegistry` (`getProjectsInScope()` — never assume the
  workspace root is the project); circuit index and parsers via
  `src/features/circuitSearch`; navigation via
  `src/features/circuitNavigation` (`jumpToCircuit`); sidebar tool registration
  via `src/features/toolsSidebar` (`ToolsHubService.registerTool`).
- **Fixtures:** under `test/fixtures/<feature>/`; each folder is a minimal
  Policy Studio project with the appropriate marker file.

## Commands

- `npm test` — vitest suite
- `npm run compile` / `npx tsc -p ./ --noEmit` — build / type-check
