# KPS List Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit `java.util.List` KPS cells as real JSON arrays of scalars, warned on element-type mismatch, never saved as a string that looks like an array.

**Architecture:** The Type Group marks a column as `list` and stores the element type from `fields.value`. Load promotes a flat scalar array onto the cell (and out of the non-scalar bag). Commit parses the text field with `JSON.parse` and stores that array unchanged. Save already JSON-stringifies cell values; an editable array on the cell wins over a stale extra copy.

**Tech Stack:** TypeScript, Vitest, existing `src/features/kpsEditor/` model (no new VS Code API).

**Spec:** `specs/012-kps-editor.md`  
**Design:** `docs/superpowers/specs/2026-09-22-kps-list-editor-design.md`

## Global Constraints

- `fields.type` of `java.util.List` or `List` is a list column. `fields.value` is the element type, mapped with the same Java scalar rules as other columns.
- No coercion of list elements. `[3,5]` stays numbers. `["3","5"]` stays strings.
- A known element type that does not match (including `null`, and a non-integer in an integer list) keeps the parsed array, warns on the cell, and marks the stage dirty. An integer in a `Double`/`Float`/`Number` list matches.
- Invalid JSON, a non-array, or an array containing an object or nested array keeps the previous value, does not mark dirty, and shows the banner warning.
- Missing or unknown `fields.value` still edits as a list, warns once at schema load, and does not check elements.
- A new row and a missing list property default to `[]`.
- A loaded scalar in a list column (including a string that looks like an array) is not converted on load or Save until the user commits text that parses as a flat scalar array.
- Nested objects, and arrays that are not a flat list on a list column, stay non-editable.
- Save stays pretty-printed JSON with 4-space indent and no trailing newline after `]`.

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/features/kpsEditor/types.ts` | Add `list` column type, scalar-column type, and array cell values |
| `src/features/kpsEditor/kpsTypeSchema.ts` | Map `java.util.List`, read `fields.value`, parse list text, check element types |
| `src/features/kpsEditor/kpsTableModel.ts` | Promote flat lists on load; warn; default `[]` |
| `src/features/kpsEditor/loadKpsSession.ts` | Pass element types into the session |
| `src/features/kpsEditor/kpsTableMutations.ts` | Commit list text without coercion |
| `src/features/kpsEditor/kpsTableWriter.ts` | Prefer an editable array cell over `row.extra` |
| `src/features/kpsEditor/kpsPanelHtml.ts` | Show a list as `JSON.stringify` |
| `test/unit/kpsEditor.test.ts` | Schema, load, edit, write-back, and HTML tests |

No new source file. List rules stay next to the existing column-type code.

---

### Task 1: List column type from the Type Group

**Files:**
- Modify: `src/features/kpsEditor/types.ts`
- Modify: `src/features/kpsEditor/kpsTypeSchema.ts`
- Modify: `src/features/kpsEditor/kpsTableModel.ts` (store `listElementTypes` only)
- Modify: `src/features/kpsEditor/loadKpsSession.ts`
- Test: `test/unit/kpsEditor.test.ts`

**Interfaces:**
- Consumes: `loadKpsTypeSchemas(projectRoot: string)`, `parseMappingYaml` via the existing schema loader
- Produces:
  - `KpsScalarColumnType = 'string' | 'boolean' | 'integer' | 'number'`
  - `KpsColumnType = KpsScalarColumnType | 'list'`
  - `KpsValue = KpsScalar | KpsScalar[]`
  - `KpsCell.value?: KpsValue`
  - `KpsTableModel.listElementTypes: Record<string, KpsScalarColumnType>`
  - `KpsTypeSchemaLoad.listElementTypesByTable: Record<string, Record<string, KpsScalarColumnType>>`
  - `mapJavaScalarType(javaType: string): { type: KpsScalarColumnType; unknown: boolean }`
  - `mapJavaTypeToColumnType` returns `{ type: 'list', unknown: false }` for `java.util.List` and `List`

- [ ] **Step 1: Write the failing schema test**

Append this inside `describe('kps type schema')` in `test/unit/kpsEditor.test.ts`:

```typescript
it('maps java.util.List and its fields.value element type', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-list-schema-'));
  const typeDir = path.join(
    tmp,
    'Environment Configuration',
    'Key Property Stores',
    'JWT_Collection',
    'Type Group',
  );
  const storeDir = path.join(
    tmp,
    'Environment Configuration',
    'Key Property Stores',
    'JWT_Collection',
    'Store Group',
  );
  fs.mkdirSync(typeDir, { recursive: true });
  fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(
    path.join(typeDir, 'Tags.yaml'),
    `---
type: KPSType
fields:
  name: Tags
children:
- type: KPSTypeProperty
  fields:
    name: codes
    type: java.util.List
    key: ""
    value: java.lang.Integer
- type: KPSTypeProperty
  fields:
    name: labels
    type: List
    key: ""
    value: java.lang.String
- type: KPSTypeProperty
  fields:
    name: unchecked
    type: java.util.List
    key: ""
    value: ""
- type: KPSTypeProperty
  fields:
    name: custom
    type: java.util.List
    key: ""
    value: com.example.Widget
`,
  );
  fs.writeFileSync(
    path.join(storeDir, 'Tags.yaml'),
    `---
type: KPSReadWriteStore
fields:
  aliases: T_Tags
  type: Environment Configuration/Key Property Stores/JWT_Collection/Type Group/Tags.yaml
`,
  );

  const schema = loadKpsTypeSchemas(tmp);
  expect(schema.columnTypesByTable['T_Tags.json']).toEqual({
    codes: 'list',
    labels: 'list',
    unchecked: 'list',
    custom: 'list',
  });
  expect(schema.listElementTypesByTable['T_Tags.json']).toEqual({
    codes: 'integer',
    labels: 'string',
  });
  expect(schema.schemaColumnsByTable['T_Tags.json']).toEqual([
    'codes',
    'labels',
    'unchecked',
    'custom',
  ]);
  expect(schema.warnings.some((warning) => warning.includes('unchecked'))).toBe(true);
  expect(schema.warnings.some((warning) => warning.includes('com.example.Widget'))).toBe(true);
  expect(schema.warnings.some((warning) => /treating as string/i.test(warning))).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/kpsEditor.test.ts -t "maps java.util.List"`

Expected: FAIL because `listElementTypesByTable` is missing and `java.util.List` is not a column type.

- [ ] **Step 3: Implement schema mapping**

In `src/features/kpsEditor/types.ts`, replace the column and cell value types:

```typescript
export type KpsScalarColumnType = 'string' | 'boolean' | 'integer' | 'number';
export type KpsColumnType = KpsScalarColumnType | 'list';
export type KpsScalar = string | number | boolean | null;
export type KpsValue = KpsScalar | KpsScalar[];
```

Change `KpsCell.value` to `value?: KpsValue`.

Add to `KpsTableModel`:

```typescript
listElementTypes: Record<string, KpsScalarColumnType>;
```

In `kpsTypeSchema.ts`, add `listElementTypesByTable` to `KpsTypeSchemaLoad`. Split scalar mapping out of `mapJavaTypeToColumnType` and recognize lists before the unknown-type fallback:

```typescript
export function mapJavaScalarType(javaType: string): {
  type: KpsScalarColumnType;
  unknown: boolean;
} {
  const normalized = javaType.trim();
  const short = normalized.replace(/^java\.lang\./, '');

  if (short === 'String') {
    return { type: 'string', unknown: false };
  }
  if (short === 'Boolean') {
    return { type: 'boolean', unknown: false };
  }
  if (short === 'Integer' || short === 'Long' || short === 'Short' || short === 'Byte') {
    return { type: 'integer', unknown: false };
  }
  if (short === 'Double' || short === 'Float' || short === 'Number') {
    return { type: 'number', unknown: false };
  }

  return { type: 'string', unknown: true };
}

export function mapJavaTypeToColumnType(javaType: string): {
  type: KpsColumnType;
  unknown: boolean;
} {
  const normalized = javaType.trim();
  if (normalized === 'java.util.List' || normalized === 'List') {
    return { type: 'list', unknown: false };
  }
  return mapJavaScalarType(normalized);
}
```

Change `parseTypeGroupProperties` so it also returns `listElementTypes: Record<string, KpsScalarColumnType>`. Inside the property loop, when `mapped.type === 'list'`, do not emit the "treating as string" warning. Read `fields.value`:

```typescript
const listElementTypes: Record<string, KpsScalarColumnType> = {};
// ...
if (mapped.type === 'list') {
  const elementType = typeof fields.value === 'string' ? fields.value.trim() : '';
  if (!elementType) {
    warnings.push(
      `List property "${fields.name}" in ${path.basename(typeGroupPath)} has no element type; elements will not be checked`,
    );
  } else {
    const element = mapJavaScalarType(elementType);
    if (element.unknown) {
      warnings.push(
        `Unknown list element type "${elementType}" for "${fields.name}" in ${path.basename(typeGroupPath)}; elements will not be checked`,
      );
    } else {
      listElementTypes[fields.name] = element.type;
    }
  }
} else if (mapped.unknown) {
  warnings.push(
    `Unknown Type Group type "${fields.type}" for "${fields.name}" in ${path.basename(typeGroupPath)}; treating as string`,
  );
}
```

Return `{ columns, columnTypes, listElementTypes }` from every exit of `parseTypeGroupProperties` (empty object on the early returns). In `loadKpsTypeSchemas`, set `listElementTypesByTable[tableName] = parsedType.listElementTypes`.

In `buildKpsSession`, add a last parameter:

```typescript
listElementTypesByTable: Record<string, Record<string, KpsScalarColumnType>> = {},
```

Set `listElementTypes: listElementTypesByTable[tableName] ?? {}` on each table. In `loadKpsSession`, pass `schema.listElementTypesByTable`, and include `listElementTypesByTable: {}` in the empty-schema fallback.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/kpsEditor.test.ts`

Expected: PASS, including the existing Routes column-type test.

- [ ] **Step 5: Commit**

```bash
git add src/features/kpsEditor/types.ts src/features/kpsEditor/kpsTypeSchema.ts src/features/kpsEditor/kpsTableModel.ts src/features/kpsEditor/loadKpsSession.ts test/unit/kpsEditor.test.ts
git commit -m "feat: map java.util.List columns from the KPS Type Group"
```

---

### Task 2: Load flat lists onto editable cells

**Files:**
- Modify: `src/features/kpsEditor/kpsTypeSchema.ts`
- Modify: `src/features/kpsEditor/kpsTableModel.ts`
- Test: `test/unit/kpsEditor.test.ts`

**Interfaces:**
- Consumes: `KpsColumnType`, `KpsScalarColumnType`, `KpsScalar`, `listElementTypes` on the table from Task 1
- Produces:
  - `listElementMismatch(values: KpsScalar[], elementType: KpsScalarColumnType | undefined): string | undefined`
  - `defaultValueForColumnType('list')` returns `[]`
  - Load behavior: a flat scalar array on a list column is `cell.value`, `editable: true`, and absent from `row.extra`

- [ ] **Step 1: Write the failing load tests**

Add this helper at the bottom of the import/setup area of `test/unit/kpsEditor.test.ts` (above the first `describe`):

```typescript
function writeTagsBundle(
  root: string,
  elementType: string,
  rows: unknown[],
): { kpsRoot: string } {
  const policyRoot = path.join(root, 'POLICY_yaml');
  const typeDir = path.join(
    policyRoot,
    'Environment Configuration',
    'Key Property Stores',
    'JWT_Collection',
    'Type Group',
  );
  const storeDir = path.join(
    policyRoot,
    'Environment Configuration',
    'Key Property Stores',
    'JWT_Collection',
    'Store Group',
  );
  fs.mkdirSync(typeDir, { recursive: true });
  fs.mkdirSync(storeDir, { recursive: true });
  fs.mkdirSync(path.join(policyRoot, 'Policies'), { recursive: true });
  fs.writeFileSync(path.join(policyRoot, 'values.yaml'), '---\n');
  fs.writeFileSync(
    path.join(typeDir, 'Tags.yaml'),
    `---
type: KPSType
fields:
  name: Tags
children:
- type: KPSTypeProperty
  fields:
    name: name
    type: java.lang.String
    key: ""
    value: ""
- type: KPSTypeProperty
  fields:
    name: codes
    type: java.util.List
    key: ""
    value: ${elementType}
`,
  );
  fs.writeFileSync(
    path.join(storeDir, 'Tags.yaml'),
    `---
type: KPSReadWriteStore
fields:
  aliases: T_Tags
  type: Environment Configuration/Key Property Stores/JWT_Collection/Type Group/Tags.yaml
`,
  );
  const stageDir = path.join(root, 'KPS', 'DEVL');
  fs.mkdirSync(stageDir, { recursive: true });
  fs.writeFileSync(path.join(stageDir, 'T_Tags.json'), JSON.stringify(rows));
  return { kpsRoot: path.join(root, 'KPS') };
}
```

Append these tests inside `describe('kps type schema')`:

```typescript
it('loads a flat list as an editable array and warns on element mismatch', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-list-load-'));
  const { kpsRoot: tagsKps } = writeTagsBundle(tmp, 'java.lang.Integer', [
    { name: 'row', codes: [3, 5] },
    { name: 'bad', codes: [3, '5'] },
    { name: 'text', codes: '[3,5]' },
    { name: 'deep', codes: [{ nested: true }] },
  ]);

  const session = loadKpsSession(tagsKps);
  const rows = session.tables['T_Tags.json'].stages.DEVL.rows;

  expect(rows[0].cells.codes?.editable).toBe(true);
  expect(rows[0].cells.codes?.value).toEqual([3, 5]);
  expect(rows[0].extra.codes).toBeUndefined();
  expect(rows[0].cells.codes?.warning).toBeUndefined();

  expect(rows[1].cells.codes?.value).toEqual([3, '5']);
  expect(rows[1].cells.codes?.warning).toBe('List element is not a valid integer');
  expect(
    session.warnings.some((warning) => warning.includes('codes') && warning.includes('integer list')),
  ).toBe(true);

  expect(rows[2].cells.codes?.editable).toBe(true);
  expect(rows[2].cells.codes?.value).toBe('[3,5]');
  expect(rows[2].cells.codes?.warning).toBe('Value is not a list');

  expect(rows[3].cells.codes?.editable).toBe(false);
  expect(rows[3].extra.codes).toEqual([{ nested: true }]);
});

it('fills a missing list property with an empty array', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-list-missing-'));
  const { kpsRoot: tagsKps } = writeTagsBundle(tmp, 'java.lang.String', [{ name: 'only-name' }]);
  const session = loadKpsSession(tagsKps);
  const cell = session.tables['T_Tags.json'].stages.DEVL.rows[0].cells.codes;
  expect(cell?.value).toEqual([]);
  expect(cell?.editable).toBe(true);
});

it('keeps a JSON array locked when the column is not a list', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-list-locked-'));
  const { kpsRoot: tagsKps } = writeTagsBundle(tmp, 'java.lang.String', [
    { name: ['not-a-list-column'] },
  ]);
  const session = loadKpsSession(tagsKps);
  const cell = session.tables['T_Tags.json'].stages.DEVL.rows[0].cells.name;
  expect(cell?.editable).toBe(false);
  expect(session.tables['T_Tags.json'].stages.DEVL.rows[0].extra.name).toEqual([
    'not-a-list-column',
  ]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/kpsEditor.test.ts -t "flat list"`

Expected: FAIL because the array stays non-editable in `extra`.

- [ ] **Step 3: Promote list columns on load**

Add to `kpsTypeSchema.ts`:

```typescript
export function listElementMismatch(
  values: KpsScalar[],
  elementType: KpsScalarColumnType | undefined,
): string | undefined {
  if (!elementType) {
    return undefined;
  }
  const matches = values.every((value) => scalarMatchesElementType(value, elementType));
  if (matches) {
    return undefined;
  }
  return `List element is not a valid ${elementType}`;
}

function scalarMatchesElementType(value: KpsScalar, elementType: KpsScalarColumnType): boolean {
  if (value === null) {
    return false;
  }
  if (elementType === 'string') {
    return typeof value === 'string';
  }
  if (elementType === 'boolean') {
    return typeof value === 'boolean';
  }
  if (elementType === 'integer') {
    return typeof value === 'number' && Number.isInteger(value);
  }
  return typeof value === 'number' && Number.isFinite(value);
}
```

Change `defaultValueForColumnType` so a list returns `[]` (return type `KpsValue`):

```typescript
export function defaultValueForColumnType(columnType: KpsColumnType | undefined): KpsValue {
  if (columnType === 'boolean') {
    return false;
  }
  if (columnType === 'integer' || columnType === 'number') {
    return 0;
  }
  if (columnType === 'list') {
    return [];
  }
  return '';
}
```

In `applyColumnTypes`, take `listElementTypes: Record<string, KpsScalarColumnType>` and handle lists before scalar coercion. Pass `listElementTypes` from `buildKpsSession`.

```typescript
if (columnType === 'list') {
  const cell = row.cells[column];
  if (!cell) {
    continue;
  }
  if (Array.isArray(cell.nested) && cell.nested.every(isScalar)) {
    cell.editable = true;
    cell.value = cell.nested as KpsScalar[];
    cell.nested = undefined;
    delete row.extra[column];
    const elementType = listElementTypes[column];
    const mismatch = listElementMismatch(cell.value, elementType);
    if (mismatch) {
      cell.warning = mismatch;
      warnings.push(
        `Could not coerce ${tableName} ${stageId} column "${column}" to ${elementType} list`,
      );
    }
    continue;
  }
  if (cell.nested !== undefined) {
    continue;
  }
  if (cell.editable && !Array.isArray(cell.value)) {
    cell.warning = cell.warning ?? 'Value is not a list';
    warnings.push(`Could not coerce ${tableName} ${stageId} column "${column}" to list`);
  }
  continue;
}
```

`isScalar` already exists in `kpsTableModel.ts`. Do not run `coerceLoadedScalar` for `columnType === 'list'`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/unit/kpsEditor.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/kpsEditor/kpsTypeSchema.ts src/features/kpsEditor/kpsTableModel.ts test/unit/kpsEditor.test.ts
git commit -m "feat: load KPS list columns as editable JSON arrays"
```

---

### Task 3: Commit list text without coercing elements

**Files:**
- Modify: `src/features/kpsEditor/kpsTypeSchema.ts`
- Modify: `src/features/kpsEditor/kpsTableMutations.ts`
- Test: `test/unit/kpsEditor.test.ts`

**Interfaces:**
- Consumes: `listElementMismatch`, `defaultValueForColumnType`, `KpsTableModel.listElementTypes` from Tasks 1–2
- Produces: `parseListInput(text: string): { ok: true; value: KpsScalar[] } | { ok: false }`

- [ ] **Step 1: Write the failing edit tests**

Append inside `describe('kps type schema')`:

```typescript
it('stores list edits as parsed JSON and warns on element mismatch', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-list-edit-'));
  const { kpsRoot: tagsKps } = writeTagsBundle(tmp, 'java.lang.Integer', [
    { name: 'row', codes: [1] },
  ]);
  const session = loadKpsSession(tagsKps);
  const table = 'T_Tags.json';

  setCell(session, table, 'DEVL', 0, 'codes', '[3,5]');
  expect(session.tables[table].stages.DEVL.rows[0].cells.codes?.value).toEqual([3, 5]);
  expect(session.tables[table].stages.DEVL.rows[0].cells.codes?.warning).toBeUndefined();
  expect(session.tables[table].stages.DEVL.dirty).toBe(true);

  setCell(session, table, 'DEVL', 0, 'codes', '["3","5"]');
  expect(session.tables[table].stages.DEVL.rows[0].cells.codes?.value).toEqual(['3', '5']);
  expect(session.tables[table].stages.DEVL.rows[0].cells.codes?.warning).toBe(
    'List element is not a valid integer',
  );
  expect(session.editWarning).toBeUndefined();

  setCell(session, table, 'DEVL', 0, 'codes', '[1.5]');
  expect(session.tables[table].stages.DEVL.rows[0].cells.codes?.value).toEqual([1.5]);
  expect(session.tables[table].stages.DEVL.rows[0].cells.codes?.warning).toBe(
    'List element is not a valid integer',
  );
});

