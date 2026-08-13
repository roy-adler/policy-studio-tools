import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  discoverEnvStages,
  resolveSiblingEnvRoot,
} from '../../src/features/envValuesEditor/discoverEnvStages';
import { loadEnvValuesSession } from '../../src/features/envValuesEditor/loadEnvValuesSession';
import {
  deleteValueAtPath,
  hasForbiddenPathSegment,
  parseEnvValuesYaml,
  setValueAtPath,
} from '../../src/features/envValuesEditor/envValuesModel';
import {
  addKey,
  createMissing,
  removeKey,
  setLeafValue,
  setListValue,
} from '../../src/features/envValuesEditor/envValuesMutations';
import { writeDirtyEnvDocuments } from '../../src/features/envValuesEditor/envValuesWriter';
import { renderEnvValuesEditorHtml } from '../../src/features/envValuesEditor/envValuesPanelHtml';
import { resolveAddKeyPath } from '../../src/features/envValuesEditor/resolveAddKeyPath';
import { ENV_VALUES_EDITOR_TOOL } from '../../src/features/envValuesEditor/toolDescriptor';
import { listEnvRootsForProjects } from '../../src/features/envValuesEditor/listEnvRoots';
import type { EnvRootCandidate } from '../../src/features/envValuesEditor/listEnvRoots';
import { pickProjectRootForEnvEditor } from '../../src/features/envValuesEditor/pickProjectRootForEnvEditor';
import {
  findEnvCandidateForProject,
  resolveEnvFollowActiveProject,
  resolveEnvOpenDecision,
} from '../../src/features/envValuesEditor/resolveEnvSelection';
import {
  collectSingletonExpandPaths,
  filterEnvTree,
  nodeOrDescendantHasMissing,
  resolveExpandedPaths,
} from '../../src/features/envValuesEditor/envTreeView';
import type { EnvTreeNode } from '../../src/features/envValuesEditor/types';
import type { PolicyStudioProject } from '../../src/features/projectRegistry/types';
import type { EnvValuesModel } from '../../src/features/envValuesEditor/types';

const sampleRoot = path.join(__dirname, '..', 'fixtures', 'env-values-editor', 'sample');
const policyRoot = path.join(sampleRoot, 'POLICY_yaml');
const envRoot = path.join(sampleRoot, 'ENV');

describe('env values discovery', () => {
  it('resolves sibling ENV next to the policy project', () => {
    expect(resolveSiblingEnvRoot(policyRoot)).toBe(envRoot);
  });

  it('lists ENV roots for projects that have sibling ENV stages', () => {
    const project: PolicyStudioProject = {
      id: 'sample',
      displayName: 'POLICY_yaml',
      rootPath: policyRoot,
      relativePath: 'sample/POLICY_yaml',
      projectType: 'yaml',
      markerPath: path.join(policyRoot, 'values.yaml'),
    };
    const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-bare-proj-'));
    const barePolicy = path.join(bareDir, 'BarePolicy_yaml');
    fs.mkdirSync(barePolicy);
    const withoutEnv: PolicyStudioProject = {
      id: 'bare',
      displayName: 'BarePolicy_yaml',
      rootPath: barePolicy,
      relativePath: 'BarePolicy_yaml',
      projectType: 'yaml',
      markerPath: path.join(barePolicy, 'values.yaml'),
    };

    const listed = listEnvRootsForProjects([withoutEnv, project]);
    expect(listed).toHaveLength(1);
    expect(listed[0].envRoot).toBe(envRoot);
    expect(listed[0].stageIds.sort()).toEqual(['DEVL', 'TEST']);
    expect(listed[0].bundleName).toBe('sample');
  });

  it('discovers stages that contain values.yaml and skips KPS', () => {
    const result = discoverEnvStages(envRoot);
    expect(result.envRoot).toBe(envRoot);
    expect(result.stages.map((s) => s.id).sort()).toEqual(['DEVL', 'TEST']);
    expect(result.stages.every((s) => s.valuesFilePath.endsWith(`${path.sep}values.yaml`))).toBe(
      true,
    );
    expect(result.skippedDirs).toContain('KPS');
  });

  it('returns empty stages when ENV has no stage values.yaml files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-empty-'));
    const emptyEnv = path.join(tmp, 'ENV');
    fs.mkdirSync(emptyEnv);
    const result = discoverEnvStages(emptyEnv);
    expect(result.stages).toEqual([]);
  });
});

