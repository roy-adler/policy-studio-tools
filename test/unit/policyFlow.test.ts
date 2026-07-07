import * as fs from 'fs/promises';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parsePolicyXml } from '../../src/features/circuitSearch/xmlPolicyParser';
import { parsePolicyYaml } from '../../src/features/circuitSearch/yamlPolicyParser';
import { buildFlowGraph } from '../../src/features/policyFlowView/flowGraph';
import { layoutFlowGraph } from '../../src/features/policyFlowView/flowLayout';
import type { PolicyFlowGraph } from '../../src/features/policyFlowView/types';

const fixturesDir = path.join(__dirname, '..', 'fixtures', 'policy-flow');

async function loadXmlCircuit(fixture: string, file: string) {
  const content = await fs.readFile(path.join(fixturesDir, fixture, file), 'utf8');
  const { circuits } = parsePolicyXml(content);
  return { content, circuits };
}

async function loadYamlCircuit(fixture: string, file: string) {
  const content = await fs.readFile(path.join(fixturesDir, fixture, file), 'utf8');
  const { circuits } = parsePolicyYaml(content);
  return { content, circuits };
}

function edge(graph: PolicyFlowGraph, from: string, to: string) {
  return graph.edges.find((e) => e.from === from && e.to === to);
}

describe('flow link extraction — Policy Studio ./ prefix', () => {
  it('strips ./ from YAML start, success, and failure node references', () => {
    const content = `---
meta:
  type: FilterCircuit
fields:
  name: Dotted Flow
  start: ./Validate Order
children:
  Validate Order:
    meta:
      type: Check
    fields:
      name: Validate Order
      successNode: ./Store Order
      failureNode: ./Reject Order
  Store Order:
    meta:
      type: Reflector
    fields:
      name: Store Order
  Reject Order:
    meta:
      type: AlertFilter
    fields:
      name: Reject Order
`;
    const { circuits } = parsePolicyYaml(content);
    expect(circuits[0].startFilter).toBe('Validate Order');

    const validate = circuits[0].filters.find((f) => f.name === 'Validate Order');
    expect(validate?.successNode).toBe('Store Order');
    expect(validate?.failureNode).toBe('Reject Order');
  });

  it('builds a connected flow graph when links use ./ prefixes', () => {
    const content = `---
meta:
  type: FilterCircuit
fields:
  name: Dotted Flow
  start: ./Start Filter
children:
  Start Filter:
    fields:
      name: Start Filter
      successNode: ./Next Filter
  Next Filter:
    fields:
      name: Next Filter
`;
    const { circuits } = parsePolicyYaml(content);
    const graph = buildFlowGraph(circuits[0], content);

    expect(graph.nodes.find((n) => n.name === 'Start Filter')?.isStart).toBe(true);
    expect(graph.nodes.find((n) => n.name === 'Start Filter')?.reachable).toBe(true);
    expect(edge(graph, 'Start Filter', 'Next Filter')?.kind).toBe('success');
    expect(graph.warnings).toEqual([]);
  });

  it('strips ./ from Axway XML fval start and success/failure nodes', async () => {
    const { content } = await loadXmlCircuit('axway-es', 'PrimaryStore.xml');
    const dotted = content
      .replace('<fval name="start"><value>Set Message</value></fval>', '<fval name="start"><value>./Set Message</value></fval>')
      .replace('<fval name="successNode"><value>Reflect</value></fval>', '<fval name="successNode"><value>./Reflect</value></fval>')
      .replace('<fval name="failureNode"><value>Alert</value></fval>', '<fval name="failureNode"><value>./Alert</value></fval>');
    const { circuits } = parsePolicyXml(dotted);
    const circuit = circuits.find((c) => c.name === 'Health Check');
    expect(circuit?.startFilter).toBe('Set Message');

    const setMessage = circuit?.filters.find((f) => f.name === 'Set Message');
    expect(setMessage?.successNode).toBe('Reflect');
    expect(setMessage?.failureNode).toBe('Alert');
  });
});

describe('flow link extraction — simplified XML', () => {
  it('captures start filter and success links', async () => {
    const { circuits } = await loadXmlCircuit('simple', 'policies/SimplePolicy.xml');
    expect(circuits).toHaveLength(1);
    const circuit = circuits[0];

    expect(circuit.startFilter).toBe('Validate');
    const validate = circuit.filters.find((f) => f.name === 'Validate');
    expect(validate?.successNode).toBe('Transform');
    expect(validate?.failureNode).toBeUndefined();
  });

  it('captures failure links', async () => {
    const { circuits } = await loadXmlCircuit('branching', 'policies/BranchingPolicy.xml');
    const validate = circuits[0].filters.find((f) => f.name === 'Validate');
    expect(validate?.successNode).toBe('Respond');
    expect(validate?.failureNode).toBe('HandleError');
  });

  it('captures circuit references separately from flow links', async () => {
    const { circuits } = await loadXmlCircuit('circuit-ref', 'policies/CallerPolicy.xml');
    const call = circuits[0].filters.find((f) => f.name === 'CallAuth');
    expect(call?.circuitRef).toBe('AuthPolicy');
    expect(call?.successNode).toBe('Respond');
  });
});