it('rejects list text that is not a flat scalar array', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-list-reject-'));
  const { kpsRoot: tagsKps } = writeTagsBundle(tmp, 'java.lang.String', [
    { name: 'row', codes: ['keep'] },
  ]);
  const session = loadKpsSession(tagsKps);
  const table = 'T_Tags.json';
  const cell = () => session.tables[table].stages.DEVL.rows[0].cells.codes;

  setCell(session, table, 'DEVL', 0, 'codes', '[3,');
  expect(cell()?.value).toEqual(['keep']);
  expect(session.tables[table].stages.DEVL.dirty).toBe(false);
  expect(session.editWarning).toMatch(/codes/);

  setCell(session, table, 'DEVL', 0, 'codes', '{"a":1}');
  expect(cell()?.value).toEqual(['keep']);
  expect(session.tables[table].stages.DEVL.dirty).toBe(false);

  setCell(session, table, 'DEVL', 0, 'codes', '[{"a":1}]');
  expect(cell()?.value).toEqual(['keep']);
  expect(session.tables[table].stages.DEVL.dirty).toBe(false);

  setCell(session, table, 'DEVL', 0, 'codes', '[[1]]');
  expect(cell()?.value).toEqual(['keep']);
  expect(session.tables[table].stages.DEVL.dirty).toBe(false);
});

