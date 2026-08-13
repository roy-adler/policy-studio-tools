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
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('\n    {');
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
});
