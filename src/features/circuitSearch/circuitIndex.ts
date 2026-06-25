import type { PolicyStudioProject } from '../projectRegistry/types';
import { discoverPolicyFiles, readAndParsePolicyFile } from './policyFileDiscovery';
import { offsetToRange } from './textUtils';
import type { CircuitDefinition, CircuitIndex, IndexedPolicyFile } from './types';

const indexCache = new Map<string, CircuitIndex>();

export function invalidateCircuitIndex(projectId?: string): void {
  if (projectId) {
    indexCache.delete(projectId);
    return;
  }
  indexCache.clear();
}

export async function buildCircuitIndex(
  project: PolicyStudioProject,
  options?: { force?: boolean },
): Promise<CircuitIndex> {
  if (!options?.force) {
    const cached = indexCache.get(project.id);
    if (cached) {
      return cached;
    }
  }

  const policyPaths = await discoverPolicyFiles(project);
  const files: IndexedPolicyFile[] = [];
  const invalidFiles: string[] = [];
  const circuitByName = new Map<string, CircuitDefinition[]>();

  for (const absolutePath of policyPaths) {
    const indexed = await readAndParsePolicyFile(project, absolutePath);
    files.push(indexed);

    if (indexed.parseError) {
      invalidFiles.push(indexed.relativePath);
    }

    for (const circuit of indexed.circuits) {
      const definition: CircuitDefinition = {
        circuitName: circuit.name,
        filePath: indexed.relativePath,
        absolutePath: indexed.absolutePath,
        range: offsetToRange(indexed.content, circuit.startOffset, circuit.endOffset),
      };
      const existing = circuitByName.get(circuit.name) ?? [];
      existing.push(definition);
      circuitByName.set(circuit.name, existing);
    }
  }

  const index: CircuitIndex = {
    projectId: project.id,
    project,
    files,
    circuitByName,
    invalidFiles,
    filesScanned: files.length,
    builtAt: new Date(),
  };

  indexCache.set(project.id, index);
  return index;
}

export async function getCircuitIndex(project: PolicyStudioProject): Promise<CircuitIndex> {
  return buildCircuitIndex(project);
}

export function resolveCircuitDefinitions(
  index: CircuitIndex,
  circuitName: string,
): CircuitDefinition[] {
  const normalized = circuitName.trim().toLowerCase();
  const matches: CircuitDefinition[] = [];

  for (const [name, definitions] of index.circuitByName.entries()) {
    if (name.toLowerCase() === normalized) {
      matches.push(...definitions);
    }
  }

  return matches;
}
