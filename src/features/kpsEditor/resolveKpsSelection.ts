import * as path from 'path';
import type { PolicyStudioProject, ProjectScope } from '../projectRegistry/types';
import type { KpsRootCandidate } from './listKpsRoots';
import { pickProjectRootForKpsEditor } from './pickProjectRootForKpsEditor';

export type KpsOpenDecision =
  | { kind: 'open'; candidate: KpsRootCandidate }
  | { kind: 'pick' }
  | { kind: 'none' };

export type KpsFollowDecision =
  | { kind: 'switch'; candidate: KpsRootCandidate }
  | { kind: 'noop' }
  | { kind: 'missing'; projectDisplayName: string };

export function findKpsCandidateForProject(
  candidates: KpsRootCandidate[],
  projectId: string | undefined,
): KpsRootCandidate | undefined {
  if (!projectId) {
    return undefined;
  }
  return candidates.find((candidate) => candidate.project.id === projectId);
}

function sameKpsRoot(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

/**
 * Decide how to open the KPS editor: prefer the active/selected project's
 * sibling KPS when available; otherwise auto-open a sole candidate or ask.
 */
export function resolveKpsOpenDecision(
  candidates: KpsRootCandidate[],
  scope: ProjectScope,
): KpsOpenDecision {
  if (candidates.length === 0) {
    return { kind: 'none' };
  }

  const preferredProject = pickProjectRootForKpsEditor(
    candidates.map((candidate) => candidate.project),
    scope,
  );
  const preferred = findKpsCandidateForProject(candidates, preferredProject?.id);
  if (preferred) {
    return { kind: 'open', candidate: preferred };
  }

  if (candidates.length === 1) {
    return { kind: 'open', candidate: candidates[0] };
  }

  return { kind: 'pick' };
}

/**
 * While the KPS editor is open, follow the active/selected policy project to
 * its sibling KPS when possible.
 */
export function resolveKpsFollowActiveProject(
  candidates: KpsRootCandidate[],
  allProjects: PolicyStudioProject[],
  scope: ProjectScope,
  currentKpsRoot: string | undefined,
): KpsFollowDecision {
  const preferredProject = pickProjectRootForKpsEditor(allProjects, scope);
  if (!preferredProject) {
    return { kind: 'noop' };
  }

  const candidate = findKpsCandidateForProject(candidates, preferredProject.id);
  if (!candidate) {
    return { kind: 'missing', projectDisplayName: preferredProject.displayName };
  }

  if (currentKpsRoot && sameKpsRoot(currentKpsRoot, candidate.kpsRoot)) {
    return { kind: 'noop' };
  }

  return { kind: 'switch', candidate };
}
