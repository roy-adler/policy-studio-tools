import path from 'path';
import { describe, expect, it } from 'vitest';
import { buildCircuitIndex } from '../../src/features/circuitSearch/circuitIndex';
import { buildCircuitReferenceGraph } from '../../src/features/circuitGraph/buildCircuitReferenceGraph';
import { filterGraph } from '../../src/features/circuitGraph/filterGraph';
import { layoutCircuitGraph } from '../../src/features/circuitGraph/circuitGraphLayout';
import type { PolicyStudioProject } from '../../src/features/projectRegistry/types';

const fixturesDir = path.join(__dirname, '..', 'fixtures', 'circuit-graph');

function xmlProject(name: string, rootPath: string): PolicyStudioProject {
  return {
    id: `test-${name}`,
    rootPath,
    workspaceFolder: rootPath,
    relativePath: '',
    displayName: name,
    projectType: 'xml',
  };
}

async function graphForFixture(name: string) {
  const project = xmlProject(name, path.join(fixturesDir, name));
  const index = await buildCircuitIndex(project);
  return buildCircuitReferenceGraph(index);
}

describe('buildCircuitReferenceGraph', () => {
  it('builds a linear A → B → C chain', async () => {
    const graph = await graphForFixture('linear');

    expect(graph.nodes.filter((node) => !node.isMissing).map((node) => node.name).sort()).toEqual([
      'CircuitA',
      'CircuitB',
      'CircuitC',
    ]);
    expect(graph.edges.map((edge) => edge.id).sort()).toEqual([
      'CircuitA->CircuitB',
      'CircuitB->CircuitC',
    ]);
    expect(graph.entryPoints).toEqual(['CircuitA']);
    expect(graph.missingReferences).toEqual([]);
    expect(graph.cycles).toEqual([]);
  });

  it('detects circular references', async () => {
    const graph = await graphForFixture('cycle');

    expect(graph.cycles.length).toBeGreaterThanOrEqual(1);
    expect(graph.edges.every((edge) => edge.inCycle)).toBe(true);
    expect(graph.cycles[0]?.nodeIds.sort()).toEqual(['CircuitA', 'CircuitB']);
  });

  it('detects missing references with stub nodes', async () => {
    const graph = await graphForFixture('missing-ref');

    expect(graph.missingReferences).toEqual(['GhostCircuit']);
    const missingNode = graph.nodes.find((node) => node.isMissing);
    expect(missingNode?.name).toBe('GhostCircuit');
    expect(graph.edges.some((edge) => edge.isMissing)).toBe(true);
  });

  it('marks entry points per disconnected component', async () => {
    const graph = await graphForFixture('entry-points');

    expect(graph.entryPoints.sort()).toEqual(['EntryA', 'EntryB']);
    expect(graph.nodes.find((node) => node.name === 'EntryA')?.isEntryPoint).toBe(true);
    expect(graph.nodes.find((node) => node.name === 'EntryB')?.isEntryPoint).toBe(true);
    expect(graph.nodes.find((node) => node.name === 'ServiceA')?.isEntryPoint).toBe(false);
    expect(graph.nodes.find((node) => node.name === 'ServiceB')?.isEntryPoint).toBe(false);
  });

  it('includes definition paths on nodes', async () => {
    const graph = await graphForFixture('linear');
    const circuitA = graph.nodes.find((node) => node.name === 'CircuitA');
    expect(circuitA?.definitionPaths.length).toBeGreaterThanOrEqual(1);
    expect(circuitA?.definitionPaths[0]?.filePath).toContain('CircuitA.xml');
  });
});

describe('filterGraph', () => {
  it('keeps matching nodes and 1-hop neighbours', async () => {
    const graph = await graphForFixture('linear');
    const filtered = filterGraph(graph, 'CircuitB');

    expect(filtered.nodes.map((node) => node.name).sort()).toEqual([
      'CircuitA',
      'CircuitB',
      'CircuitC',
    ]);
    expect(filtered.edges).toHaveLength(2);
  });

  it('returns empty graph when nothing matches', async () => {
    const graph = await graphForFixture('linear');
    const filtered = filterGraph(graph, 'DoesNotExist');
    expect(filtered.nodes).toEqual([]);
    expect(filtered.edges).toEqual([]);
  });
});

describe('layoutCircuitGraph', () => {
  it('assigns positions to every node', async () => {
    const graph = await graphForFixture('linear');
    const layout = layoutCircuitGraph(graph);

    expect(layout.positions.size).toBe(graph.nodes.length);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});
