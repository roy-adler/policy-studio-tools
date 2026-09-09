import { normalizeFilterNodeRef } from '../circuitSearch/textUtils';

export function resolveServicePathCircuitName(
  filterCircuit?: string,
): string | undefined {
  return normalizeFilterNodeRef(filterCircuit);
}
