import type { TextRange } from '../circuitSearch/types';

export type FlowEdgeKind = 'success' | 'failure';

export interface FlowNode {
  /** Unique node id. Real filters use the filter name; missing targets use `missing:<name>`. */
  id: string;
  name: string;
  filterType?: string;
  isStart: boolean;
  /** No outgoing success edge — the flow ends here. */
  isTerminal: boolean;
  /** Reachable from the start filter (always true when the circuit has no start). */
  reachable: boolean;
  /** Synthetic node for a link target that has no filter definition. */
  missing: boolean;
  /** Circuit referenced by this filter (delegation filters). */
  circuitRef?: string;
  range?: TextRange;
}

export interface FlowEdge {
  from: string;
  to: string;
  kind: FlowEdgeKind;
  /** Link points at a filter that does not exist in the circuit. */
  dangling: boolean;
}

export interface PolicyFlowGraph {
  circuitName: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  warnings: string[];
}

export interface FlowNodePosition {
  layer: number;
  /** Index within the layer, left to right. */
  index: number;
  x: number;
  y: number;
}

export interface FlowLayout {
  positions: Map<string, FlowNodePosition>;
  width: number;
  height: number;
}
