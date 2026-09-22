import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  discoverKpsStages,
  resolveSiblingKpsRoot,
} from '../../src/features/kpsEditor/discoverKpsStages';
import { loadKpsSession } from '../../src/features/kpsEditor/loadKpsSession';
import { buildKpsSession } from '../../src/features/kpsEditor/kpsTableModel';
import {
  addRow,
  createMissing,
  isSessionDirty,
  removeRow,
  setCell,
} from '../../src/features/kpsEditor/kpsTableMutations';
import { loadKpsTypeSchemas } from '../../src/features/kpsEditor/kpsTypeSchema';
import { writeDirtyKpsTables } from '../../src/features/kpsEditor/kpsTableWriter';
import { listKpsRootsForProjects } from '../../src/features/kpsEditor/listKpsRoots';
import type { KpsRootCandidate } from '../../src/features/kpsEditor/listKpsRoots';
import { pickProjectRootForKpsEditor } from '../../src/features/kpsEditor/pickProjectRootForKpsEditor';
import {
  resolveKpsFollowActiveProject,
  resolveKpsOpenDecision,
} from '../../src/features/kpsEditor/resolveKpsSelection';
import { KPS_EDITOR_TOOL } from '../../src/features/kpsEditor/toolDescriptor';
import { renderKpsEditorHtml } from '../../src/features/kpsEditor/kpsPanelHtml';
import type { PolicyStudioProject } from '../../src/features/projectRegistry/types';

const sampleRoot = path.join(__dirname, '..', 'fixtures', 'kps-editor', 'sample');
const policyRoot = path.join(sampleRoot, 'POLICY_yaml');
const kpsRoot = path.join(sampleRoot, 'KPS');

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

describe('kps discovery', () => {
  it('resolves sibling KPS next to the policy project', () => {
    expect(resolveSiblingKpsRoot(policyRoot)).toBe(kpsRoot);
  });

  it('discovers stages with json and unions table basenames', () => {
    const result = discoverKpsStages(kpsRoot);
    expect(result.kpsRoot).toBe(path.resolve(kpsRoot));
    expect(result.stages.map((s) => s.id).sort()).toEqual(['DEVL', 'HUTL', 'TEST']);
    expect(result.tableNames.sort()).toEqual([
      'T_CC_Sample_Routes.json',
      'T_CC_Sample_WebServices.json',
    ]);
    expect(result.stages.every((s) => fs.existsSync(s.stageDir))).toBe(true);
  });

  it('returns empty stages when KPS has no stage json files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-empty-'));
    const emptyKps = path.join(tmp, 'KPS');
    fs.mkdirSync(emptyKps);
    fs.mkdirSync(path.join(emptyKps, 'EMPTY'));
    const result = discoverKpsStages(emptyKps);
    expect(result.stages).toEqual([]);
    expect(result.tableNames).toEqual([]);
    expect(result.skippedDirs).toContain('EMPTY');
  });
});

describe('kps session model', () => {
  it('loads sample tables with shared columns and independent rows', () => {
    const session = loadKpsSession(kpsRoot);
    expect(session.tableNames).toContain('T_CC_Sample_WebServices.json');
    const web = session.tables['T_CC_Sample_WebServices.json'];
    expect(web.columns).toEqual(
      expect.arrayContaining(['name', 'description', 'type', 'version', 'createdBy']),
    );
    expect(web.stages.DEVL.status).toBe('present');
    expect(web.stages.DEVL.rows).toHaveLength(2);
    expect(web.stages.DEVL.rows[0].cells.name?.value).toBe('WebService_One_DEVL');
    expect(web.stages.TEST.rows[0].cells.name?.value).toBe('WebService_One_TEST');
  });

  it('marks missing stage files for tables not present in every stage', () => {
    const session = loadKpsSession(kpsRoot);
    const routes = session.tables['T_CC_Sample_Routes.json'];
    expect(routes.stages.DEVL.status).toBe('present');
    expect(routes.stages.TEST.status).toBe('present');
    expect(routes.stages.HUTL.status).toBe('missing');
    expect(routes.stages.HUTL.rows).toEqual([]);
  });

  it('isolates invalid JSON to one stage', () => {
    const discovery = discoverKpsStages(kpsRoot);
    const contents: Record<string, string | null> = {};
    for (const stage of discovery.stages) {
      for (const table of discovery.tableNames) {
        const key = `${stage.id}/${table}`;
        const filePath = path.join(stage.stageDir, table);
        contents[key] = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
      }
    }
    contents['DEVL/T_CC_Sample_WebServices.json'] = '{not-json';

    const session = buildKpsSession(path.resolve(kpsRoot), discovery, contents);
    const web = session.tables['T_CC_Sample_WebServices.json'];
    expect(web.stages.DEVL.status).toBe('error');
    expect(web.stages.DEVL.parseError).toBeTruthy();
    expect(web.stages.TEST.status).toBe('present');
    expect(session.warnings.some((w) => w.includes('DEVL'))).toBe(true);
  });

  it('marks nested non-scalar cells as non-editable', () => {
    const discovery = discoverKpsStages(kpsRoot);
    const contents: Record<string, string | null> = {
      'DEVL/Nested.json': JSON.stringify([{ name: 'a', meta: { nested: true } }]),
      'TEST/Nested.json': null,
      'HUTL/Nested.json': null,
    };
    const nestedDiscovery = {
      ...discovery,
      tableNames: ['Nested.json'],
    };
    const session = buildKpsSession(path.resolve(kpsRoot), nestedDiscovery, contents);
    const table = session.tables['Nested.json'];
    expect(table.columns).toContain('name');
    expect(table.columns).toContain('meta');
    expect(table.stages.DEVL.rows[0].cells.name?.editable).toBe(true);
    expect(table.stages.DEVL.rows[0].cells.meta?.editable).toBe(false);
    expect(table.stages.DEVL.rows[0].extra.meta).toEqual({ nested: true });
  });
});

