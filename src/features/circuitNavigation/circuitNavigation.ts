import type { PolicyStudioProject } from '../projectRegistry/types';
import type {
  CircuitDefinitionCandidate,
  CircuitNavigationDeps,
  JumpResult,
  JumpToCircuitOptions,
} from './types';

/**
 * Name matching rule: circuit names are compared after trimming surrounding
 * whitespace, case-insensitively. Policy Studio treats circuit names as labels
 * rather than strict identifiers, and the circuit search index uses the same
 * rule, so both features resolve references identically. Inner whitespace and
 * special characters are preserved verbatim (no namespace splitting in v1).
 */
export function normalizeCircuitName(circuitName: string): string {
  return circuitName.trim();
}

const MAX_REFERENCE_LENGTH = 256;

/**
 * Heuristic used when the jump command is invoked without an argument and we
 * take the word/selection at the cursor: accept short plain text, reject
 * markup and quoted fragments.
 */
export function looksLikeCircuitReference(text: string): boolean {
  const normalized = normalizeCircuitName(text);
  if (!normalized || normalized.length > MAX_REFERENCE_LENGTH) {
    return false;
  }
  return !/[<>"'\n\r]/.test(normalized);
}

async function resolveInProject(
  deps: CircuitNavigationDeps,
  project: PolicyStudioProject,
  normalizedName: string,
): Promise<CircuitDefinitionCandidate[]> {
  const index = await deps.getIndex(project);
  const lowered = normalizedName.toLowerCase();
  const candidates: CircuitDefinitionCandidate[] = [];

  for (const [name, definitions] of index.circuitByName.entries()) {
    if (name.trim().toLowerCase() === lowered) {
      for (const definition of definitions) {
        candidates.push({
          ...definition,
          projectId: project.id,
          projectDisplayName: project.displayName,
        });
      }
    }
  }

  return candidates;
}

export async function resolveCircuitDefinitions(
  deps: CircuitNavigationDeps,
  projectId: string,
  circuitName: string,
): Promise<CircuitDefinitionCandidate[]> {
  const normalized = normalizeCircuitName(circuitName);
  if (!normalized) {
    return [];
  }

  const project = deps.getProjects().find((candidate) => candidate.id === projectId);
  if (!project) {
    return [];
  }

  return resolveInProject(deps, project, normalized);
}

async function resolveAcrossProjects(
  deps: CircuitNavigationDeps,
  projects: PolicyStudioProject[],
  normalizedName: string,
): Promise<CircuitDefinitionCandidate[]> {
  const candidates: CircuitDefinitionCandidate[] = [];
  for (const project of projects) {
    candidates.push(...(await resolveInProject(deps, project, normalizedName)));
  }
  return candidates;
}

async function navigateToCandidates(
  deps: CircuitNavigationDeps,
  candidates: CircuitDefinitionCandidate[],
): Promise<JumpResult> {
  let definition: CircuitDefinitionCandidate;
  let kind: 'opened' | 'picked';

  if (candidates.length === 1) {
    definition = candidates[0];
    kind = 'opened';
  } else {
    const picked = await deps.host.pickDefinition(candidates);
    if (!picked) {
      return { kind: 'cancelled' };
    }
    definition = picked;
    kind = 'picked';
  }

  try {
    await deps.host.openDefinition(definition);
  } catch (error) {
    const message = `Unable to open '${definition.filePath}': ${
      error instanceof Error ? error.message : String(error)
    }. The file may have been deleted; try refreshing projects to re-index.`;
    deps.host.showError(message);
    return { kind: 'error', message };
  }

  return { kind, definition };
}

export async function jumpToCircuit(
  deps: CircuitNavigationDeps,
  circuitName: string,
  options: JumpToCircuitOptions = {},
): Promise<JumpResult> {
  const normalized = normalizeCircuitName(circuitName);
  if (!normalized) {
    const message = 'Circuit name is empty. Provide a circuit name to jump to.';
    deps.host.showValidationError(message);
    return { kind: 'error', message };
  }

  const projects = deps.getProjects();
  const owningProject =
    (options.projectId
      ? projects.find((project) => project.id === options.projectId)
      : undefined) ??
    (options.sourceFilePath ? deps.getProjectForFile(options.sourceFilePath) : undefined);

  if (owningProject) {
    const candidates = await resolveInProject(deps, owningProject, normalized);
    if (candidates.length > 0) {
      return navigateToCandidates(deps, candidates);
    }

    const otherProjects = projects.filter((project) => project.id !== owningProject.id);

    if (options.searchAllProjects && otherProjects.length > 0) {
      const fallback = await resolveAcrossProjects(deps, otherProjects, normalized);
      if (fallback.length > 0) {
        return navigateToCandidates(deps, fallback);
      }
      await deps.host.showNotFound(normalized, false);
      return { kind: 'notFound', circuitName: normalized };
    }

    const action = await deps.host.showNotFound(normalized, otherProjects.length > 0);
    if (action === 'searchAllProjects') {
      const fallback = await resolveAcrossProjects(deps, otherProjects, normalized);
      if (fallback.length > 0) {
        return navigateToCandidates(deps, fallback);
      }
      await deps.host.showNotFound(normalized, false);
    }
    return { kind: 'notFound', circuitName: normalized };
  }

  const candidates = await resolveAcrossProjects(deps, projects, normalized);
  if (candidates.length > 0) {
    return navigateToCandidates(deps, candidates);
  }

  await deps.host.showNotFound(normalized, false);
  return { kind: 'notFound', circuitName: normalized };
}
