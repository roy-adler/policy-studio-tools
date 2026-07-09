# Design: YAML-first policy fixtures

Date: 2026-07-09

## Goal

Make Axway YAML entity store the default format for all **policy-content** test fixtures. Drop on-disk XML policy fixtures. Keep XML support in production code and keep marker-only XML projects for project-detection coverage.

## Decisions (locked)

1. **Convert all policy-content fixtures to YAML** — no parallel XML copies for the same scenarios.
2. **Keep marker-only `PrimaryStore.xml` projects** — monorepo detection fixtures and `sample-policy-project` stay XML markers with no policy files.
3. **Dialect: Axway YAML entity store** (`meta.type: FilterCircuit`, `fields`, `children`) — not legacy simple YAML (`filters:` list), except where a fixture already exists specifically for that dialect.
4. **Approach: in-place convert** — replace XML policy projects with YAML equivalents in one pass; update tests to match.

## Non-goals

- Removing or weakening XML parsers in `src/`.
- Changing product feature behaviour (search, diff, flow, graph, export, etc.).
- Converting marker-only monorepo / sample XML projects to YAML.
- Requiring dual-format fixture coverage for every scenario.

## Current state

- ~593 XML files under `test/fixtures`; ~41 `PrimaryStore.xml` project roots.
- ~11 existing YAML projects (`values.yaml` + `Policies/`).
- Policy-content XML projects (~30) drive feature tests via hardcoded `.xml` paths and `projectType: 'xml'`.
- Marker-only XML projects (~10) exist only so discovery/detection still sees `PrimaryStore.xml`.

## Target state

### Policy-content projects

Each converted project:

| Before | After |
|--------|--------|
| `PrimaryStore.xml` | deleted |
| `policies/*.xml` or contentful `PrimaryStore.xml` | `Policies/*.yaml` (Axway ES) |
| (no values file) | `values.yaml` with `Policies: {}` (or equivalent minimal marker) |

Project type in tests: `projectType: 'yaml'`.

### Marker-only projects (unchanged)

Leave as-is with empty/minimal `PrimaryStore.xml`:

- `test/fixtures/monorepo/**` (all marker-only roots)
- `test/fixtures/sample-policy-project`

### XML-only fixtures to remove / replace

| Fixture | Action |
|---------|--------|
| `circuit-search/axway-entity-store` | Delete on-disk XML; keep XML parser coverage via **inline string** in unit tests |
| `circuit-search/invalid-xml` | Replace with `invalid-yaml` (intentionally broken YAML) and update tests |
| `policy-flow/axway-es` | Convert to YamlES under `Policies/` (or fold into existing `policy-flow/yaml-es` and retarget tests) |
| `path-template-validator/valid` (contentful PrimaryStore) | Split into YamlES policy file(s) under `Policies/` |

### Large fixture set

`circuit-search/large` (~500 circuits): regenerate with a one-off script into matching YamlES stubs (`Policies/CircuitN.yaml` + `values.yaml`), then delete XML.

## Conversion mapping

| XML concept | YamlES |
|-------------|--------|
| `<Circuit name="X" start="A">` / FilterCircuit entity | `meta.type: FilterCircuit`, `fields.name`, `fields.start` |
| Filter `name` / `type` / `successNode` / `failureNode` | `children.<name>.meta.type`, `fields.*` |
| Circuit referral / `circuitName` | `fields.circuit` |
| Script body | Script field under filter `fields` (match existing YamlES fixtures) |
| Circuit/filter **names and graph topology** | Unchanged so assertions stay stable |

Example shape (matches existing `circuit-search/axway-yaml-es` / `policy-flow/yaml-es`):

```yaml
---
meta:
  type: FilterCircuit
  _version: "4"
fields:
  name: SimplePolicy
  start: Validate
children:
  Validate:
    meta:
      type: Check
    fields:
      name: Validate
      successNode: Transform
  Transform:
    meta:
      type: ChangeMessage
    fields:
      name: Transform
      successNode: Respond
  Respond:
    meta:
      type: Reflector
    fields:
      name: Respond
```

## Test updates

- Retarget paths: `*.xml` → `Policies/*.yaml`; drop `PrimaryStore.xml` references for converted projects.
- Change `projectType: 'xml'` → `'yaml'` where fixtures were converted.
- Replace helpers like `loadXmlCircuit` with YAML loaders (or a format-agnostic loader) for converted suites.
- Keep **minimal inline-string** tests for `parsePolicyXml` / Axway entity-store XML so legacy parsing remains verified without on-disk XML policy projects.
- Update fixture READMEs that claim XML-first scenario coverage.
- Light-touch product specs under `/specs` only if they assert fixture paths or “XML fixtures” as the primary scenario source; behaviour specs stay the same.

## Verification

- `npm test` passes.
- Marker-only monorepo fixtures still detect as XML projects.
- Converted scenario fixtures detect as YAML projects and produce the same domain-model assertions (circuit names, filter graphs, search hits, etc.).

## Risks

- **Large diff** (`circuit-search/large`): mitigate with a generator script and a single focused commit for that tree.
- **Path case / directory rename** (`policies` → `Policies`): Windows is case-insensitive; ensure git and tests use the Axway-style `Policies/` name consistently.
- **Contentful PrimaryStore.xml** (multiple circuits in one file): split carefully so circuit names and refs stay correct.
- **Invalid fixture semantics**: “unparseable” tests must assert YAML parse failure, not XML.

## Implementation order (high level)

1. Add/adjust inline XML parser unit tests; remove dependency on `axway-entity-store` disk fixture.
2. Convert small feature fixture trees (policy-flow, policy-diff, circuit-graph, jump-to-circuit, export-documentation, path-template, circuit-search minimal/ambiguous/invalid).
3. Regenerate `circuit-search/large` as YamlES.
4. Update all unit tests and fixture docs.
5. Run full test suite; fix stragglers.
