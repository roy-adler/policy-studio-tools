import type { CircuitGraphLayout, CircuitGraphLayoutPosition, CircuitReferenceGraph } from './types';

export const GRAPH_NODE_WIDTH = 160;
export const GRAPH_NODE_HEIGHT = 48;
const HORIZONTAL_GAP = 40;
const VERTICAL_GAP = 64;
const MARGIN = 32;

/**
 * Simple layered layout: entry points on layer 0, each callee one layer below
 * its earliest caller. Missing-reference stubs sit one layer below their caller.
 */
export function layoutCircuitGraph(graph: CircuitReferenceGraph): CircuitGraphLayout {
  const layerByNode = new Map<string, number>();

  for (const entryId of graph.entryPoints) {
    layerByNode.set(entryId, 0);
  }

  if (graph.entryPoints.length === 0 && graph.nodes.length > 0) {
    for (const node of graph.nodes) {
      if (!node.isMissing) {
        layerByNode.set(node.id, 0);
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      const fromLayer = layerByNode.get(edge.from);
      if (fromLayer === undefined) {
        continue;
      }
      const nextLayer = fromLayer + 1;
      const current = layerByNode.get(edge.to);
      if (current === undefined || nextLayer > current) {
        layerByNode.set(edge.to, nextLayer);
        changed = true;
      }
    }
  }

  let overflowLayer =
    layerByNode.size > 0 ? Math.max(...layerByNode.values()) + 1 : 0;
  for (const node of graph.nodes) {
    if (!layerByNode.has(node.id)) {
      layerByNode.set(node.id, overflowLayer);
      overflowLayer += 1;
    }
  }

  const nodesPerLayer = new Map<number, string[]>();
  for (const node of graph.nodes) {
    const layer = layerByNode.get(node.id) ?? 0;
    const bucket = nodesPerLayer.get(layer) ?? [];
    bucket.push(node.id);
    nodesPerLayer.set(layer, bucket);
  }

  for (const ids of nodesPerLayer.values()) {
    ids.sort((a, b) => {
      const nameA = graph.nodes.find((node) => node.id === a)?.name ?? a;
      const nameB = graph.nodes.find((node) => node.id === b)?.name ?? b;
      return nameA.localeCompare(nameB);
    });
  }

  const positions = new Map<string, CircuitGraphLayoutPosition>();
  let maxRowWidth = 0;

  for (const [layer, ids] of nodesPerLayer) {
    const rowWidth = ids.length * GRAPH_NODE_WIDTH + (ids.length - 1) * HORIZONTAL_GAP;
    maxRowWidth = Math.max(maxRowWidth, rowWidth);
    ids.forEach((id, index) => {
      positions.set(id, {
        layer,
        index,
        x: MARGIN + index * (GRAPH_NODE_WIDTH + HORIZONTAL_GAP),
        y: MARGIN + layer * (GRAPH_NODE_HEIGHT + VERTICAL_GAP),
      });
    });
  }

  const layerCount = nodesPerLayer.size > 0 ? Math.max(...nodesPerLayer.keys()) + 1 : 0;
  return {
    positions,
    width: maxRowWidth + MARGIN * 2,
    height:
      layerCount * (GRAPH_NODE_HEIGHT + VERTICAL_GAP) -
      (layerCount > 0 ? VERTICAL_GAP : 0) +
      MARGIN * 2,
  };
}