describe('kps mutations and writer', () => {
  function cloneSession(): ReturnType<typeof loadKpsSession> {
    return loadKpsSession(kpsRoot);
  }

  it('edits a cell on the active stage and preserves number type', () => {
    const session = cloneSession();
    const table = 'T_CC_Sample_Routes.json';
    // seed a number cell
    session.tables[table].stages.DEVL.rows[0].cells.count = {
      editable: true,
      value: 1,
    };
    session.tables[table].columns.push('count');
    setCell(session, table, 'DEVL', 0, 'count', '42');
    expect(session.tables[table].stages.DEVL.rows[0].cells.count?.value).toBe(42);
    expect(session.tables[table].stages.DEVL.dirty).toBe(true);
    expect(session.tables[table].stages.TEST.dirty).toBe(false);
  });

  it('adds and removes rows on the active stage only', () => {
    const session = cloneSession();
    const table = 'T_CC_Sample_WebServices.json';
    const beforeTest = session.tables[table].stages.TEST.rows.length;
    addRow(session, table, 'DEVL');
    expect(session.tables[table].stages.DEVL.rows).toHaveLength(3);
    expect(session.tables[table].stages.TEST.rows).toHaveLength(beforeTest);
    const newRow = session.tables[table].stages.DEVL.rows[2];
    expect(newRow.cells.name?.value).toBe('');
    removeRow(session, table, 'DEVL', 2);
    expect(session.tables[table].stages.DEVL.rows).toHaveLength(2);
  });

  it('creates a missing stage file as empty array and marks dirty', () => {
    const session = cloneSession();
    const table = 'T_CC_Sample_Routes.json';
    expect(session.tables[table].stages.HUTL.status).toBe('missing');
    createMissing(session, table, 'HUTL');
    expect(session.tables[table].stages.HUTL.status).toBe('present');
    expect(session.tables[table].stages.HUTL.rows).toEqual([]);
    expect(session.tables[table].stages.HUTL.dirty).toBe(true);
    expect(isSessionDirty(session)).toBe(true);
  });

  it('writes only dirty stage files with pretty JSON', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-write-'));
    const tmpKps = path.join(tmp, 'KPS');
    fs.cpSync(kpsRoot, tmpKps, { recursive: true });
    const session = loadKpsSession(tmpKps);
    const table = 'T_CC_Sample_WebServices.json';
    setCell(session, table, 'DEVL', 0, 'version', '9.9.9');
    const result = writeDirtyKpsTables(session);
    expect(result.written).toHaveLength(1);
    expect(result.written[0]).toContain(`${path.sep}DEVL${path.sep}`);
    const written = JSON.parse(fs.readFileSync(session.tables[table].stages.DEVL.filePath, 'utf8'));
    expect(written[0].version).toBe('9.9.9');
    expect(session.tables[table].stages.DEVL.dirty).toBe(false);
    const raw = fs.readFileSync(session.tables[table].stages.DEVL.filePath, 'utf8');
    expect(raw.endsWith(']')).toBe(true);
    expect(raw.endsWith('\n')).toBe(false);
    expect(raw).toContain('\n    {');
  });

  it('preserves original JSON key order and appends new schema keys', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-key-order-'));
    fs.cpSync(sampleRoot, tmp, { recursive: true });
    const filePath = path.join(tmp, 'KPS', 'DEVL', 'T_CC_Sample_Routes.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        [
          {
            enabled: true,
            extraField: 'keep-me',
            name: 'Route_A_DEVL',
            path: '/api/a',
          },
        ],
        null,
        4,
      ),
    );

    const session = loadKpsSession(path.join(tmp, 'KPS'));
    setCell(session, 'T_CC_Sample_Routes.json', 'DEVL', 0, 'name', 'renamed');
    writeDirtyKpsTables(session);

    const written = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(Object.keys(written[0])).toEqual([
      'enabled',
      'extraField',
      'name',
      'path',
      'priority',
    ]);
    expect(written[0].name).toBe('renamed');
    expect(written[0].extraField).toBe('keep-me');
    expect(written[0].priority).toBe(0);
  });

  it('keeps nested extra keys in their original position', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-nested-order-'));
    fs.cpSync(sampleRoot, tmp, { recursive: true });
    const filePath = path.join(tmp, 'KPS', 'DEVL', 'T_CC_Sample_Routes.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        [
          {
            name: 'Route_A_DEVL',
            meta: { nested: true },
            path: '/api/a',
            enabled: true,
            priority: 1,
          },
        ],
        null,
        4,
      ),
    );

    const session = loadKpsSession(path.join(tmp, 'KPS'));
    setCell(session, 'T_CC_Sample_Routes.json', 'DEVL', 0, 'path', '/api/b');
    writeDirtyKpsTables(session);

    const written = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(Object.keys(written[0])).toEqual(['name', 'meta', 'path', 'enabled', 'priority']);
    expect(written[0].meta).toEqual({ nested: true });
  });
});

