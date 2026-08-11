import * as path from 'path';
import type { PolicyStudioProject, ProjectScope } from '../projectRegistry/types';
import type { EnvRootCandidate } from './listEnvRoots';
import { pickProjectRootForEnvEditor } from './pickProjectRootForEnvEditor';

export type EnvOpenDecision =
  | { kind: 'open'; candidate: EnvRootCandidate }
  | { kind: 'pick' }
  | { kind: 'none' };

export type EnvFollowDecision =
  | { kind: 'switch'; candidate: EnvRootCandidate }
  | { kind: 'noop' }
  | { kind: 'missing'; projectDisplayName: string };

export function findEnvCandidateForProject(
  candidates: EnvRootCandidate[],
  projectId: string | undefined,
): EnvRootCandidate | undefined {
  if (!projectId) {
    return undefined;
  }
  return candidates.find((candidate) => candidate.project.id === projectId);
}

function sameEnvRoot(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

/**
 * Decide how to open the ENV editor: prefer the active/selected project's
 * sibling ENV when available; otherwise auto-open a sole candidate or ask.
 */
export function resolveEnvOpenDecision(
  candidates: EnvRootCandidate[],
  scope: ProjectScope,
): EnvOpenDecision {
  if (candidates.length === 0) {
    return { kind: 'none' };
  }

  const preferredProject = pickProjectRootForEnvEditor(
    candidates.map((candidate) => candidate.project),
    scope,
  );
  const preferred = findEnvCandidateForProject(candidates, preferredProject?.id);
  if (preferred) {
    return { kind: 'open', candidate: preferred };
  }

  if (candidates.length === 1) {
    return { kind: 'open', candidate: candidates[0] };
  }

  return { kind: 'pick' };
}

/**
 * While the ENV editor is open, follow the active/selected policy project to
 * its sibling ENV when possible.
 */
export function resolveEnvFollowActiveProject(
  candidates: EnvRootCandidate[],
  allProjects: PolicyStudioProject[],
  scope: ProjectScope,
  currentEnvRoot: string | undefined,
): EnvFollowDecision {
  const preferredProject = pickProjectRootForEnvEditor(allProjects, scope);
  if (!preferredProject) {
    return { kind: 'noop' };
  }

  const candidate = findEnvCandidateForProject(candidates, preferredProject.id);
  if (!candidate) {
    return { kind: 'missing', projectDisplayName: preferredProject.displayName };
  }

  if (currentEnvRoot && sameEnvRoot(currentEnvRoot, candidate.envRoot)) {
    return { kind: 'noop' };
  }

  return { kind: 'switch', candidate };
}
