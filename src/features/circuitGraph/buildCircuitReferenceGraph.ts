import type { CircuitIndex } from '../circuitSearch/types';
import type {
  CircuitGraphEdge,
  CircuitGraphNode,
  CircuitReferenceGraph,
  CycleInfo,
} from './types';

function missingNodeId(name: string): string {
  return `missing:${name}`;
}

function edgeId(from: string, to: string): string {
  return `${from}->${to}`;
}

function collectReferencedCircuits(index: CircuitIndex): Map<string, Set<string>> {
  const outbound = new Map<string, Set<string>>();

  for (const file of index.files) {
    for (const circuit of file.circuits) {
      const refs = outbound.get(circuit.name) ?? new Set<string>();
      for (const filter of circuit.filters) {
        for (const referenced of filter.referencedCircuits) {
          const trimmed = referenced.trim();
          if (trimmed) {
            refs.add(trimmed);
          }
        }
      }
      outbound.set(circuit.name, refs);
    }
  }

  return outbound;
}

function buildDefinitionPaths(index: CircuitIndex): Map<string, CircuitGraphNode['definitionPaths']> {
  const paths = new Map<string, CircuitGraphNode['definitionPaths']>();

  for (const [name, definitions] of index.circuitByName.entries()) {
    paths.set(
      name,
      definitions.map((definition) => ({
        filePath: definition.filePath,
        absolutePath: definition.absolutePath,
      })),
    );
  }

  return paths;
}

function detectCycles(
  nodeIds: Set<string>,
  edges: CircuitGraphEdge[],
): { cycles: CycleInfo[]; cycleEdgeIds: Set<string> } {
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) {
    adjacency.set(id, []);
  }
  for (const edge of edges) {
    if (!edge.isMissing && adjacency.has(edge.from) && adjacency.has(edge.to)) {
      adjacency.get(edge.from)?.push(edge.to);
    }
  }

  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const sccGroups: string[][] = [];

  function strongConnect(node: string): void {
    indices.set(node, index);
    lowlink.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const next of adjacency.get(node) ?? []) {
      if (!indices.has(next)) {
        strongConnect(next);
        lowlink.set(node, Math.min(lowlink.get(node) ?? 0, lowlink.get(next) ?? 0));
      } else if (onStack.has(next)) {
        lowlink.set(node, Math.min(lowlink.get(node) ?? 0, indices.get(next) ?? 0));
      }
    }

    if (lowlink.get(node) === indices.get(node)) {
      const component: string[] = [];
      let current: string | undefined;
      do {
        current = stack.pop();
        if (current) {
          onStack.delete(current);
          component.push(current);
        }
      } while (current && current !== node);

      if (component.length > 0) {
        sccGroups.push(component);
      }
    }
  }

  for (const node of nodeIds) {
    if (!indices.has(node)) {
      strongConnect(node);
    }
  }

  const cycleEdgeIds = new Set<string>();
  const cycles: CycleInfo[] = [];

  for (const component of sccGroups) {
    const componentSet = new Set(component);
    const componentEdges = edges.filter(
      (edge) =>
        !edge.isMissing &&
        componentSet.has(edge.from) &&
        componentSet.has(edge.to),
    );

    const isCycle =
      component.length > 1 ||
      componentEdges.some((edge) => edge.from === edge.to);

    if (!isCycle) {
      continue;
    }

    const cycleEdgeIdList = componentEdges.map((edge) => edge.id);
    for (const id of cycleEdgeIdList) {
      cycleEdgeIds.add(id);
    }

    cycles.push({
      id: component.slice().sort().join('|'),
      nodeIds: component.slice().sort(),
      edgeIds: cycleEdgeIdList,
    });
  }

  return { cycles, cycleEdgeIds };
}

/**
 * Builds a directed circuit reference graph from a project circuit index.
 */
export function buildCircuitReferenceGraph(index: CircuitIndex): CircuitReferenceGraph {
  const definitionPaths = buildDefinitionPaths(index);
  const outbound = collectReferencedCircuits(index);
  const definedNames = new Set(definitionPaths.keys());
  const missingReferences = new Set<string>();

  const nodes: CircuitGraphNode[] = [];
  const nodeById = new Map<string, CircuitGraphNode>();

  for (const name of definedNames) {
    const node: CircuitGraphNode = {
      id: name,
      name,
      isEntryPoint: false,
      isMissing: false,
      definitionPaths: definitionPaths.get(name) ?? [],
      projectId: index.projectId,
      projectDisplayName: index.project.displayName,
    };
    nodes.push(node);
    nodeById.set(name, node);
  }

  const edges: CircuitGraphEdge[] = [];
  const edgeKeys = new Set<string>();

  const ensureMissingNode = (name: string): CircuitGraphNode => {
    const id = missingNodeId(name);
    let node = nodeById.get(id);
    if (!node) {
      node = {
        id,
        name,
        isEntryPoint: false,
        isMissing: true,
        definitionPaths: [],
        projectId: index.projectId,
        projectDisplayName: index.project.displayName,
      };
      nodes.push(node);
      nodeById.set(id, node);
    }
    return node;
  };

  for (const [caller, refs] of outbound.entries()) {
    if (!nodeById.has(caller)) {
      continue;
    }

    for (const callee of refs) {
      const missing = !definedNames.has(callee);
      const target = missing ? ensureMissingNode(callee) : nodeById.get(callee);
      if (!target) {
        continue;
      }

      if (missing) {
        missingReferences.add(callee);
      }

      const id = edgeId(caller, target.id);
      if (edgeKeys.has(id)) {
        continue;
      }
      edgeKeys.add(id);

      edges.push({
        id,
        from: caller,
        to: target.id,
        isMissing: missing,
        inCycle: false,
      });
    }
  }

  const inDegree = new Map<string, number>();
  for (const node of nodes) {
    inDegree.set(node.id, 0);
  }
  for (const edge of edges) {
    if (!nodeById.get(edge.to)?.isMissing) {
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    }
  }

  const entryPoints: string[] = [];
  for (const node of nodes) {
    if (!node.isMissing && (inDegree.get(node.id) ?? 0) === 0) {
      node.isEntryPoint = true;
      entryPoints.push(node.id);
    }
  }
  entryPoints.sort();

  const definedNodeIds = new Set(
    nodes.filter((node) => !node.isMissing).map((node) => node.id),
  );
  const { cycles, cycleEdgeIds } = detectCycles(definedNodeIds, edges);
  for (const edge of edges) {
    edge.inCycle = cycleEdgeIds.has(edge.id);
  }

  nodes.sort((a, b) => a.name.localeCompare(b.name));
  edges.sort((a, b) => a.id.localeCompare(b.id));

  return {
    nodes,
    edges,
    entryPoints,
    missingReferences: [...missingReferences].sort(),
    cycles,
  };
}