describe('env values model', () => {
  it('parses compact sequences where list items share the key indent', () => {
    const yaml = [
      'Cassandra_Settings:',
      '  passwords: |-',
      '    LONG_PASSWORD',
      '  sslCertificate: /Environment Configuration/Certificate Store/FileName1.fileending',
      '  sslTrustedCerts:',
      '  - /Environment Configuration/Certificate Store/FileName2',
      '  - /Environment Configuration/Certificate Store/FileName3',
      '',
    ].join('\n');

    const parsed = parseEnvValuesYaml(yaml);
    expect(parsed.error).toBeUndefined();
    expect(parsed.data).toEqual({
      Cassandra_Settings: {
        passwords: 'LONG_PASSWORD',
        sslCertificate: '/Environment Configuration/Certificate Store/FileName1.fileending',
        sslTrustedCerts: [
          '/Environment Configuration/Certificate Store/FileName2',
          '/Environment Configuration/Certificate Store/FileName3',
        ],
      },
    });
  });

  it('ends a compact sequence when the next sibling mapping key appears', () => {
    // Real ENV files often put scalar keys after a compact list at the same indent.
    const yaml = [
      'Cassandra_Settings:',
      '  sslTrustedCerts:',
      '  - /Environment Configuration/Certificate Store/FileName2',
      '  - /Environment Configuration/Certificate Store/FileName3',
      '  sslCertificate: /Environment Configuration/Certificate Store/FileName1.fileending',
      '  passwords: |-',
      '    LONG_PASSWORD',
      '',
    ].join('\n');

    const parsed = parseEnvValuesYaml(yaml);
    expect(parsed.error).toBeUndefined();
    expect(parsed.data).toEqual({
      Cassandra_Settings: {
        sslTrustedCerts: [
          '/Environment Configuration/Certificate Store/FileName2',
          '/Environment Configuration/Certificate Store/FileName3',
        ],
        sslCertificate: '/Environment Configuration/Certificate Store/FileName1.fileending',
        passwords: 'LONG_PASSWORD',
      },
    });
  });

  it('loads stages with compact sequences and still exposes scalar leaves', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-compact-seq-'));
    const compactEnv = path.join(tmp, 'ENV');
    fs.mkdirSync(path.join(compactEnv, 'DEVL'), { recursive: true });
    fs.writeFileSync(
      path.join(compactEnv, 'DEVL', 'values.yaml'),
      [
        'Cassandra_Settings:',
        '  passwords: |-',
        '    LONG_PASSWORD',
        '  sslTrustedCerts:',
        '  - /path/one',
        '  - /path/two',
        '',
      ].join('\n'),
    );

    const model = loadEnvValuesSession(compactEnv);
    expect(model.documents.DEVL.parseError).toBeUndefined();
    expect(findLeaf(model.tree, 'Cassandra_Settings.passwords')?.cells?.DEVL).toEqual({
      kind: 'value',
      value: 'LONG_PASSWORD',
    });
    expect(findLeaf(model.tree, 'Cassandra_Settings.sslTrustedCerts')?.cells?.DEVL).toEqual({
      kind: 'list',
      values: ['/path/one', '/path/two'],
    });
  });

  it('treats empty string as present value, not missing', () => {
    const parsed = parseEnvValuesYaml('A:\n  AA: ""\n');
    expect(parsed.error).toBeUndefined();
    expect(parsed.data).toEqual({ A: { AA: '' } });
  });

  it('parses literal block scalars (|)', () => {
    const parsed = parseEnvValuesYaml('A:\n  script: |\n    line1\n    line2\n  AA: ok\n');
    expect(parsed.error).toBeUndefined();
    expect(parsed.data).toEqual({
      A: {
        script: 'line1\nline2\n',
        AA: 'ok',
      },
    });
  });

  it('parses folded block scalars (>) and chomping (-)', () => {
    const folded = parseEnvValuesYaml('msg: >\n  hello\n  world\n');
    expect(folded.error).toBeUndefined();
    expect(folded.data).toEqual({ msg: 'hello world\n' });

    const stripped = parseEnvValuesYaml('msg: |-\n  hello\n  world\n');
    expect(stripped.error).toBeUndefined();
    expect(stripped.data).toEqual({ msg: 'hello\nworld' });
  });

  it('preserves blank lines inside literal block scalars', () => {
    const parsed = parseEnvValuesYaml('body: |\n  a\n\n  b\n');
    expect(parsed.error).toBeUndefined();
    expect(parsed.data).toEqual({ body: 'a\n\nb\n' });
  });

  it('loads stage files that use block scalars without parse errors', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-block-'));
    const blockEnv = path.join(tmp, 'ENV');
    fs.mkdirSync(path.join(blockEnv, 'DEVL'), { recursive: true });
    fs.writeFileSync(
      path.join(blockEnv, 'DEVL', 'values.yaml'),
      'A:\n  script: |\n    return true;\n  AA: Inhalt\n',
    );
    const model = loadEnvValuesSession(blockEnv);
    expect(model.documents.DEVL.parseError).toBeUndefined();
    expect(findLeaf(model.tree, 'A.script')?.cells?.DEVL).toEqual({
      kind: 'value',
      value: 'return true;\n',
    });
  });

  it('rejects null or empty YAML root but accepts empty mapping', () => {
    expect(parseEnvValuesYaml('').error).toBeTruthy();
    expect(parseEnvValuesYaml('null').error).toBeTruthy();
    expect(parseEnvValuesYaml('~').error).toBeTruthy();
    const empty = parseEnvValuesYaml('{}\n');
    expect(empty.error).toBeUndefined();
    expect(empty.data).toEqual({});
  });

  it('treats scalar lists as editable leaves', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-scalar-list-'));
    const listEnv = path.join(tmp, 'ENV');
    fs.mkdirSync(path.join(listEnv, 'DEVL'), { recursive: true });
    fs.mkdirSync(path.join(listEnv, 'TEST'), { recursive: true });
    fs.writeFileSync(
      path.join(listEnv, 'DEVL', 'values.yaml'),
      [
        'Cassandra_Settings:',
        '  sslTrustedCerts:',
        '  - /Environment/Development/sslClientIssuingCA.pem',
        '  - /Environment/Development/sslRootCA.pem',
        '  password: secret',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(listEnv, 'TEST', 'values.yaml'),
      [
        'Cassandra_Settings:',
        '  sslTrustedCerts:',
        '  - /Environment/Test/sslRootCA.pem',
        '  password: secret-test',
        '',
      ].join('\n'),
    );

    const model = loadEnvValuesSession(listEnv);
    const certs = findLeaf(model.tree, 'Cassandra_Settings.sslTrustedCerts');
    expect(certs?.cells?.DEVL).toEqual({
      kind: 'list',
      values: [
        '/Environment/Development/sslClientIssuingCA.pem',
        '/Environment/Development/sslRootCA.pem',
      ],
    });
    expect(certs?.cells?.TEST).toEqual({
      kind: 'list',
      values: ['/Environment/Test/sslRootCA.pem'],
    });
  });

  it('loads sslTrustedCerts lists from the example-repo fixture', () => {
    const exampleEnv = path.join(
      __dirname,
      '..',
      'example-repo',
      '202602',
      'policies',
      'NAME_ONE',
      'ENV',
    );
    const model = loadEnvValuesSession(exampleEnv);
    expect(model.documents.DEVL?.parseError).toBeUndefined();
    const certs = findLeaf(model.tree, 'Cassandra_Settings.sslTrustedCerts');
    expect(certs?.cells?.DEVL?.kind).toBe('list');
    if (certs?.cells?.DEVL?.kind === 'list') {
      expect(certs.cells.DEVL.values).toContain(
        '/Environment/Development/sslClientIssuingCA.pem',
      );
    }
  });

  it('warns when a stage contains a non-scalar array path', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-array-'));
    const arrayEnv = path.join(tmp, 'ENV');
    fs.mkdirSync(path.join(arrayEnv, 'DEVL'), { recursive: true });
    fs.mkdirSync(path.join(arrayEnv, 'TEST'), { recursive: true });
    fs.writeFileSync(
      path.join(arrayEnv, 'DEVL', 'values.yaml'),
      'items:\n  - name: one\n    value: 1\nA:\n  AA: ok\n',
    );
    fs.writeFileSync(path.join(arrayEnv, 'TEST', 'values.yaml'), 'A:\n  AA: ok\n');
    const model = loadEnvValuesSession(arrayEnv);
    expect(
      model.warnings.some((w) => w.includes('items') && w.toLowerCase().includes('non-scalar')),
    ).toBe(true);
    expect(findLeaf(model.tree, 'items')).toBeUndefined();
  });

  it('marks BAB missing in TEST but present in DEVL', () => {
    const model = loadEnvValuesSession(envRoot);
    const bab = findLeaf(model.tree, 'B.BA.BAB');
    expect(bab?.cells?.DEVL).toEqual({ kind: 'value', value: 'Inhalt3' });
    expect(bab?.cells?.TEST).toEqual({ kind: 'missing' });
    expect(model.warnings.some((w) => w.includes('B.BA.BAB') && w.includes('TEST'))).toBe(true);
  });

  it('loads AA values for both stages', () => {
    const model = loadEnvValuesSession(envRoot);
    const aa = findLeaf(model.tree, 'A.AA');
    expect(aa?.cells?.DEVL).toEqual({ kind: 'value', value: 'Inhalt' });
    expect(aa?.cells?.TEST).toEqual({ kind: 'value', value: 'Inhalt-test' });
  });

  it('isolates invalid YAML to one stage', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-bad-'));
    const badEnv = path.join(tmp, 'ENV');
    fs.mkdirSync(path.join(badEnv, 'DEVL'), { recursive: true });
    fs.mkdirSync(path.join(badEnv, 'TEST'), { recursive: true });
    fs.writeFileSync(path.join(badEnv, 'DEVL', 'values.yaml'), 'A:\n  AA: ok\n');
    fs.writeFileSync(path.join(badEnv, 'TEST', 'values.yaml'), 'A: [\n');
    const model = loadEnvValuesSession(badEnv);
    expect(model.documents.TEST.parseError).toBeTruthy();
    expect(model.documents.DEVL.parseError).toBeUndefined();
    const aa = findLeaf(model.tree, 'A.AA');
    expect(aa?.cells?.DEVL).toEqual({ kind: 'value', value: 'ok' });
  });

  it('warns on map vs scalar structural conflict', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-conflict-'));
    const conflictEnv = path.join(tmp, 'ENV');
    fs.mkdirSync(path.join(conflictEnv, 'DEVL'), { recursive: true });
    fs.mkdirSync(path.join(conflictEnv, 'TEST'), { recursive: true });
    fs.writeFileSync(path.join(conflictEnv, 'DEVL', 'values.yaml'), 'A:\n  AA: scalar\n');
    fs.writeFileSync(path.join(conflictEnv, 'TEST', 'values.yaml'), 'A:\n  AA:\n    nested: x\n');
    const model = loadEnvValuesSession(conflictEnv);
    expect(model.warnings.some((w) => w.toLowerCase().includes('conflict'))).toBe(true);
    expect(collectNodesWithCellsAndChildren(model.tree)).toEqual([]);
  });
});

