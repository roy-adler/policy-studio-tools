export interface CircuitGraphDefinitionPath {
  filePath: string;
  absolutePath: string;
}

export interface CircuitGraphNode {
  id: string;
  name: string;
  isEntryPoint: boolean;
  isMissing: boolean;
  definitionPaths: CircuitGraphDefinitionPath[];
  projectId?: string;
  projectDisplayName?: string;
}

export interface CircuitGraphEdge {
  id: string;
  from: string;
  to: string;
  isMissing: boolean;
  inCycle: boolean;
}

export interface CycleInfo {
  id: string;
  nodeIds: string[];
  edgeIds: string[];
}

export interface CircuitReferenceGraph {
  nodes: CircuitGraphNode[];
  edges: CircuitGraphEdge[];
  entryPoints: string[];
  missingReferences: string[];
  cycles: CycleInfo[];
}

export interface CircuitGraphLayoutPosition {
  layer: number;
  index: number;
  x: number;
  y: number;
}

export interface CircuitGraphLayout {
  positions: Map<string, CircuitGraphLayoutPosition>;
  width: number;
  height: number;
}