it('accepts an integer inside a number list and warns on null', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-list-number-'));
  const { kpsRoot: tagsKps } = writeTagsBundle(tmp, 'java.lang.Double', [
    { name: 'row', codes: [] },
  ]);
  const session = loadKpsSession(tagsKps);
  setCell(session, 'T_Tags.json', 'DEVL', 0, 'codes', '[3,5.5]');
  const cell = session.tables['T_Tags.json'].stages.DEVL.rows[0].cells.codes;
  expect(cell?.value).toEqual([3, 5.5]);
  expect(cell?.warning).toBeUndefined();

  setCell(session, 'T_Tags.json', 'DEVL', 0, 'codes', '[null]');
  expect(session.tables['T_Tags.json'].stages.DEVL.rows[0].cells.codes?.value).toEqual([null]);
  expect(session.tables['T_Tags.json'].stages.DEVL.rows[0].cells.codes?.warning).toBe(
    'List element is not a valid number',
  );
});

it('defaults a new list cell to an empty array', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-list-add-'));
  const { kpsRoot: tagsKps } = writeTagsBundle(tmp, 'java.lang.String', [{ name: 'row', codes: ['a'] }]);
  const session = loadKpsSession(tagsKps);
  addRow(session, 'T_Tags.json', 'DEVL');
  const row = session.tables['T_Tags.json'].stages.DEVL.rows[1];
  expect(row.cells.codes?.value).toEqual([]);
  expect(row.cells.name?.value).toBe('');
  setCell(session, 'T_Tags.json', 'DEVL', 1, 'codes', '[]');
  expect(row.cells.codes?.value).toEqual([]);
  expect(row.cells.codes?.warning).toBeUndefined();
});