describe('env values mutations', () => {
  it('setLeafValue updates one stage and marks it dirty', () => {
    const model = loadEnvValuesSession(envRoot);
    const next = setLeafValue(model, 'A.AA', 'DEVL', 'changed');
    expect(findLeaf(next.tree, 'A.AA')?.cells?.DEVL).toEqual({ kind: 'value', value: 'changed' });
    expect(next.documents.DEVL.dirty).toBe(true);
    expect(next.documents.TEST.dirty).toBe(false);
  });

  it('createMissing inserts empty string for TEST BAB', () => {
    const model = loadEnvValuesSession(envRoot);
    const next = createMissing(model, 'B.BA.BAB', 'TEST');
    expect(findLeaf(next.tree, 'B.BA.BAB')?.cells?.TEST).toEqual({ kind: 'value', value: '' });
    expect(next.documents.TEST.dirty).toBe(true);
  });

  it('setListValue updates a scalar list and createMissing inserts [] for list paths', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-list-mut-'));
    const listEnv = path.join(tmp, 'ENV');
    fs.mkdirSync(path.join(listEnv, 'DEVL'), { recursive: true });
    fs.mkdirSync(path.join(listEnv, 'TEST'), { recursive: true });
    fs.writeFileSync(
      path.join(listEnv, 'DEVL', 'values.yaml'),
      'certs:\n- a.pem\n- b.pem\n',
    );
    fs.writeFileSync(path.join(listEnv, 'TEST', 'values.yaml'), 'other: x\n');

    const model = loadEnvValuesSession(listEnv);
    const edited = setListValue(model, 'certs', 'DEVL', ['only.pem']);
    expect(findLeaf(edited.tree, 'certs')?.cells?.DEVL).toEqual({
      kind: 'list',
      values: ['only.pem'],
    });
    expect(edited.documents.DEVL.dirty).toBe(true);

    const created = createMissing(edited, 'certs', 'TEST');
    expect(findLeaf(created.tree, 'certs')?.cells?.TEST).toEqual({ kind: 'list', values: [] });
  });

  it('addKey creates path in all stages', () => {
    const model = loadEnvValuesSession(envRoot);
    const next = addKey(model, 'C.CA');
    expect(findLeaf(next.tree, 'C.CA')?.cells?.DEVL).toEqual({ kind: 'value', value: '' });
    expect(findLeaf(next.tree, 'C.CA')?.cells?.TEST).toEqual({ kind: 'value', value: '' });
    expect(next.documents.DEVL.dirty).toBe(true);
    expect(next.documents.TEST.dirty).toBe(true);
  });

  it('removeKey deletes path from all stages', () => {
    const model = loadEnvValuesSession(envRoot);
    const next = removeKey(model, 'A.AA');
    expect(findLeaf(next.tree, 'A.AA')).toBeUndefined();
    expect(next.documents.DEVL.dirty).toBe(true);
    expect(next.documents.TEST.dirty).toBe(true);
  });

  it('removeKey prunes empty parent maps so save does not write {} stubs', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-prune-'));
    const pruneEnv = path.join(tmp, 'ENV');
    fs.mkdirSync(path.join(pruneEnv, 'DEVL'), { recursive: true });
    fs.writeFileSync(
      path.join(pruneEnv, 'DEVL', 'values.yaml'),
      ['---', 'Cassandra_Settings:', '  host: db.local', 'Other: keep', ''].join('\n'),
    );

    let model = loadEnvValuesSession(pruneEnv);
    model = removeKey(model, 'Cassandra_Settings.host');
    expect(model.documents.DEVL.data).toEqual({ Other: 'keep' });
    expect(model.documents.DEVL.data).not.toHaveProperty('Cassandra_Settings');

    writeDirtyEnvDocuments(model);
    const written = fs.readFileSync(path.join(pruneEnv, 'DEVL', 'values.yaml'), 'utf8');
    expect(written).toBe('---\nOther: keep');
    expect(written).not.toContain('{}');
    expect(written).not.toContain('Cassandra_Settings');
  });

  it('removeKey clearing the last key writes an empty file without {}', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-empty-doc-'));
    const emptyEnv = path.join(tmp, 'ENV');
    fs.mkdirSync(path.join(emptyEnv, 'DEVL'), { recursive: true });
    fs.writeFileSync(
      path.join(emptyEnv, 'DEVL', 'values.yaml'),
      '---\nOnly:\n  Key: value\n',
    );

    let model = loadEnvValuesSession(emptyEnv);
    model = removeKey(model, 'Only.Key');
    expect(model.documents.DEVL.data).toEqual({});

    writeDirtyEnvDocuments(model);
    const written = fs.readFileSync(path.join(emptyEnv, 'DEVL', 'values.yaml'), 'utf8');
    expect(written).toBe('---');
    expect(written).not.toContain('{}');
  });

  it('setLeafValue refuses when stage has parseError', () => {
    const model = loadEnvValuesSession(createParseErrorEnv());
    const next = setLeafValue(model, 'A.AA', 'TEST', 'changed');
    expect(next).toBe(model);
    expect(next.documents.TEST.dirty).toBe(false);
  });

  it('createMissing refuses when stage has parseError', () => {
    const model = loadEnvValuesSession(createParseErrorEnv());
    const next = createMissing(model, 'A.AA', 'TEST');
    expect(next).toBe(model);
    expect(next.documents.TEST.dirty).toBe(false);
  });

  it('setLeafValue refuses when cell is conflict', () => {
    const model = loadEnvValuesSession(createMapVsScalarConflictEnv());
    const next = setLeafValue(model, 'A.AA', 'DEVL', 'changed');
    expect(next).toBe(model);
    expect(next.documents.DEVL.dirty).toBe(false);
  });

  it('createMissing refuses when cell is conflict', () => {
    const model = loadEnvValuesSession(createMapVsScalarConflictEnv());
    const next = createMissing(model, 'A.AA', 'TEST');
    expect(next).toBe(model);
    expect(next.documents.TEST.dirty).toBe(false);
  });

  it('createMissing refuses when cell is value not missing', () => {
    const model = loadEnvValuesSession(envRoot);
    const next = createMissing(model, 'B.BA.BAB', 'DEVL');
    expect(next).toBe(model);
    expect(next.documents.DEVL.dirty).toBe(false);
  });

  it('addKey refuses when path would overwrite a scalar intermediate', () => {
    const model = loadEnvValuesSession(envRoot);
    const next = addKey(model, 'A.AA.NEW');
    expect(next).toBe(model);
    expect(findLeaf(next.tree, 'A.AA')?.cells?.DEVL).toEqual({ kind: 'value', value: 'Inhalt' });
    expect(findLeaf(next.tree, 'A.AA')?.cells?.TEST).toEqual({ kind: 'value', value: 'Inhalt-test' });
    expect(findLeaf(next.tree, 'A.AA.NEW')).toBeUndefined();
    expect(next.documents.DEVL.dirty).toBe(false);
    expect(next.documents.TEST.dirty).toBe(false);
  });

  it('addKey refuses to overwrite a key that already exists in any stage', () => {
    const model = loadEnvValuesSession(envRoot);
    const next = addKey(model, 'A.AA');
    expect(next).toBe(model);
    expect(findLeaf(next.tree, 'A.AA')?.cells?.DEVL).toEqual({ kind: 'value', value: 'Inhalt' });
    expect(findLeaf(next.tree, 'A.AA')?.cells?.TEST).toEqual({
      kind: 'value',
      value: 'Inhalt-test',
    });
    expect(next.documents.DEVL.dirty).toBe(false);
    expect(next.documents.TEST.dirty).toBe(false);
  });

  it('addKey refuses when any stage has conflict at path', () => {
    const model = loadEnvValuesSession(createMapVsScalarConflictEnv());
    const next = addKey(model, 'A.AA');
    expect(next).toBe(model);
    expect(next.documents.DEVL.dirty).toBe(false);
    expect(next.documents.TEST.dirty).toBe(false);
  });
});