describe('kps selection and tool descriptor', () => {
  it('lists KPS roots for projects that have sibling KPS stages', () => {
    const project: PolicyStudioProject = {
      id: 'sample',
      displayName: 'POLICY_yaml',
      rootPath: policyRoot,
      workspaceFolder: sampleRoot,
      relativePath: 'POLICY_yaml',
      projectType: 'yaml',
    };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-no-sibling-'));
    const bareRoot = path.join(tmp, 'POLICY_yaml');
    fs.mkdirSync(bareRoot);
    const withoutKps: PolicyStudioProject = {
      id: 'bare',
      displayName: 'bare',
      rootPath: bareRoot,
      workspaceFolder: tmp,
      relativePath: 'POLICY_yaml',
      projectType: 'yaml',
    };
    const listed = listKpsRootsForProjects([withoutKps, project]);
    expect(listed).toHaveLength(1);
    expect(listed[0].kpsRoot).toBe(path.resolve(kpsRoot));
    expect(listed[0].stageIds.sort()).toEqual(['DEVL', 'HUTL', 'TEST']);
    expect(listed[0].tableNames).toContain('T_CC_Sample_WebServices.json');
  });

  it('registers under Analyze with openKpsEditor command', () => {
    expect(KPS_EDITOR_TOOL.group).toBe('analyze');
    expect(KPS_EDITOR_TOOL.command).toBe('policyStudioTools.openKpsEditor');
    expect(KPS_EDITOR_TOOL.available).toBe(true);
  });

  it('prefers the active project when opening KPS', () => {
    const projectA: PolicyStudioProject = {
      id: 'a',
      rootPath: '/repo/NAME_ONE/NAME_ONE_YAML',
      workspaceFolder: '/repo',
      relativePath: 'NAME_ONE/NAME_ONE_YAML',
      displayName: 'NAME_ONE_YAML',
      projectType: 'yaml',
    };
    const projectB: PolicyStudioProject = {
      id: 'b',
      rootPath: '/repo/PAYMENT_API/PAYMENT_API_YAML',
      workspaceFolder: '/repo',
      relativePath: 'PAYMENT_API/PAYMENT_API_YAML',
      displayName: 'PAYMENT_API_YAML',
      projectType: 'yaml',
    };
    const candidateA: KpsRootCandidate = {
      kpsRoot: '/repo/NAME_ONE/KPS',
      project: projectA,
      bundleName: 'NAME_ONE',
      stageIds: ['DEVL'],
      tableNames: ['a.json'],
    };
    const candidateB: KpsRootCandidate = {
      kpsRoot: '/repo/PAYMENT_API/KPS',
      project: projectB,
      bundleName: 'PAYMENT_API',
      stageIds: ['DEVL'],
      tableNames: ['b.json'],
    };
    expect(
      resolveKpsOpenDecision([candidateA, candidateB], {
        mode: 'activeProject',
        activeProjectId: 'b',
      }),
    ).toEqual({ kind: 'open', candidate: candidateB });
    expect(resolveKpsOpenDecision([candidateA, candidateB], { mode: 'allProjects' })).toEqual({
      kind: 'pick',
    });
    expect(pickProjectRootForKpsEditor([projectA, projectB], { mode: 'allProjects' })).toBeUndefined();
  });

  it('follows active project to a different KPS root', () => {
    const projectA: PolicyStudioProject = {
      id: 'a',
      rootPath: '/repo/a/yaml',
      workspaceFolder: '/repo',
      relativePath: 'a/yaml',
      displayName: 'A',
      projectType: 'yaml',
    };
    const projectB: PolicyStudioProject = {
      id: 'b',
      rootPath: '/repo/b/yaml',
      workspaceFolder: '/repo',
      relativePath: 'b/yaml',
      displayName: 'B',
      projectType: 'yaml',
    };
    const candidates: KpsRootCandidate[] = [
      {
        kpsRoot: '/repo/a/KPS',
        project: projectA,
        bundleName: 'a',
        stageIds: ['DEVL'],
        tableNames: ['t.json'],
      },
      {
        kpsRoot: '/repo/b/KPS',
        project: projectB,
        bundleName: 'b',
        stageIds: ['DEVL'],
        tableNames: ['t.json'],
      },
    ];
    expect(
      resolveKpsFollowActiveProject(
        candidates,
        [projectA, projectB],
        { mode: 'activeProject', activeProjectId: 'b' },
        '/repo/a/KPS',
      ),
    ).toEqual({ kind: 'switch', candidate: candidates[1] });
  });
});

