# YAML-First Policy Fixtures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert all policy-content test fixtures from XML to Axway YAML entity store, update unit tests to match, and keep only marker-only `PrimaryStore.xml` projects plus inline-string XML parser tests.

**Architecture:** In-place fixture migration — no product-code behavior changes. Each policy-content project loses `PrimaryStore.xml` / `policies/*.xml` and gains `values.yaml` + `Policies/*.yaml` (YamlES). Tests retarget paths and `projectType: 'yaml'`. XML parsers stay in `src/`; coverage moves to inline strings.

**Tech Stack:** Vitest, existing `parsePolicyYaml` / `parsePolicyXml`, Node `fs`, PowerShell/Node one-off generator for the large fixture set.

**Spec:** `docs/superpowers/specs/2026-07-09-yaml-first-fixtures-design.md`

---

## File structure (what changes)

| Area | Action |
|------|--------|
| `test/fixtures/<feature>/**` policy-content projects | Convert to YamlES; delete XML |
| `test/fixtures/monorepo/**`, `sample-policy-project` | **Do not touch** |
| `test/unit/*.test.ts` that reference converted fixtures | Update paths / projectType |
| `test/unit/axwayPolicyParser.test.ts` | Inline XML string; delete disk `axway-entity-store` |
| `test/fixtures/policy-flow/README.md` (and similar) | Drop “legacy XML scenario” tables |
| `src/**` | No behavior changes |

### YamlES template (use everywhere)

```yaml
---
meta:
  type: FilterCircuit
  _version: "4"
fields:
  name: CIRCUIT_NAME
  start: START_FILTER   # omit if no-start scenario
children:
  FILTER_NAME:
    meta:
      type: FILTER_TYPE
    fields:
      name: FILTER_NAME
      successNode: NEXT   # optional
      failureNode: FAIL   # optional
      circuit: REF        # CircuitCall / CircuitReferralFilter
      script: |           # JavaScriptFilter / GroovyFilter
        ...
      path: /x/{id}       # routing
      url: https://...
      method: GET
      attributeName: attr # SetAttribute / ChangeMessageFilter
```

### Project marker after conversion

```yaml
# values.yaml
Policies: {}
```

Plus a `Policies/` directory (create even if empty companion dirs already exist).

### Windows note

Renaming `policies` → `Policies` on case-insensitive Windows: write new files under a temp name or use `git mv` carefully (two-step rename: `policies` → `policies_tmp` → `Policies`) so git records the case change.

---

### Task 1: Inline XML parser tests; remove `axway-entity-store` disk fixture

**Files:**
- Modify: `test/unit/axwayPolicyParser.test.ts`
- Delete: `test/fixtures/circuit-search/axway-entity-store/` (entire folder)

- [ ] **Step 1: Replace disk-based XML parse test with inline string**

In `test/unit/axwayPolicyParser.test.ts`, change the first describe so it does not read a file:

```typescript
describe('parsePolicyXml (Axway entity store)', () => {
  it('extracts FilterCircuit and nested filter names from entity-store XML', () => {
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<entityStoreData xmlns="http://www.vordel.com/2005/06/24/entityStore">
  <entity type="FilterCircuit">
    <key type="FilterCircuit">
      <id field="name" value="Health Check"/>
    </key>
    <fval name="start"><value>Set Message</value></fval>
    <entity type="ChangeMessageFilter">
      <key type="ChangeMessageFilter">
        <id field="name" value="Set Message"/>
      </key>
      <fval name="body"><value>&lt;status&gt;ok&lt;/status&gt;</value></fval>
      <fval name="attributeName"><value>response.body</value></fval>
    </entity>
    <entity type="Reflector">
      <key type="Reflector">
        <id field="name" value="Reflect"/>
      </key>
    </entity>
    <entity type="CircuitReferralFilter">
      <key type="CircuitReferralFilter">
        <id field="name" value="Call Auth"/>
      </key>
      <fval name="circuit"><value>Policies/Auth/Validate Token</value></fval>
    </entity>
    <entity type="JavaScriptFilter">
      <key type="JavaScriptFilter">
        <id field="name" value="Run Script"/>
      </key>
      <fval name="script"><value>function run() { return checkHealth(); }</value></fval>
    </entity>
  </entity>
</entityStoreData>`;
    const parsed = parsePolicyXml(content);

    expect(parsed.circuits).toHaveLength(1);
    expect(parsed.circuits[0].name).toBe('Health Check');
    const filterNames = parsed.circuits[0].filters.map((filter) => filter.name).sort();
    expect(filterNames).toEqual(['Call Auth', 'Reflect', 'Run Script', 'Set Message']);
  });
});
```

- [ ] **Step 2: Retarget searchCircuits Axway XML project tests to YamlES fixture**

In the same file, remove `xmlProject` pointing at `axway-entity-store`. Keep only `yamlProject` against `axway-yaml-es`. Move assertions that needed script/`checkHealth` / `Validate Token` onto the YamlES fixture **or** add missing fields to `test/fixtures/circuit-search/axway-yaml-es/Policies/Health Check.yaml` if absent:

- Ensure Health Check.yaml has a JavaScriptFilter with `script` containing `checkHealth` and a CircuitReferralFilter with `circuit: Policies/Auth/Validate Token` (already present for Call Auth; add Run Script if missing).

Current Health Check.yaml lacks Run Script — add:

```yaml
  Run Script:
    meta:
      type: JavaScriptFilter
    fields:
      name: Run Script
      script: function run() { return checkHealth(); }