describe('env values prototype pollution guard', () => {
  it('hasForbiddenPathSegment flags __proto__, prototype, and constructor exactly', () => {
    expect(hasForbiddenPathSegment('__proto__')).toBe(true);
    expect(hasForbiddenPathSegment('__proto__.x')).toBe(true);
    expect(hasForbiddenPathSegment('a.prototype.x')).toBe(true);
    expect(hasForbiddenPathSegment('a.constructor')).toBe(true);
    expect(hasForbiddenPathSegment('a.b.c')).toBe(false);
    // Case-sensitive exact segment match only.
    expect(hasForbiddenPathSegment('__PROTO__')).toBe(false);
    expect(hasForbiddenPathSegment('myConstructorField')).toBe(false);
  });

  it('setValueAtPath throws instead of writing __proto__/prototype/constructor segments', () => {
    const data: Record<string, unknown> = {};
    expect(() => setValueAtPath(data, '__proto__.polluted', 'x')).toThrow();
    expect(() => setValueAtPath(data, 'a.prototype.polluted', 'x')).toThrow();
    expect(() => setValueAtPath(data, 'a.constructor.polluted', 'x')).toThrow();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('setValueAtPath refuses when a scalar intermediate would be overwritten', () => {
    const data: Record<string, unknown> = { A: { AA: 'scalar' } };
    expect(setValueAtPath(data, 'A.AA.NEW', '')).toBe(false);
    expect(data).toEqual({ A: { AA: 'scalar' } });
  });

  it('deleteValueAtPath throws instead of touching __proto__/prototype/constructor segments', () => {
    const data: Record<string, unknown> = {};
    expect(() => deleteValueAtPath(data, '__proto__.polluted')).toThrow();
  });

  it('addKey(model, "__proto__.x") does not pollute Object.prototype and does not succeed', () => {
    const model = loadEnvValuesSession(envRoot);
    const next = addKey(model, '__proto__.x');
    expect(next).toBe(model);
    expect(next.documents.DEVL.dirty).toBe(false);
    expect(next.documents.TEST.dirty).toBe(false);
    expect(findLeaf(next.tree, '__proto__.x')).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).x).toBeUndefined();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it('addKey refuses "prototype" and "constructor" segments too', () => {
    const model = loadEnvValuesSession(envRoot);
    expect(addKey(model, 'A.prototype')).toBe(model);
    expect(addKey(model, 'A.constructor')).toBe(model);
  });

  it('setLeafValue, createMissing, and removeKey all refuse forbidden segments', () => {
    const model = loadEnvValuesSession(envRoot);
    expect(setLeafValue(model, '__proto__.x', 'DEVL', 'y')).toBe(model);
    expect(createMissing(model, '__proto__.x', 'DEVL')).toBe(model);
    expect(removeKey(model, '__proto__.x')).toBe(model);
    expect((Object.prototype as Record<string, unknown>).x).toBeUndefined();
  });
});

describe('resolveAddKeyPath', () => {
  it('uses a dotted input as an absolute path regardless of selection', () => {
    expect(resolveAddKeyPath('A.AA', 'B.NEW')).toBe('B.NEW');
    expect(resolveAddKeyPath(undefined, 'B.NEW')).toBe('B.NEW');
  });

  it('joins a dot-free input as a sibling of the selected path', () => {
    expect(resolveAddKeyPath('A.AA', 'NEW')).toBe('A.NEW');
    expect(resolveAddKeyPath('A.AA', '  NEW  ')).toBe('A.NEW');
  });

  it('uses the dot-free input at root when selection has no parent', () => {
    expect(resolveAddKeyPath('AA', 'NEW')).toBe('NEW');
  });

  it('uses the dot-free input as-is when nothing is selected', () => {
    expect(resolveAddKeyPath(undefined, 'NEW')).toBe('NEW');
  });

  it('trims whitespace from dotted absolute input', () => {
    expect(resolveAddKeyPath(undefined, '  B.NEW  ')).toBe('B.NEW');
  });
});

describe('renderEnvValuesEditorHtml empty state', () => {
  it('shows an explanatory empty state when there are no stages', () => {
    const emptyModel: EnvValuesModel = {
      envRoot: '/example/ENV',
      stages: [],
      documents: {},
      tree: [],
      warnings: [],
    };
    const html = renderEnvValuesEditorHtml(emptyModel);
    expect(html).toContain('No ENV stages found');
    expect(html).toContain('values.yaml');
    expect(html).toContain('/example/ENV');
    expect(html).not.toContain('id="tree"');
  });

  it('renders the normal tree/detail layout when stages are present', () => {
    const model = loadEnvValuesSession(envRoot);
    const html = renderEnvValuesEditorHtml(model);
    expect(html).toContain('id="tree"');
    expect(html).toContain('id="detail"');
    expect(html).not.toContain('No ENV stages found');
  });

  it('renders scalar lists as per-item inputs with add/remove controls', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-list-ui-'));
    const listEnv = path.join(tmp, 'ENV');
    fs.mkdirSync(path.join(listEnv, 'DEVL'), { recursive: true });
    fs.writeFileSync(
      path.join(listEnv, 'DEVL', 'values.yaml'),
      'certs:\n- a.pem\n- b.pem\n',
    );

    const model = loadEnvValuesSession(listEnv);
    const html = renderEnvValuesEditorHtml(model, 'certs');
    expect(html).toContain('class="list-editor"');
    expect(html).toContain('class="list-item-input"');
    expect(html).toContain('class="list-remove"');
    expect(html).toContain('class="list-add"');
    expect(html).not.toContain('class="list-input"');
    expect(html).not.toContain('One list item per line');
  });
});

describe('env values writer', () => {
  it('writes only dirty stages and round-trips values', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-write-'));
    const writeEnv = path.join(tmp, 'ENV');
    fs.mkdirSync(path.join(writeEnv, 'DEVL'), { recursive: true });
    fs.mkdirSync(path.join(writeEnv, 'TEST'), { recursive: true });
    fs.writeFileSync(path.join(writeEnv, 'DEVL', 'values.yaml'), 'A:\n  AA: one\n');
    fs.writeFileSync(path.join(writeEnv, 'TEST', 'values.yaml'), 'A:\n  AA: two\n');

    let model = loadEnvValuesSession(writeEnv);
    model = setLeafValue(model, 'A.AA', 'DEVL', 'updated');
    const result = writeDirtyEnvDocuments(model);

    expect(result.written).toEqual([path.join(writeEnv, 'DEVL', 'values.yaml')]);
    expect(result.model.documents.DEVL.dirty).toBe(false);

    const reloaded = loadEnvValuesSession(writeEnv);
    expect(findLeaf(reloaded.tree, 'A.AA')?.cells?.DEVL).toEqual({
      kind: 'value',
      value: 'updated',
    });
    expect(findLeaf(reloaded.tree, 'A.AA')?.cells?.TEST).toEqual({
      kind: 'value',
      value: 'two',
    });
  });

  it('preserves document start, compact list indent, and single quotes on save', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-style-'));
    const writeEnv = path.join(tmp, 'ENV');
    fs.mkdirSync(path.join(writeEnv, 'DEVL'), { recursive: true });
    const original = [
      '---',
      'Cassandra_Settings:',
      "  host: 'db.example.local'",
      '  sslTrustedCerts:',
      '  - /Environment Configuration/Certificate Store/FileName2',
      '  - /Environment Configuration/Certificate Store/FileName3',
      '  sslCertificate: /Environment Configuration/Certificate Store/FileName1.fileending',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(writeEnv, 'DEVL', 'values.yaml'), original);

    let model = loadEnvValuesSession(writeEnv);
    expect(model.documents.DEVL.style?.documentStart).toBe(true);
    expect(model.documents.DEVL.style?.lists['Cassandra_Settings.sslTrustedCerts']).toBe(
      'compact',
    );
    expect(model.documents.DEVL.style?.quotes['Cassandra_Settings.host']).toBe('single');

    model = setLeafValue(model, 'Cassandra_Settings.host', 'DEVL', 'db2.example.local');
    writeDirtyEnvDocuments(model);

    const written = fs.readFileSync(path.join(writeEnv, 'DEVL', 'values.yaml'), 'utf8');
    expect(written.startsWith('---\n')).toBe(true);
    expect(written).toContain("host: 'db2.example.local'");
    expect(written).toContain('  sslTrustedCerts:\n  - /Environment Configuration');
    expect(written).not.toMatch(/sslTrustedCerts:\n {4}- /);
    expect(written.endsWith('\n')).toBe(false);
  });

  it('preserves existing mapping key order and appends new keys', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-key-order-'));
    const writeEnv = path.join(tmp, 'ENV');
    fs.mkdirSync(path.join(writeEnv, 'DEVL'), { recursive: true });
    fs.writeFileSync(
      path.join(writeEnv, 'DEVL', 'values.yaml'),
      ['---', 'Zebra: 1', 'Alpha:', '  inner: old', ''].join('\n'),
    );

    let model = loadEnvValuesSession(writeEnv);
    model = setLeafValue(model, 'Alpha.inner', 'DEVL', 'new');
    model = addKey(model, 'Alpha.added');
    writeDirtyEnvDocuments(model);

    const written = fs.readFileSync(path.join(writeEnv, 'DEVL', 'values.yaml'), 'utf8');
    expect(written).toBe('---\nZebra: 1\nAlpha:\n  inner: new\n  added: ""');
  });
});

