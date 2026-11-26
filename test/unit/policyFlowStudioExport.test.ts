import * as fs from 'fs/promises';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { buildCircuitIndex } from '../../src/features/circuitSearch/circuitIndex';
import { parsePolicyXml } from '../../src/features/circuitSearch/xmlPolicyParser';
import { parsePolicyYaml } from '../../src/features/circuitSearch/yamlPolicyParser';
import type { PolicyStudioProject } from '../../src/features/projectRegistry/types';
import { buildFlowGraph } from '../../src/features/policyFlowView/flowGraph';
import { buildPolicyTree, type PolicyTreeNode } from '../../src/features/policyFlowView/policyTree';

// Mirrors the layout of the (encrypted) example repo:
// <NAME>/<NAME>_YAML/Policies/<folder>/<policy>.yaml with _parent.yaml containers.
const projectRoot = path.join(
  __dirname,
  '..',
  'fixtures',
  'policy-flow',
  'studio-export',
  'AUTH_GATEWAY',
  'AUTH_GATEWAY_YAML',
);

function project(id: string, rootPath: string, displayName = id): PolicyStudioProject {
  return {
    id,
    rootPath,
    workspaceFolder: rootPath,
    relativePath: '',
    displayName,
    projectType: 'yaml',
  };
}

async function parseFixture(relative: string) {
  const content = await fs.readFile(path.join(projectRoot, relative), 'utf8');
  return { content, ...parsePolicyYaml(content) };
}

describe('start filter resolution — Policy Studio YAML export', () => {
  it('resolves a quoted ./ start ref even with a filter that has nested children and logging blocks', async () => {
    const { content, circuits, error } = await parseFixture('Policies/Auth/Check Token.yaml');
    expect(error).toBeUndefined();
    expect(circuits).toHaveLength(1);
    const circuit = circuits[0];

    expect(circuit.name).toBe('Check Token');
    expect(circuit.startFilter).toBe('Get Authorization Header');
    // Nested SwitchCase children and logging: blocks are not filters of the circuit.
    expect(circuit.filters.map((f) => f.name)).toEqual([
      'Get Authorization Header',
      'Token Type?',
      'Verify JWT',
      'Allow',
      'Reject: missing header',
    ]);

    const header = circuit.filters[0];
    // logging.success / logging.failure are messages, not routing targets.
    expect(header.successNode).toBe('Token Type?');
    expect(header.failureNode).toBe('Reject: missing header');
    expect(header.attributes).toEqual(['http.header.authorization']);

    const delegate = circuit.filters.find((f) => f.name === 'Verify JWT');
    expect(delegate?.circuitRef).toBe('JWT verify');

    const graph = buildFlowGraph(circuit, content);
    expect(graph.warnings).toEqual([]);
    expect(graph.nodes.find((n) => n.isStart)?.id).toBe('Get Authorization Header');
    expect(graph.nodes.every((n) => n.reachable)).toBe(true);
    expect(graph.nodes.some((n) => n.missing)).toBe(false);
  });

  it('resolves a start ref written on the next line', async () => {
    const { content, circuits } = await parseFixture('Policies/Commons/JWT verify.yaml');
    expect(circuits[0].startFilter).toBe('Verify Signature');
    expect(buildFlowGraph(circuits[0], content).warnings).toEqual([]);
  });

  it('resolves a start ref under a quoted key', async () => {
    const { circuits } = await parseFixture('Policies/Auth/Token Checks/Introspect.yaml');
    expect(circuits[0].startFilter).toBe('Call IdP');
  });

  it('resolves the start filter in a CRLF (Windows) file', async () => {
    const { content } = await parseFixture('Policies/Auth/Check Token.yaml');
    const { circuits } = parsePolicyYaml(content.replace(/\n/g, '\r\n'));
    expect(circuits[0].startFilter).toBe('Get Authorization Header');
    expect(circuits[0].filters[0].successNode).toBe('Token Type?');
  });

  it('does not treat folder containers (_parent.yaml) as policies', async () => {
    const { circuits } = await parseFixture('Policies/Auth/_parent.yaml');
    expect(circuits).toEqual([]);
  });

  it('keeps ranges pointing at the filter definition', async () => {
    const { content, circuits } = await parseFixture('Policies/Auth/Check Token.yaml');
    const allow = circuits[0].filters.find((f) => f.name === 'Allow');
    expect(content.slice(allow?.startOffset, allow?.endOffset)).toBe(
      '- type: TrueFilter\n  fields:\n    name: Allow\n',
    );
  });
});