it('does not warn when a list has no element type', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-list-unchecked-'));
  const { kpsRoot: tagsKps } = writeTagsBundle(tmp, '""', [{ name: 'row', codes: [] }]);
  const session = loadKpsSession(tagsKps);
  expect(session.tables['T_Tags.json'].listElementTypes.codes).toBeUndefined();
  setCell(session, 'T_Tags.json', 'DEVL', 0, 'codes', '[3,"5",true]');
  const cell = session.tables['T_Tags.json'].stages.DEVL.rows[0].cells.codes;
  expect(cell?.value).toEqual([3, '5', true]);
  expect(cell?.warning).toBeUndefined();
});

it('warns when a boolean list contains a string', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-list-bool-'));
  const { kpsRoot: tagsKps } = writeTagsBundle(tmp, 'java.lang.Boolean', [{ name: 'row', codes: [] }]);
  const session = loadKpsSession(tagsKps);
  setCell(session, 'T_Tags.json', 'DEVL', 0, 'codes', '[true,"true"]');
  const cell = session.tables['T_Tags.json'].stages.DEVL.rows[0].cells.codes;
  expect(cell?.value).toEqual([true, 'true']);
  expect(cell?.warning).toBe('List element is not a valid boolean');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/kpsEditor.test.ts -t "stores list edits"`

Expected: FAIL because `setCell` does not parse JSON arrays (`Could not set "codes" ...` or a coerced scalar).

- [ ] **Step 3: Parse list commits**

Add `parseListInput` to `kpsTypeSchema.ts`. Use the existing `isScalar` idea locally: accept only `null`, string, finite number, and boolean.

```typescript
export function parseListInput(text: string): { ok: true; value: KpsScalar[] } | { ok: false } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (!Array.isArray(parsed) || !parsed.every(isListScalar)) {
    return { ok: false };
  }
  return { ok: true, value: parsed };
}

