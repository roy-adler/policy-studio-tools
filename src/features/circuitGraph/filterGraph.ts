import type { CircuitReferenceGraph } from './types';

/**
 * Keeps nodes whose names match the query plus their direct neighbours (1 hop).
 */
export function filterGraph(
  graph: CircuitReferenceGraph,
  query: string,
): CircuitReferenceGraph {
  const trimmed = query.trim();
  if (!trimmed) {
    return graph;
  }

  const normalized = trimmed.toLowerCase();
  const matching = new Set(
    graph.nodes
      .filter((node) => node.name.toLowerCase().includes(normalized))
      .map((node) => node.id),
  );

  if (matching.size === 0) {
    return {
      nodes: [],
      edges: [],
      entryPoints: [],
      missingReferences: [],
      cycles: [],
    };
  }

  const visible = new Set(matching);
  for (const edge of graph.edges) {
    if (matching.has(edge.from)) {
      visible.add(edge.to);
    }
    if (matching.has(edge.to)) {
      visible.add(edge.from);
    }
  }

  const nodes = graph.nodes.filter((node) => visible.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter(
    (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to),
  );

  const entryPoints = graph.entryPoints.filter((id) => nodeIds.has(id));
  const missingReferences = graph.missingReferences.filter((name) =>
    nodes.some((node) => node.isMissing && node.name === name),
  );

  const cycles = graph.cycles
    .map((cycle) => ({
      ...cycle,
      nodeIds: cycle.nodeIds.filter((id) => nodeIds.has(id)),
      edgeIds: cycle.edgeIds.filter((id) => edges.some((edge) => edge.id === id)),
    }))
    .filter((cycle) => cycle.nodeIds.length > 0);

  return {
    nodes,
    edges,
    entryPoints,
    missingReferences,
    cycles,
  };
}