describe('flow link extraction — Axway entity store XML', () => {
  it('captures start, success, and failure from fval elements', async () => {
    const { circuits } = await loadXmlCircuit('axway-es', 'PrimaryStore.xml');
    const circuit = circuits.find((c) => c.name === 'Health Check');
    expect(circuit?.startFilter).toBe('Set Message');

    const setMessage = circuit?.filters.find((f) => f.name === 'Set Message');
    expect(setMessage?.successNode).toBe('Reflect');
    expect(setMessage?.failureNode).toBe('Alert');
  });
});

describe('flow link extraction — YAML entity store', () => {
  it('captures start, success, and failure fields', async () => {
    const { circuits } = await loadYamlCircuit('yaml-es', 'Policies/Order Flow.yaml');
    expect(circuits).toHaveLength(1);
    const circuit = circuits[0];

    expect(circuit.name).toBe('Order Flow');
    expect(circuit.startFilter).toBe('Validate Order');

    const validate = circuit.filters.find((f) => f.name === 'Validate Order');
    expect(validate?.successNode).toBe('Store Order');
    expect(validate?.failureNode).toBe('Reject Order');
  });

  it('captures circuit references with filter names containing spaces', async () => {
    const { circuits } = await loadYamlCircuit('yaml-es', 'Policies/Delegate Flow.yaml');
    const call = circuits[0].filters.find((f) => f.name === 'Call Auth');

    expect(call?.circuitRef).toBe('Auth Flow');
    expect(call?.successNode).toBe('Respond');
  });
});

describe('buildFlowGraph — YAML scenarios', () => {
  it('flags unreachable filters in a YAML circuit', async () => {
    const { content, circuits } = await loadYamlCircuit(
      'yaml-es',
      'Policies/Unreachable Flow.yaml',
    );
    const graph = buildFlowGraph(circuits[0], content);

    expect(graph.nodes.find((n) => n.name === 'Orphan')?.reachable).toBe(false);
    expect(graph.nodes.find((n) => n.name === 'Respond')?.reachable).toBe(true);
  });

  it('renders dangling YAML links as missing nodes', async () => {
    const { content, circuits } = await loadYamlCircuit('yaml-es', 'Policies/Dangling Flow.yaml');
    const graph = buildFlowGraph(circuits[0], content);

    const ghost = graph.nodes.find((n) => n.name === 'Ghost');
    expect(ghost?.missing).toBe(true);
    expect(edge(graph, 'Validate', ghost!.id)?.dangling).toBe(true);
    expect(edge(graph, 'Validate', 'Handle Error')?.kind).toBe('failure');
  });

  it('warns when a YAML circuit has no start filter', async () => {
    const { content, circuits } = await loadYamlCircuit('yaml-es', 'Policies/No Start Flow.yaml');
    const graph = buildFlowGraph(circuits[0], content);

    expect(graph.warnings.some((w) => w.toLowerCase().includes('start'))).toBe(true);
    expect(graph.nodes.every((n) => n.reachable)).toBe(true);
  });

  it('exposes circuit references on YAML nodes for delegation navigation', async () => {
    const { content, circuits } = await loadYamlCircuit('yaml-es', 'Policies/Delegate Flow.yaml');
    const graph = buildFlowGraph(circuits[0], content);

    expect(graph.nodes.find((n) => n.name === 'Call Auth')?.circuitRef).toBe('Auth Flow');
    expect(graph.nodes.find((n) => n.name === 'Call Auth')?.isStart).toBe(true);
  });
});

