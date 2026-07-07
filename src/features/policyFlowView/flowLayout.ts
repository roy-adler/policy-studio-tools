import type { FlowLayout, FlowNodePosition, PolicyFlowGraph } from './types';

export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 56;
const HORIZONTAL_GAP = 48;
const VERTICAL_GAP = 72;
const MARGIN = 32;

/**
 * Simple top-down layered layout: the start filter sits on layer 0 and each
 * node is placed one layer below its earliest predecessor (BFS depth). Nodes
 * not connected to the start (unreachable filters, or every node when there is
 * no start) are appended on layers below the connected flow.
 */
export function layoutFlowGraph(graph: PolicyFlowGraph): FlowLayout {
  const layerByNode = new Map<string, number>();

  const startId = graph.nodes.find((node) => node.isStart)?.id;
  if (startId) {
    layerByNode.set(startId, 0);
    const queue = [startId];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      const currentLayer = layerByNode.get(current) ?? 0;
      for (const edge of graph.edges) {
        if (edge.from === current && !layerByNode.has(edge.to)) {
          layerByNode.set(edge.to, currentLayer + 1);
          queue.push(edge.to);
        }
      }
    }
  }

  let overflowLayer = layerByNode.size > 0 ? Math.max(...layerByNode.values()) + 1 : 0;
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

  const positions = new Map<string, FlowNodePosition>();
  let maxRowWidth = 0;
  for (const [layer, ids] of nodesPerLayer) {
    const rowWidth = ids.length * NODE_WIDTH + (ids.length - 1) * HORIZONTAL_GAP;
    maxRowWidth = Math.max(maxRowWidth, rowWidth);
    ids.forEach((id, index) => {
      positions.set(id, {
        layer,
        index,
        x: MARGIN + index * (NODE_WIDTH + HORIZONTAL_GAP),
        y: MARGIN + layer * (NODE_HEIGHT + VERTICAL_GAP),
      });
    });
  }

  const layerCount = nodesPerLayer.size > 0 ? Math.max(...nodesPerLayer.keys()) + 1 : 0;
  return {
    positions,
    width: maxRowWidth + MARGIN * 2,
    height: layerCount * (NODE_HEIGHT + VERTICAL_GAP) - (layerCount > 0 ? VERTICAL_GAP : 0) + MARGIN * 2,
  };
}