describe('start filter resolution — line-parser fallback for malformed YAML', () => {
  it('ignores logging: messages and nested children when the document does not parse', () => {
    const content = [
      'type: FilterCircuit',
      'fields:',
      '  name: Broken',
      '  start: ./A',
      'children:',
      '- type: X',
      '  fields:',
      '    name: A',
      '    note: "unterminated',
      '  children:',
      '  - type: SwitchCase',
      '    fields:',
      '      name: case',
      '  routing:',
      '    success: ../B',
      '  logging:',
      '    success: All good',
      '- type: Y',
      '  fields:',
      '    name: B',
      '',
    ].join('\n');
    const { circuits, error } = parsePolicyYaml(content);
    expect(error).toBe('Malformed YAML');
    expect(circuits[0].name).toBe('Broken');
    expect(circuits[0].startFilter).toBe('A');
    expect(circuits[0].filters.map((f) => [f.name, f.successNode])).toEqual([
      ['A', 'B'],
      ['B', undefined],
    ]);
  });
});

describe('start filter resolution — Axway XML entity references', () => {
  it('resolves start/success/failure stored as <key> reference values', () => {
    const ref = (filter: string) =>
      `<value contentType="reference"><key type="CircuitContainer"><id field="name" value="Policies"/>` +
      `<key type="FilterCircuit"><id field="name" value="Health Check"/>` +
      `<key type="Filter"><id field="name" value="${filter}"/></key></key></key></value>`;
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<entityStoreData>
  <entity type="FilterCircuit">
    <fval name="name"><value>Health Check</value></fval>
    <fval name="start">${ref('Set Message')}</fval>
    <entity type="ChangeMessageFilter">
      <fval name="name"><value>Set Message</value></fval>
      <fval name="successNode">${ref('Reflect')}</fval>
      <fval name="failureNode">${ref('Alert &amp; Stop')}</fval>
    </entity>
    <entity type="Reflector">
      <fval name="name"><value>Reflect</value></fval>
    </entity>
    <entity type="AlertFilter">
      <fval name="name"><value>Alert &amp; Stop</value></fval>
    </entity>
  </entity>
</entityStoreData>`;
    const { circuits } = parsePolicyXml(content);
    expect(circuits).toHaveLength(1);
    const circuit = circuits[0];
    expect(circuit.name).toBe('Health Check');
    expect(circuit.startFilter).toBe('Set Message');
    expect(circuit.filters.map((f) => f.name)).toEqual(['Set Message', 'Reflect', 'Alert & Stop']);
    expect(circuit.filters[0].successNode).toBe('Reflect');
    expect(circuit.filters[0].failureNode).toBe('Alert & Stop');

    const graph = buildFlowGraph(circuit, content);
    expect(graph.warnings).toEqual([]);
    expect(graph.nodes.some((n) => n.missing)).toBe(false);
  });
});

function shape(nodes: PolicyTreeNode[]): unknown[] {
  return nodes.map((node) =>
    node.kind === 'policy' ? node.label : { [node.label]: shape(node.children) },
  );
}

describe('policy tree', () => {
  it('groups the loaded project’s policies by their Policy Studio folders', async () => {
    const index = await buildCircuitIndex(project('auth-gateway', projectRoot), { force: true });
    const tree = buildPolicyTree([index]);

    expect(shape(tree)).toEqual([
      {
        Policies: [
          { Auth: [{ 'Token Checks': ['Introspect'] }, 'Check Token'] },
          { Commons: ['JWT verify'] },
        ],
      },
    ]);

    const policies = tree[0];
    expect(policies.kind).toBe('folder');
    const auth = policies.kind === 'folder' ? policies.children[0] : undefined;
    const leaf = auth?.kind === 'folder' ? auth.children[1] : undefined;
    expect(leaf).toMatchObject({
      kind: 'policy',
      circuitName: 'Check Token',
      projectId: 'auth-gateway',
      filePath: 'Policies/Auth/Check Token.yaml',
      absolutePath: path.join(projectRoot, 'Policies', 'Auth', 'Check Token.yaml'),
    });
  });

  it('adds a project level only when several projects are in scope', async () => {
    const auth = await buildCircuitIndex(project('auth', projectRoot, 'AUTH_GATEWAY'), { force: true });
    const other = await buildCircuitIndex(
      project('flow', path.join(__dirname, '..', 'fixtures', 'policy-flow', 'list-routing'), 'LIST'),
      { force: true },
    );
    const tree = buildPolicyTree([auth, other]);
    expect(tree.map((node) => [node.kind, node.label])).toEqual([
      ['project', 'AUTH_GATEWAY'],
      ['project', 'LIST'],
    ]);
    expect(shape(tree)[1]).toEqual({ LIST: [{ Policies: ['Get Version'] }] });
  });
});