describe('kps panel html', () => {
  it('renders layout B with table tabs, stage tabs, and grid columns', () => {
    const session = loadKpsSession(kpsRoot);
    const html = renderKpsEditorHtml(session, {
      cspSource: 'https://example',
      tableName: 'T_CC_Sample_WebServices.json',
      stageId: 'DEVL',
      kpsLabel: 'sample',
      nonce: 'testnonce',
    });
    expect(html).toContain('T_CC_Sample_WebServices');
    expect(html).toContain('T_CC_Sample_Routes');
    expect(html).toContain('DEVL');
    expect(html).toContain('TEST');
    expect(html).toContain('HUTL');
    expect(html).toContain('<th>name</th>');
    expect(html).toContain('Add row');
    expect(html).toContain('Switch KPS');
    expect(html).toContain('>JSON<');
    expect(html).toContain('>Store Group<');
    expect(html).toContain('>Type Group<');
  });

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
});

describe('kps type schema', () => {
  it('loads Store/Type Group types for tables matched by aliases', () => {
    const session = loadKpsSession(kpsRoot);
    const routes = session.tables['T_CC_Sample_Routes.json'];
    expect(routes.columnTypes).toEqual({
      name: 'string',
      path: 'string',
      enabled: 'boolean',
      priority: 'integer',
    });
    expect(session.tables['T_CC_Sample_WebServices.json'].columnTypes).toEqual({});
  });

  it('records Store Group and Type Group file paths for the current table', () => {
    const session = loadKpsSession(kpsRoot);
    const routes = session.tables['T_CC_Sample_Routes.json'];
    expect(routes.storeGroupPath).toMatch(/Store Group[/\\]Routes\.yaml$/);
    expect(routes.typeGroupPath).toMatch(/Type Group[/\\]Routes\.yaml$/);
    expect(routes.stages.DEVL.filePath).toMatch(/DEVL[/\\]T_CC_Sample_Routes\.json$/);
  });

  it('coerces boolean and integer edits from the Type Group', () => {
    const session = loadKpsSession(kpsRoot);
    const table = 'T_CC_Sample_Routes.json';
    setCell(session, table, 'DEVL', 0, 'enabled', 'false');
    expect(session.tables[table].stages.DEVL.rows[0].cells.enabled?.value).toBe(false);
    setCell(session, table, 'DEVL', 0, 'priority', '10');
    expect(session.tables[table].stages.DEVL.rows[0].cells.priority?.value).toBe(10);
  });

  it('keeps the previous value and warns when schema coercion fails', () => {
    const session = loadKpsSession(kpsRoot);
    const table = 'T_CC_Sample_Routes.json';
    const before = session.tables[table].stages.DEVL.rows[0].cells.enabled?.value;
    expect(before).toBe(true);
    setCell(session, table, 'DEVL', 0, 'enabled', 'maybe');
    expect(session.tables[table].stages.DEVL.rows[0].cells.enabled?.value).toBe(true);
    expect(session.tables[table].stages.DEVL.dirty).toBe(false);
    expect(session.editWarning).toMatch(/enabled/i);
  });

  it('adds typed default values for schema columns', () => {
    const session = loadKpsSession(kpsRoot);
    const table = 'T_CC_Sample_Routes.json';
    addRow(session, table, 'DEVL');
    const row = session.tables[table].stages.DEVL.rows[1];
    expect(row.cells.name?.value).toBe('');
    expect(row.cells.enabled?.value).toBe(false);
    expect(row.cells.priority?.value).toBe(0);
  });

  it('writes booleans and integers as JSON types', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kps-types-'));
    fs.cpSync(sampleRoot, tmp, { recursive: true });
    const session = loadKpsSession(path.join(tmp, 'KPS'));
    const table = 'T_CC_Sample_Routes.json';
    setCell(session, table, 'DEVL', 0, 'enabled', 'false');
    setCell(session, table, 'DEVL', 0, 'priority', '7');
    writeDirtyKpsTables(session);
    const written = JSON.parse(
      fs.readFileSync(session.tables[table].stages.DEVL.filePath, 'utf8'),
    );
    expect(written[0].enabled).toBe(false);
    expect(written[0].priority).toBe(7);
    expect(typeof written[0].enabled).toBe('boolean');
    expect(typeof written[0].priority).toBe('number');
  });

  it('uses Type Group properties as columns and warns when JSON does not match', () => {
    const discovery = discoverKpsStages(kpsRoot);
    const schema = loadKpsTypeSchemas(policyRoot);
    const contents: Record<string, string | null> = {
      'DEVL/T_CC_Sample_Routes.json': JSON.stringify([
        { name: 'only-name', extraField: 'unexpected' },
      ]),
      'TEST/T_CC_Sample_Routes.json': null,
      'HUTL/T_CC_Sample_Routes.json': null,
    };
    const session = buildKpsSession(
      path.resolve(kpsRoot),
      { ...discovery, tableNames: ['T_CC_Sample_Routes.json'] },
      contents,
      schema.columnTypesByTable,
      schema.schemaColumnsByTable,
    );
    const routes = session.tables['T_CC_Sample_Routes.json'];
    expect(routes.columns).toEqual(['name', 'path', 'enabled', 'priority', 'extraField']);
    expect(routes.schemaColumns).toEqual(['name', 'path', 'enabled', 'priority']);
    const row = routes.stages.DEVL.rows[0];
    expect(row.cells.path?.warning).toMatch(/missing/i);
    expect(row.cells.extraField?.warning).toMatch(/not in Type Group/i);
    expect(session.warnings.some((warning) => /path/i.test(warning))).toBe(true);
    expect(session.warnings.some((warning) => /extraField/i.test(warning))).toBe(true);
    setCell(session, 'T_CC_Sample_Routes.json', 'DEVL', 0, 'path', '/fixed');
    expect(row.cells.path?.value).toBe('/fixed');
  });

  it('lists a Store Group table even when no JSON file exists', () => {
    const discovery = discoverKpsStages(kpsRoot);
    const schema = loadKpsTypeSchemas(policyRoot);
    const session = buildKpsSession(
      path.resolve(kpsRoot),
      {
        ...discovery,
        tableNames: [...discovery.tableNames, 'T_CC_Sample_Missing.json'],
      },
      {
        'DEVL/T_CC_Sample_Missing.json': null,
        'TEST/T_CC_Sample_Missing.json': null,
        'HUTL/T_CC_Sample_Missing.json': null,
      },
      {
        ...schema.columnTypesByTable,
        'T_CC_Sample_Missing.json': { name: 'string', count: 'integer' },
      },
      {
        ...schema.schemaColumnsByTable,
        'T_CC_Sample_Missing.json': ['name', 'count'],
      },
    );
    const table = session.tables['T_CC_Sample_Missing.json'];
    expect(table.columns).toEqual(['name', 'count']);
    expect(table.stages.DEVL.status).toBe('missing');
    expect(session.warnings.some((warning) => warning.includes('T_CC_Sample_Missing.json'))).toBe(
      true,
    );
  });

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
});