describe('env values tool descriptor', () => {
  it('registers under Analyze with openEnvValuesEditor command', () => {
    expect(ENV_VALUES_EDITOR_TOOL.group).toBe('analyze');
    expect(ENV_VALUES_EDITOR_TOOL.command).toBe('policyStudioTools.openEnvValuesEditor');
    expect(ENV_VALUES_EDITOR_TOOL.available).toBe(true);
  });
});

describe('pickProjectRootForEnvEditor', () => {
  const projectA: PolicyStudioProject = {
    id: 'a',
    rootPath: '/repo/a',
    workspaceFolder: 'file:///repo',
    relativePath: 'a',
    displayName: 'Project A',
    projectType: 'yaml',
  };
  const projectB: PolicyStudioProject = {
    id: 'b',
    rootPath: '/repo/b',
    workspaceFolder: 'file:///repo',
    relativePath: 'b',
    displayName: 'Project B',
    projectType: 'yaml',
  };

  it('prefers the active project when present in the list', () => {
    const picked = pickProjectRootForEnvEditor(
      [projectA, projectB],
      { mode: 'activeProject', activeProjectId: 'b' },
    );
    expect(picked).toBe(projectB);
  });

  it('falls back to the single project when scope has no matching active project', () => {
    const picked = pickProjectRootForEnvEditor([projectA], { mode: 'allProjects' });
    expect(picked).toBe(projectA);
  });

  it('returns undefined when multiple projects and no active project match', () => {
    const picked = pickProjectRootForEnvEditor([projectA, projectB], { mode: 'allProjects' });
    expect(picked).toBeUndefined();
  });

  it('returns undefined when there are no projects', () => {
    expect(pickProjectRootForEnvEditor([], { mode: 'allProjects' })).toBeUndefined();
  });

  it('prefers a sole selected project', () => {
    const picked = pickProjectRootForEnvEditor([projectA, projectB], {
      mode: 'selectedProjects',
      selectedProjectIds: ['a'],
    });
    expect(picked).toBe(projectA);
  });
});