function isListScalar(value: unknown): value is KpsScalar {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  return typeof value === 'number' && Number.isFinite(value);
}
```

In `setCell`, handle `columnType === 'list'` before `coerceByColumnType`:

```typescript
if (columnType === 'list') {
  const parsed = parseListInput(text);
  if (!parsed.ok) {
    session.editWarning = `Could not set "${column}" to a list`;
    return;
  }
  const elementType = session.tables[tableName].listElementTypes[column];
  const warning = listElementMismatch(parsed.value, elementType);
  delete row.extra[column];
  session.editWarning = undefined;
  row.cells[column] = { editable: true, value: parsed.value, warning };
  stage.dirty = true;
  return;
}
```

Guard `coerceByColumnType` so a list cannot fall through to the number branch:

```typescript
if (columnType === 'list') {
  return { ok: false };
}
```

`addRow` already uses `defaultValueForColumnType`, which returns `[]` after Task 2. No separate add-row branch.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/unit/kpsEditor.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/kpsEditor/kpsTypeSchema.ts src/features/kpsEditor/kpsTableMutations.ts test/unit/kpsEditor.test.ts
git commit -m "feat: commit KPS list cells as parsed JSON arrays"
```

---

### Task 4: Write lists as JSON arrays

**Files:**
- Modify: `src/features/kpsEditor/kpsTableWriter.ts`
- Test: `test/unit/kpsEditor.test.ts`