describe('buildFlowGraph', () => {
  it('builds nodes and green/red edges for a branching policy', async () => {
    const { content, circuits } = await loadXmlCircuit('branching', 'policies/BranchingPolicy.xml');
    const graph = buildFlowGraph(circuits[0], content);

    expect(graph.circuitName).toBe('BranchingPolicy');
    expect(graph.nodes.map((n) => n.name).sort()).toEqual([
      'HandleError',
      'Respond',
      'Validate',
    ]);
    expect(edge(graph, 'Validate', 'Respond')?.kind).toBe('success');
    expect(edge(graph, 'Validate', 'HandleError')?.kind).toBe('failure');
  });

  it('marks the start filter and terminal nodes', async () => {
    const { content, circuits } = await loadXmlCircuit('simple', 'policies/SimplePolicy.xml');
    const graph = buildFlowGraph(circuits[0], content);

    expect(graph.nodes.find((n) => n.name === 'Validate')?.isStart).toBe(true);
    expect(graph.nodes.find((n) => n.name === 'Respond')?.isStart).toBe(false);
    expect(graph.nodes.find((n) => n.name === 'Respond')?.isTerminal).toBe(true);
    expect(graph.nodes.find((n) => n.name === 'Validate')?.isTerminal).toBe(false);
  });

  it('flags unreachable filters', async () => {
    const { content, circuits } = await loadXmlCircuit(
      'unreachable',
      'policies/UnreachablePolicy.xml',
    );
    const graph = buildFlowGraph(circuits[0], content);

    expect(graph.nodes.find((n) => n.name === 'Orphan')?.reachable).toBe(false);
    expect(graph.nodes.find((n) => n.name === 'Respond')?.reachable).toBe(true);
  });

  it('renders dangling links as edges to synthetic missing nodes', async () => {
    const { content, circuits } = await loadXmlCircuit('dangling', 'policies/DanglingPolicy.xml');
    const graph = buildFlowGraph(circuits[0], content);

    const ghost = graph.nodes.find((n) => n.name === 'Ghost');
    expect(ghost?.missing).toBe(true);
    expect(edge(graph, 'Validate', ghost!.id)?.dangling).toBe(true);
    expect(edge(graph, 'Validate', 'HandleError')?.dangling).toBe(false);
  });

  it('reports a warning and keeps all nodes reachable when there is no start filter', async () => {
    const { content, circuits } = await loadXmlCircuit('no-start', 'policies/NoStartPolicy.xml');
    const graph = buildFlowGraph(circuits[0], content);

    expect(graph.warnings.some((w) => w.toLowerCase().includes('start'))).toBe(true);
    expect(graph.nodes.every((n) => n.reachable)).toBe(true);
    expect(graph.nodes.every((n) => !n.isStart)).toBe(true);
  });

  it('exposes circuit references on nodes', async () => {
    const { content, circuits } = await loadXmlCircuit('circuit-ref', 'policies/CallerPolicy.xml');
    const graph = buildFlowGraph(circuits[0], content);

    expect(graph.nodes.find((n) => n.name === 'CallAuth')?.circuitRef).toBe('AuthPolicy');
  });

  it('keeps parallel success and failure edges to the same target', () => {
    const circuit = {
      name: 'Parallel',
      startOffset: 0,
      endOffset: 0,
      startFilter: 'A',
      filters: [
        {
          name: 'A',
          type: 'Check',
          startOffset: 0,
          endOffset: 0,
          attributes: [],
          referencedCircuits: [],
          content: '',
          successNode: 'B',
          failureNode: 'B',
        },
        {
          name: 'B',
          type: 'Reflector',
          startOffset: 0,
          endOffset: 0,
          attributes: [],
          referencedCircuits: [],
          content: '',
        },
      ],
    };
    const graph = buildFlowGraph(circuit, '');

    const edges = graph.edges.filter((e) => e.from === 'A' && e.to === 'B');
    expect(edges.map((e) => e.kind).sort()).toEqual(['failure', 'success']);
  });

  it('builds the same graph model from a YAML circuit', async () => {
    const { content, circuits } = await loadYamlCircuit('yaml-es', 'Policies/Order Flow.yaml');
    const graph = buildFlowGraph(circuits[0], content);

    expect(edge(graph, 'Validate Order', 'Store Order')?.kind).toBe('success');
    expect(edge(graph, 'Validate Order', 'Reject Order')?.kind).toBe('failure');
    expect(graph.nodes.find((n) => n.name === 'Validate Order')?.isStart).toBe(true);
  });
});

describe('layoutFlowGraph', () => {
  it('places the start node on the top layer and successors below', async () => {
    const { content, circuits } = await loadXmlCircuit('simple', 'policies/SimplePolicy.xml');
    const graph = buildFlowGraph(circuits[0], content);
    const layout = layoutFlowGraph(graph);

    const validate = layout.positions.get('Validate');
    const transform = layout.positions.get('Transform');
    const respond = layout.positions.get('Respond');

    expect(validate?.layer).toBe(0);
    expect(transform?.layer).toBe(1);
    expect(respond?.layer).toBe(2);
  });

  it('assigns a position to every node including unreachable ones', async () => {
    const { content, circuits } = await loadXmlCircuit(
      'unreachable',
      'policies/UnreachablePolicy.xml',
    );
    const graph = buildFlowGraph(circuits[0], content);
    const layout = layoutFlowGraph(graph);

    for (const node of graph.nodes) {
      expect(layout.positions.has(node.id)).toBe(true);
    }
  });

  it('terminates on cyclic flows', () => {
    const circuit = {
      name: 'Loop',
      startOffset: 0,
      endOffset: 0,
      startFilter: 'A',
      filters: [
        {
          name: 'A',
          startOffset: 0,
          endOffset: 0,
          attributes: [],
          referencedCircuits: [],
          content: '',
          successNode: 'B',
        },
        {
          name: 'B',
          startOffset: 0,
          endOffset: 0,
          attributes: [],
          referencedCircuits: [],
          content: '',
          successNode: 'A',
        },
      ],
    };
    const graph = buildFlowGraph(circuit, '');
    const layout = layoutFlowGraph(graph);

    expect(layout.positions.size).toBe(2);
    expect(layout.positions.get('A')?.layer).toBe(0);
    expect(layout.positions.get('B')?.layer).toBe(1);
  });
});