describe('resolveEnvOpenDecision', () => {
  const projectA: PolicyStudioProject = {
    id: 'a',
    rootPath: '/repo/NAME_ONE/NAME_ONE_YAML',
    relativePath: 'NAME_ONE/NAME_ONE_YAML',
    displayName: 'NAME_ONE_YAML',
    projectType: 'yaml',
  };
  const projectB: PolicyStudioProject = {
    id: 'b',
    rootPath: '/repo/PAYMENT_API/PAYMENT_API_YAML',
    relativePath: 'PAYMENT_API/PAYMENT_API_YAML',
    displayName: 'PAYMENT_API_YAML',
    projectType: 'yaml',
  };

  const candidateA: EnvRootCandidate = {
    envRoot: '/repo/NAME_ONE/ENV',
    project: projectA,
    bundleName: 'NAME_ONE',
    stageIds: ['DEVL', 'TEST'],
  };
  const candidateB: EnvRootCandidate = {
    envRoot: '/repo/PAYMENT_API/ENV',
    project: projectB,
    bundleName: 'PAYMENT_API',
    stageIds: ['DEVL'],
  };

  it('opens the ENV that belongs to the active policy project', () => {
    const decision = resolveEnvOpenDecision([candidateA, candidateB], {
      mode: 'activeProject',
      activeProjectId: 'b',
    });
    expect(decision).toEqual({ kind: 'open', candidate: candidateB });
  });

  it('opens the sole candidate when there is no active preference', () => {
    const decision = resolveEnvOpenDecision([candidateA], { mode: 'allProjects' });
    expect(decision).toEqual({ kind: 'open', candidate: candidateA });
  });

  it('asks the user to pick when multiple ENVs and no active project', () => {
    const decision = resolveEnvOpenDecision([candidateA, candidateB], {
      mode: 'allProjects',
    });
    expect(decision).toEqual({ kind: 'pick' });
  });

  it('returns none when there are no ENV candidates', () => {
    expect(resolveEnvOpenDecision([], { mode: 'allProjects' })).toEqual({ kind: 'none' });
  });
});