**Interfaces:**
- Consumes: editable `cell.value` as `KpsScalar[]` from Tasks 2–3; `writeDirtyKpsTables(session)`
- Produces: no new exports. `rowToObject` writes an editable array even when `row.extra` still has that key.

- [ ] **Step 1: Write the failing write-back test**

Append inside `describe('kps type schema')`:

```typescript
it('writes a list as a JSON array and leaves an untouched string unchanged', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-list-write-'));
  const { kpsRoot: tagsKps } = writeTagsBundle(tmp, 'java.lang.Integer', [
    { name: 'edited', codes: [1] },
    { name: 'untouched', codes: '[3,5]' },
  ]);
  const session = loadKpsSession(tagsKps);
  const table = 'T_Tags.json';
  setCell(session, table, 'DEVL', 0, 'codes', '[3,5]');
  session.tables[table].stages.DEVL.rows[0].extra.codes = [1];
  setCell(session, table, 'DEVL', 1, 'name', 'renamed');
  writeDirtyKpsTables(session);

  const written = JSON.parse(
    fs.readFileSync(session.tables[table].stages.DEVL.filePath, 'utf8'),
  );
  expect(written[0].codes).toEqual([3, 5]);
  expect(typeof written[0].codes).not.toBe('string');
  expect(written[1].codes).toBe('[3,5]');
  expect(written[1].name).toBe('renamed');
  const raw = fs.readFileSync(session.tables[table].stages.DEVL.filePath, 'utf8');
  expect(raw.endsWith(']')).toBe(true);
  expect(raw.endsWith('\n')).toBe(false);
});
```