```

Update search tests to use `yamlProject` only:

```typescript
it('finds Axway filter names by search query', async () => {
  const result = await searchCircuits([yamlProject], 'Set Message');
  expect(result.results.some((r) => r.filterName === 'Set Message')).toBe(true);
});

it('finds referenced circuit from CircuitReferralFilter', async () => {
  const result = await searchCircuits([yamlProject], 'Validate Token');
  expect(result.results.some((r) => r.matchKind === 'referencedCircuit')).toBe(true);
});

it('finds script content in JavaScriptFilter', async () => {
  const result = await searchCircuits([yamlProject], 'checkHealth');
  expect(result.results.some((r) => r.matchKind === 'script')).toBe(true);
});
```

- [ ] **Step 3: Delete the disk fixture and run tests**

```bash
Remove-Item -Recurse -Force test/fixtures/circuit-search/axway-entity-store
npm test -- test/unit/axwayPolicyParser.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add test/unit/axwayPolicyParser.test.ts test/fixtures/circuit-search/axway-yaml-es
git add -u test/fixtures/circuit-search/axway-entity-store
git commit -m "Move Axway XML parser coverage to inline fixtures."
```

---

### Task 2: Convert `policy-flow` XML scenarios to YamlES

**Files:**
- Create YamlES under each of: `simple`, `branching`, `circuit-ref`, `dangling`, `no-start`, `unreachable`
- Convert or fold `axway-es` into YamlES (prefer convert in place to `axway-es/Policies/Health Check.yaml` + `values.yaml`, delete `PrimaryStore.xml`)
- Modify: `test/unit/policyFlow.test.ts`
- Modify: `test/fixtures/policy-flow/README.md`

**Skip if already covered:** `yaml-es/` already has Order/Unreachable/Dangling/No Start/Delegate/Auth — keep it. Convert the XML folders so XML-named tests can retarget OR delete XML folders and point all tests at `yaml-es/`. **Preferred (per spec in-place convert):** convert each XML folder so existing fixture names stay meaningful; then change `loadXmlCircuit` call sites to `loadYamlCircuit`.

- [ ] **Step 1: Convert `simple`**

Delete `PrimaryStore.xml` and `policies/SimplePolicy.xml`. Create:

`test/fixtures/policy-flow/simple/values.yaml`:
```yaml
Policies: {}
```

`test/fixtures/policy-flow/simple/Policies/SimplePolicy.yaml`:
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

On Windows, remove old `policies` dir after writing `Policies`.

- [ ] **Step 2: Convert remaining policy-flow XML folders the same way**

Preserve circuit/filter names and topology from each XML file:

| Folder | Circuit file → |
|--------|----------------|
| `branching` | `Policies/BranchingPolicy.yaml` (Validate success→Respond, failure→HandleError) |
| `circuit-ref` | `Policies/CallerPolicy.yaml` + `Policies/AuthPolicy.yaml` (`fields.circuit` for referral) |
| `dangling` | `Policies/DanglingPolicy.yaml` (successNode Ghost) |
| `no-start` | `Policies/NoStartPolicy.yaml` (omit `fields.start`) |
| `unreachable` | `Policies/UnreachablePolicy.yaml` (Orphan unused) |
| `axway-es` | `Policies/Health Check.yaml` matching prior FilterCircuit content |

Each gets `values.yaml` with `Policies: {}`. Delete all `PrimaryStore.xml` and old `policies/*.xml`.

- [ ] **Step 3: Update `policyFlow.test.ts`**

Remove `loadXmlCircuit`. Change every former XML call to `loadYamlCircuit` with new paths, e.g.:

```typescript
const { circuits } = await loadYamlCircuit('simple', 'Policies/SimplePolicy.yaml');
```

For `axway-es`:
```typescript
const { content, circuits } = await loadYamlCircuit('axway-es', 'Policies/Health Check.yaml');
```

Any test that called `parsePolicyXml` on fixture content should call `parsePolicyYaml` instead (except intentional inline XML `./` prefix tests that already use string literals).

- [ ] **Step 4: Update README**

Rewrite `test/fixtures/policy-flow/README.md` so all scenarios are listed as YamlES folders; remove the “Legacy (XML)” table.

- [ ] **Step 5: Run tests and commit**

```bash
npm test -- test/unit/policyFlow.test.ts
git add test/fixtures/policy-flow test/unit/policyFlow.test.ts
git commit -m "Convert policy-flow fixtures from XML to YamlES."
```

Expected: PASS

---

### Task 3: Convert `policy-diff` XML fixtures

**Files:**
- Convert: `added-removed`, `baseline`, `changed-circuit`, `formatting-only`, `invalid`, `routing-url`
- Leave: `formatting-only-yaml-baseline`, `formatting-only-yaml-reformatted` (already YAML)
- Modify: `test/unit/policyDiff.test.ts`

- [ ] **Step 1: Convert each XML policy-diff project**

For each folder above:
1. Read existing `policies/*.xml` content (names, types, paths, urls, scripts).
2. Write equivalent `Policies/*.yaml` YamlES files (see existing `formatting-only-yaml-baseline/Policies/Order API.yaml` for HTTPRouting shape).
3. Add `values.yaml` with `Policies: {}`.
4. Delete `PrimaryStore.xml` and old `policies/` XML files.

For `invalid/policies/BrokenPolicy.xml` (intentionally truncated), create `Policies/BrokenPolicy.yaml` that is intentionally invalid YAML, e.g.:

```yaml
---
meta:
  type: FilterCircuit
fields:
  name: BrokenPolicy
children:
  Unclosed:
    meta:
      type: Check
    fields:
      name: "Unclosed
```

Keep a valid sibling `OrderAPI.yaml` so the suite still has one good file.

- [ ] **Step 2: Update assertions in `policyDiff.test.ts`**

Replace extensions/paths:

```typescript
expect(report.unparseableRight).toContain('Policies/BrokenPolicy.yaml');
```

Any project helpers that set `projectType: 'xml'` for these fixtures → `'yaml'`.

- [ ] **Step 3: Run tests and commit**

```bash
npm test -- test/unit/policyDiff.test.ts
git add test/fixtures/policy-diff test/unit/policyDiff.test.ts
git commit -m "Convert policy-diff fixtures from XML to YamlES."
```

---

### Task 4: Convert `circuit-graph` fixtures

**Files:**
- Convert: `cycle`, `entry-points`, `linear`, `missing-ref`
- Modify: `test/unit/circuitGraph.test.ts`

- [ ] **Step 1: Convert each graph fixture**

Example for cycle `CircuitB` (CircuitCall → CircuitA):

```yaml
---
meta:
  type: FilterCircuit
  _version: "4"
fields:
  name: CircuitB
  start: CallA
children:
  CallA:
    meta:
      type: CircuitCall
    fields:
      name: CallA
      circuit: CircuitA
```

Mirror all other circuits with same names. Add `values.yaml`; delete XML markers/policies.

- [ ] **Step 2: Update `circuitGraph.test.ts`**

```typescript
projectType: 'yaml',
// ...
expect(circuitA?.definitionPaths[0]?.filePath).toContain('CircuitA.yaml');
```

- [ ] **Step 3: Run tests and commit**

```bash
npm test -- test/unit/circuitGraph.test.ts
git add test/fixtures/circuit-graph test/unit/circuitGraph.test.ts
git commit -m "Convert circuit-graph fixtures from XML to YamlES."
```

---

### Task 5: Convert `jump-to-circuit` fixtures

**Files:**
- Convert: `duplicates`, `missing`, `references`, `unique`
- Modify: `test/unit/circuitNavigation.test.ts`

- [ ] **Step 1: Convert fixtures** (same pattern: `Policies/*.yaml` + `values.yaml`, delete XML). Preserve circuit names (`PaymentService`, `SharedAuth`, `CircuitA/B/C`, `Caller`).

- [ ] **Step 2: Update `circuitNavigation.test.ts`**

Replace every `.xml` path expectation and `policies/` segment with `.yaml` / `Policies/`. Set `projectType: 'yaml'`. Update manual-verification comments at bottom of file.

- [ ] **Step 3: Run tests and commit**

```bash
npm test -- test/unit/circuitNavigation.test.ts
git add test/fixtures/jump-to-circuit test/unit/circuitNavigation.test.ts
git commit -m "Convert jump-to-circuit fixtures from XML to YamlES."
```

---

### Task 6: Convert `export-documentation` fixtures

**Files:**
- Convert: `attributes`, `invalid`, `minimal`, `multi-circuit`, `scripts`
- Leave: `yaml-project` (already YAML)
- Modify: `test/unit/exportDocumentation.test.ts`

- [ ] **Step 1: Convert fixtures** preserving scripts (ScriptCircuit short/long), attributes, multi-circuit refs, BrokenPolicy invalid YAML.

- [ ] **Step 2: Update test defaults**

```typescript
projectType: 'yaml',
// buildModel default:
async function buildModel(fixture: string, projectType: 'xml' | 'yaml' = 'yaml') {
```

Update path assertions:

```typescript
expect(model.circuits[0].sourceFilePath).toContain('OrderAPI.yaml');
expect(markdown).toContain('`Policies/CallerCircuit.yaml`');
expect(invalid).toContain('BrokenPolicy.yaml');
```

- [ ] **Step 3: Run tests and commit**

```bash
npm test -- test/unit/exportDocumentation.test.ts
git add test/fixtures/export-documentation test/unit/exportDocumentation.test.ts
git commit -m "Convert export-documentation fixtures from XML to YamlES."
```

---

### Task 7: Convert remaining `circuit-search` small fixtures

**Files:**
- Convert: `minimal`, `ambiguous-names`
- Replace: `invalid-xml` → `invalid-yaml`
- Modify: `test/unit/circuitSearch.test.ts`
- Delete leftover XML under `path-template-validator` if still present (`valid/PrimaryStore.xml`, `non-routing/Policies/NonRouting.xml`) — those folders already have YamlES; remove XML only and fix tests

- [ ] **Step 1: Convert `minimal` and `ambiguous-names`**

`minimal`: PaymentService / AuthCircuit / OrderAPI → YamlES under `Policies/`, with PaymentService script `validateCard` and `circuit: AuthCircuit`.

`ambiguous-names`: keep `team-a/SharedAuth.yaml` and `team-b/SharedAuth.yaml` (same relative layout, just `.yaml` + root `values.yaml`).

- [ ] **Step 2: Replace `invalid-xml` with `invalid-yaml`**

Structure:
```
invalid-yaml/
  values.yaml
  broken/BadPolicy.yaml   # intentionally broken
  valid/GoodPolicy.yaml   # valid YamlES with filter BrokenFilter name only in broken file's searchable text — preserve test intent: GoodPolicy valid, BadPolicy unparseable but search still surfaces something from broken file if that's current behavior
```

Read current `circuitSearch.test.ts` invalid-xml expectations before writing — preserve behavior (e.g. matchPreview includes `BrokenFilter`). If broken YAML cannot contribute filter names, adjust the test to assert unparseable/warning behavior consistent with YAML parsing (document the assertion change in the commit message).

- [ ] **Step 3: Update `circuitSearch.test.ts`**

- `projectType: 'yaml'` for converted projects
- Paths: `PaymentService.yaml`, `invalid-yaml`, etc.
- Multi-project test: both projects can be YAML (`minimal` + `yaml-project`)

- [ ] **Step 4: Clean path-template XML leftovers**

Delete `test/fixtures/path-template-validator/valid/PrimaryStore.xml` and `non-routing/Policies/NonRouting.xml` if present.

Update `test/unit/pathTemplateValidator.test.ts` to read YamlES only:

```typescript
const content = await readFixture('valid/Policies/ValidRouting.yaml');
// ...
analyzePathTemplatesInContent(content, 'Policies/ValidRouting.yaml')
```

Remove any test that still opens `PrimaryStore.xml` / `NonRouting.xml`.

- [ ] **Step 5: Run tests and commit**

```bash
npm test -- test/unit/circuitSearch.test.ts test/unit/pathTemplateValidator.test.ts
git add test/fixtures/circuit-search test/fixtures/path-template-validator test/unit/circuitSearch.test.ts test/unit/pathTemplateValidator.test.ts
git commit -m "Convert circuit-search and path-template fixtures to YamlES."
```

---

### Task 8: Regenerate `circuit-search/large` as YamlES

**Files:**
- Modify: `test/unit/circuitSearch.test.ts` (`beforeAll` generator)
- Replace on-disk: `test/fixtures/circuit-search/large/**`

- [ ] **Step 1: Update the `beforeAll` generator**

```typescript
beforeAll(async () => {
  const fs = await import('fs/promises');
  await fs.mkdir(path.join(largeDir, 'Policies'), { recursive: true });
  await fs.writeFile(path.join(largeDir, 'values.yaml'), 'Policies: {}\n');

  for (let i = 0; i < 500; i++) {
    const filePath = path.join(largeDir, 'Policies', `Circuit${i}.yaml`);
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(
        filePath,
        `---
meta:
  type: FilterCircuit
  _version: "4"
fields:
  name: PerfCircuit${i}
  start: Filter${i}
children:
  Filter${i}:
    meta:
      type: SetAttribute
    fields:
      name: Filter${i}
      attributeName: attr${i}
`,
      );
    }
  }
});
```

Use `yamlProject('large', largeDir)` instead of `xmlProject`.

- [ ] **Step 2: Delete old XML large fixtures**

```bash
Remove-Item -Recurse -Force test/fixtures/circuit-search/large/policies -ErrorAction SilentlyContinue
Remove-Item -Force test/fixtures/circuit-search/large/PrimaryStore.xml -ErrorAction SilentlyContinue
```

Optionally pre-generate the 500 YAML files once so CI does not rely only on `beforeAll` (current pattern already generates on first run — keep that pattern).

- [ ] **Step 3: Run performance test and commit**

```bash
npm test -- test/unit/circuitSearch.test.ts
git add test/fixtures/circuit-search/large test/unit/circuitSearch.test.ts
git commit -m "Regenerate large circuit-search fixture as YamlES."
```

---

### Task 9: Sweep leftovers and docs; full suite

**Files:**
- Modify if needed: `test/unit/toolsSidebar.test.ts` (only if it pointed at a converted fixture — marker-only XML is fine)
- Modify: `AGENTS.md` only if it claims fixtures are XML-first for scenarios
- Grep for leftover policy-content XML references

- [ ] **Step 1: Grep for stragglers**

```bash
rg -n "PrimaryStore\.xml|\.xml|projectType: 'xml'|invalid-xml|axway-entity-store|loadXmlCircuit|policies/" test/unit test/fixtures --glob '!monorepo/**' --glob '!sample-policy-project/**'
```

Expected remaining XML hits: monorepo markers, `sample-policy-project`, inline XML strings in parser tests, possibly `discoverProjects`/`projectScope`/`detectPolicyStudioProject` marker tests.

- [ ] **Step 2: Confirm marker-only projects untouched**

```bash
# These must still exist:
Test-Path test/fixtures/sample-policy-project/PrimaryStore.xml
Test-Path test/fixtures/monorepo/two-projects/services/a/PrimaryStore.xml
```

- [ ] **Step 3: Run full suite**

```bash
npm test
npx tsc -p ./ --noEmit
```

Expected: all green.

- [ ] **Step 4: Final commit if any doc/sweep fixes remain**

```bash
git add -A
git commit -m "Finish YAML-first fixture migration sweep."
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Convert all policy-content fixtures to YamlES | 2–8 |
| Keep marker-only PrimaryStore.xml | 9 (verify) |
| Inline XML parser tests; delete axway-entity-store | 1 |
| Replace invalid-xml with invalid-yaml | 7 |
| Convert/fold policy-flow/axway-es | 2 |
| path-template valid PrimaryStore → YamlES | 7 |
| Regenerate circuit-search/large | 8 |
| Update unit tests / READMEs | 2–9 |
| No product behavior changes | all (fixtures/tests only) |
| `npm test` green | 9 |

## Out of scope (do not do)

- Removing `xmlPolicyParser.ts`
- Converting monorepo / sample-policy-project markers
- Dual XML+YAML copies of the same scenario