describe('findEnvCandidateForProject', () => {
  it('finds the ENV candidate matching a project id', () => {
    const projectA: PolicyStudioProject = {
      id: 'a',
      rootPath: '/repo/a',
      relativePath: 'a',
      displayName: 'A',
      projectType: 'yaml',
    };
    const projectB: PolicyStudioProject = {
      id: 'b',
      rootPath: '/repo/b',
      relativePath: 'b',
      displayName: 'B',
      projectType: 'yaml',
    };
    const candidates: EnvRootCandidate[] = [
      {
        envRoot: '/repo/a/ENV',
        project: projectA,
        bundleName: 'a',
        stageIds: ['DEVL'],
      },
      {
        envRoot: '/repo/b/ENV',
        project: projectB,
        bundleName: 'b',
        stageIds: ['DEVL'],
      },
    ];
    expect(findEnvCandidateForProject(candidates, 'b')?.envRoot).toBe('/repo/b/ENV');
    expect(findEnvCandidateForProject(candidates, 'missing')).toBeUndefined();
  });
});

describe('resolveEnvFollowActiveProject', () => {
  const projectA: PolicyStudioProject = {
    id: 'a',
    rootPath: '/repo/NAME_ONE/NAME_ONE_YAML',
    relativePath: 'NAME_ONE/NAME_ONE_YAML',
    displayName: 'NAME_ONE_YAML',
    projectType: 'yaml',
  };
  const projectB: PolicyStudioProject = {
    id: 'b',
    rootPath: '/repo/PAYMENT_API/PAYMENT_API_YAML',
    relativePath: 'PAYMENT_API/PAYMENT_API_YAML',
    displayName: 'PAYMENT_API_YAML',
    projectType: 'yaml',
  };
  const projectNoEnv: PolicyStudioProject = {
    id: 'c',
    rootPath: '/repo/BARE/BARE_YAML',
    relativePath: 'BARE/BARE_YAML',
    displayName: 'BARE_YAML',
    projectType: 'yaml',
  };

  const candidateA: EnvRootCandidate = {
    envRoot: '/repo/NAME_ONE/ENV',
    project: projectA,
    bundleName: 'NAME_ONE',
    stageIds: ['DEVL', 'TEST'],
  };
  const candidateB: EnvRootCandidate = {
    envRoot: '/repo/PAYMENT_API/ENV',
    project: projectB,
    bundleName: 'PAYMENT_API',
    stageIds: ['DEVL'],
  };

  const allProjects = [projectA, projectB, projectNoEnv];
  const candidates = [candidateA, candidateB];

  it('switches to the ENV of the newly selected active project', () => {
    const decision = resolveEnvFollowActiveProject(
      candidates,
      allProjects,
      { mode: 'activeProject', activeProjectId: 'b' },
      candidateA.envRoot,
    );
    expect(decision).toEqual({ kind: 'switch', candidate: candidateB });
  });

  it('is a no-op when the editor already shows that project ENV', () => {
    const decision = resolveEnvFollowActiveProject(
      candidates,
      allProjects,
      { mode: 'activeProject', activeProjectId: 'a' },
      candidateA.envRoot,
    );
    expect(decision).toEqual({ kind: 'noop' });
  });

  it('reports missing when the selected project has no sibling ENV', () => {
    const decision = resolveEnvFollowActiveProject(
      candidates,
      allProjects,
      { mode: 'activeProject', activeProjectId: 'c' },
      candidateA.envRoot,
    );
    expect(decision).toEqual({ kind: 'missing', projectDisplayName: 'BARE_YAML' });
  });

  it('does not switch when scope has no preferred project', () => {
    const decision = resolveEnvFollowActiveProject(
      candidates,
      allProjects,
      { mode: 'allProjects' },
      candidateA.envRoot,
    );
    expect(decision).toEqual({ kind: 'noop' });
  });
});

