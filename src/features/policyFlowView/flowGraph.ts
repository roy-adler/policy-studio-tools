import type { ParsedCircuit } from '../circuitSearch/types';
import { offsetToRange } from '../circuitSearch/textUtils';
import type { FlowEdge, FlowNode, PolicyFlowGraph } from './types';

function missingNodeId(name: string): string {
  return `missing:${name}`;
}

/**
 * Builds the renderable flow graph for one circuit: filter nodes, green/red
 * edges, start/terminal markers, reachability, and dangling-link diagnostics.
 */
export function buildFlowGraph(circuit: ParsedCircuit, fileContent: string): PolicyFlowGraph {
  const warnings: string[] = [];
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const nodeById = new Map<string, FlowNode>();

  for (const filter of circuit.filters) {
    const node: FlowNode = {
      id: filter.name,
      name: filter.name,
      filterType: filter.type,
      isStart: false,
      isTerminal: true,
      reachable: true,
      missing: false,
      circuitRef: filter.circuitRef,
      range: fileContent
        ? offsetToRange(fileContent, filter.startOffset, filter.endOffset)
        : undefined,
    };
    nodes.push(node);
    nodeById.set(node.id, node);
  }

  const ensureTarget = (name: string): { id: string; dangling: boolean } => {
    if (nodeById.has(name)) {
      return { id: name, dangling: false };
    }
    const id = missingNodeId(name);
    if (!nodeById.has(id)) {
      const missing: FlowNode = {
        id,
        name,
        isStart: false,
        isTerminal: true,
        reachable: true,
        missing: true,
      };
      nodes.push(missing);
      nodeById.set(id, missing);
    }
    return { id, dangling: true };
  };

  for (const filter of circuit.filters) {
    if (filter.successNode) {
      const target = ensureTarget(filter.successNode);
      edges.push({ from: filter.name, to: target.id, kind: 'success', dangling: target.dangling });
      const source = nodeById.get(filter.name);
      if (source) {
        source.isTerminal = false;
      }
    }
    if (filter.failureNode) {
      const target = ensureTarget(filter.failureNode);
      edges.push({ from: filter.name, to: target.id, kind: 'failure', dangling: target.dangling });
    }
  }

  const startNode = circuit.startFilter ? nodeById.get(circuit.startFilter) : undefined;

  if (circuit.startFilter && !startNode) {
    warnings.push(
      `Start filter '${circuit.startFilter}' is not defined in circuit '${circuit.name}'.`,
    );
  } else if (!circuit.startFilter) {
    warnings.push(`Circuit '${circuit.name}' has no resolvable start filter.`);
  }

  if (startNode) {
    startNode.isStart = true;

    const reachable = new Set<string>([startNode.id]);
    const queue = [startNode.id];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const edge of edges) {
        if (edge.from === current && !reachable.has(edge.to)) {
          reachable.add(edge.to);
          queue.push(edge.to);
        }
      }
    }

    for (const node of nodes) {
      node.reachable = node.missing || reachable.has(node.id);
    }
  }

  return {
    circuitName: circuit.name,
    nodes,
    edges,
    warnings,
  };
}
