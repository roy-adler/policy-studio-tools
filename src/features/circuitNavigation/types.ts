import type { CircuitDefinition, CircuitIndex } from '../circuitSearch/types';
import type { PolicyStudioProject } from '../projectRegistry/types';

export interface CircuitDefinitionCandidate extends CircuitDefinition {
  projectId: string;
  projectDisplayName: string;
}

export interface JumpToCircuitOptions {
  /** Explicit owning project. Takes precedence over `sourceFilePath`. */
  projectId?: string;
  /** Source file used to infer the owning project when `projectId` is absent. */
  sourceFilePath?: string;
  /** Search remaining workspace projects automatically when the owning project has no match. */
  searchAllProjects?: boolean;
}

export type JumpResult =
  | { kind: 'opened'; definition: CircuitDefinitionCandidate }
  | { kind: 'picked'; definition: CircuitDefinitionCandidate }
  | { kind: 'notFound'; circuitName: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

export type NotFoundAction = 'searchAllProjects';

/**
 * UI surface required by the navigation core. The VS Code adapter implements this
 * with editors, quick picks, and notifications; tests implement it in memory.
 */
export interface NavigationHost {
  openDefinition(candidate: CircuitDefinitionCandidate): Promise<void>;
  pickDefinition(
    candidates: CircuitDefinitionCandidate[],
  ): Promise<CircuitDefinitionCandidate | undefined>;
  showNotFound(
    circuitName: string,
    offerSearchAllProjects: boolean,
  ): Promise<NotFoundAction | undefined>;
  showValidationError(message: string): void;
  showError(message: string): void;
}

export interface CircuitNavigationDeps {
  getProjects(): PolicyStudioProject[];
  getProjectForFile(filePath: string): PolicyStudioProject | undefined;
  getIndex(project: PolicyStudioProject): Promise<CircuitIndex>;
  host: NavigationHost;
}