`extra.codes = [1]` is assigned after `setCell`, which deletes `extra`. That stale bag must not win over the edited array `[3, 5]`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/kpsEditor.test.ts -t "writes a list as a JSON array"`

Expected: FAIL because `row.extra.codes` is written (`[1]`) instead of the edited cell (`[3, 5]`).

- [ ] **Step 3: Prefer an editable array cell**

In `rowToObject`, write an editable array before the `extra` branch:

```typescript
const cell = row.cells[key];
if (cell?.editable && Array.isArray(cell.value)) {
  obj[key] = cell.value;
  seen.add(key);
  return;
}
if (key in row.extra) {
  obj[key] = row.extra[key];
  seen.add(key);
  return;
}
```

Leave the rest of `writeKey` as it is. Do not change indent or the trailing-newline rule.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/kpsEditor.test.ts`

Expected: PASS. The existing nested-extra key-order test still passes because that nested object is not an editable array.

- [ ] **Step 5: Commit**

```bash
git add src/features/kpsEditor/kpsTableWriter.ts test/unit/kpsEditor.test.ts
git commit -m "fix: write KPS list cells as JSON arrays"
```

---

### Task 5: Show list cells as JSON in the grid

**Files:**
- Modify: `src/features/kpsEditor/kpsPanelHtml.ts`
- Test: `test/unit/kpsEditor.test.ts`