describe('env tree view helpers', () => {
  const tree: EnvTreeNode[] = [
    {
      name: 'Cassandra_Settings',
      path: 'Cassandra_Settings',
      children: [
        {
          name: 'sslTrustedCerts',
          path: 'Cassandra_Settings.sslTrustedCerts',
          cells: {
            DEVL: { kind: 'list', values: ['/certs/a.pem'] },
            TEST: { kind: 'missing' },
          },
        },
        {
          name: 'host',
          path: 'Cassandra_Settings.host',
          cells: {
            DEVL: { kind: 'value', value: 'db.local' },
            TEST: { kind: 'value', value: 'db.test' },
          },
        },
      ],
    },
    {
      name: 'Solo',
      path: 'Solo',
      children: [
        {
          name: 'Only',
          path: 'Solo.Only',
          children: [
            {
              name: 'Leaf',
              path: 'Solo.Only.Leaf',
              cells: {
                DEVL: { kind: 'value', value: 'one' },
                TEST: { kind: 'value', value: 'one' },
              },
            },
          ],
        },
      ],
    },
  ];

  it('marks missing on the leaf and ancestors', () => {
    expect(nodeOrDescendantHasMissing(tree[0].children![0])).toBe(true);
    expect(nodeOrDescendantHasMissing(tree[0])).toBe(true);
    expect(nodeOrDescendantHasMissing(tree[0].children![1])).toBe(false);
  });

  it('filters by key path and by value content', () => {
    const byKey = filterEnvTree(tree, 'sslTrusted');
    expect(byKey).toHaveLength(1);
    expect(byKey[0].children?.map((child) => child.path)).toEqual([
      'Cassandra_Settings.sslTrustedCerts',
    ]);

    const byValue = filterEnvTree(tree, 'a.pem');
    expect(byValue[0].children?.[0].path).toBe('Cassandra_Settings.sslTrustedCerts');

    const byHost = filterEnvTree(tree, 'db.test');
    expect(byHost[0].children?.[0].path).toBe('Cassandra_Settings.host');
  });

  it('auto-expands singleton chains from a opened branch', () => {
    const soloOnly = [tree[1]];
    expect(collectSingletonExpandPaths(soloOnly)).toEqual(['Solo', 'Solo.Only']);
    expect(collectSingletonExpandPaths(tree, 'Solo')).toEqual(['Solo', 'Solo.Only']);
  });

  it('resolveExpandedPaths merges user opens with singleton auto-expand', () => {
    const expanded = resolveExpandedPaths(tree, ['Cassandra_Settings']);
    expect(expanded.has('Cassandra_Settings')).toBe(true);
    // Cassandra_Settings has two children — do not auto-descend further.
    expect(expanded.has('Cassandra_Settings.sslTrustedCerts')).toBe(false);
  });

  it('renders missing leaves with yellow class and keeps a search box', () => {
    const model = loadEnvValuesSession(envRoot);
    const html = renderEnvValuesEditorHtml(model, 'B.BA.BAB', 'sample', {
      expandedPaths: new Set(['B', 'B.BA']),
      searchQuery: 'BAB',
    });
    expect(html).toContain('id="tree-search"');
    expect(html).toContain('status-missing');
    expect(html).toContain('missing-highlight');
    expect(html).toContain('data-search=');
    // Full tree stays in HTML; filtering is client-side (avoids re-render flicker).
    expect(html).toContain('data-path="A.AA"');
    expect(html).toContain('value="BAB"');
    expect(html).toMatch(/details[^>]*data-path="B"[^>]*open|details[^>]*open[^>]*data-path="B"/);
    expect(html).toContain('applyTreeFilter');
  });
});

function createParseErrorEnv(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-bad-'));
  const badEnv = path.join(tmp, 'ENV');
  fs.mkdirSync(path.join(badEnv, 'DEVL'), { recursive: true });
  fs.mkdirSync(path.join(badEnv, 'TEST'), { recursive: true });
  fs.writeFileSync(path.join(badEnv, 'DEVL', 'values.yaml'), 'A:\n  AA: ok\n');
  fs.writeFileSync(path.join(badEnv, 'TEST', 'values.yaml'), 'A: [\n');
  return badEnv;
}

function createMapVsScalarConflictEnv(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-conflict-'));
  const conflictEnv = path.join(tmp, 'ENV');
  fs.mkdirSync(path.join(conflictEnv, 'DEVL'), { recursive: true });
  fs.mkdirSync(path.join(conflictEnv, 'TEST'), { recursive: true });
  fs.writeFileSync(path.join(conflictEnv, 'DEVL', 'values.yaml'), 'A:\n  AA: scalar\n');
  fs.writeFileSync(path.join(conflictEnv, 'TEST', 'values.yaml'), 'A:\n  AA:\n    nested: x\n');
  return conflictEnv;
}

function collectNodesWithCellsAndChildren(
  nodes: import('../../src/features/envValuesEditor/types').EnvTreeNode[],
): string[] {
  const violations: string[] = [];
  for (const node of nodes) {
    if (node.cells && node.children && node.children.length > 0) {
      violations.push(node.path);
    }
    if (node.children) {
      violations.push(...collectNodesWithCellsAndChildren(node.children));
    }
  }
  return violations;
}

function findLeaf(
  nodes: import('../../src/features/envValuesEditor/types').EnvTreeNode[],
  dotted: string,
): import('../../src/features/envValuesEditor/types').EnvTreeNode | undefined {
  const parts = dotted.split('.');
  let current = nodes;
  let node: import('../../src/features/envValuesEditor/types').EnvTreeNode | undefined;
  for (const part of parts) {
    node = current.find((n) => n.name === part);
    if (!node) {
      return undefined;
    }
    current = node.children ?? [];
  }
  return node;
}