**Interfaces:**
- Consumes: `KpsCell.value` as `KpsScalar[]` from Task 2; `renderKpsEditorHtml`
- Produces: no new exports. `scalarToInputValue` returns `JSON.stringify(value)` for arrays.

- [ ] **Step 1: Write the failing HTML test**

Append inside `describe('kps panel html')`:

```typescript
it('renders a list cell as JSON array text', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-list-html-'));
  const { kpsRoot: tagsKps } = writeTagsBundle(tmp, 'java.lang.String', [
    { name: 'row', codes: ['a', 'b'] },
  ]);
  const session = loadKpsSession(tagsKps);
  const html = renderKpsEditorHtml(session, {
    cspSource: 'https://example',
    tableName: 'T_Tags.json',
    stageId: 'DEVL',
    nonce: 'testnonce',
  });
  expect(html).toContain('value="[&quot;a&quot;,&quot;b&quot;]"');
  expect(html).not.toContain('value="a,b"');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/kpsEditor.test.ts -t "renders a list cell"`

Expected: FAIL because `String(['a','b'])` is `a,b`, so the attribute is `value="a,b"`.

- [ ] **Step 3: Stringify arrays in the input**

In `scalarToInputValue`:

```typescript
function scalarToInputValue(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}
```

Locked cells already use this helper for the non-array preview, and `JSON.stringify(cell.nested)` for nested values. Leave that branch alone.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/unit/kpsEditor.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/kpsEditor/kpsPanelHtml.ts test/unit/kpsEditor.test.ts
git commit -m "feat: show KPS list cells as JSON array text"
```
