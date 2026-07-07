import * as vscode from 'vscode';
import { buildCircuitIndex } from '../circuitSearch/circuitIndex';
import { getProjectForFile } from '../projectRegistry/discoverProjects';
import { getSharedProjectRegistryStore } from '../projectRegistry/projectRegistryService';
import {
  jumpToCircuit as jumpToCircuitCore,
  looksLikeCircuitReference,
  resolveCircuitDefinitions as resolveCircuitDefinitionsCore,
} from './circuitNavigation';
import type {
  CircuitDefinitionCandidate,
  CircuitNavigationDeps,
  JumpResult,
  JumpToCircuitOptions,
  NavigationHost,
  NotFoundAction,
} from './types';

const SEARCH_ALL_PROJECTS_ACTION = 'Search All Projects';
const OPEN_CIRCUIT_SEARCH_ACTION = 'Search Circuits';

type DefinitionQuickPickItem = vscode.QuickPickItem & {
  candidate: CircuitDefinitionCandidate;
};

class VscodeNavigationHost implements NavigationHost {
  async openDefinition(candidate: CircuitDefinitionCandidate): Promise<void> {
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(candidate.absolutePath),
    );
    const selection = new vscode.Range(
      candidate.range.start.line,
      candidate.range.start.character,
      candidate.range.end.line,
      candidate.range.end.character,
    );
    const editor = await vscode.window.showTextDocument(document, { selection });
    editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
  }

  async pickDefinition(
    candidates: CircuitDefinitionCandidate[],
  ): Promise<CircuitDefinitionCandidate | undefined> {
    const projectIds = new Set(candidates.map((candidate) => candidate.projectId));
    const includeProjectName = projectIds.size > 1;

    const items: DefinitionQuickPickItem[] = candidates.map((candidate) => ({
      label: candidate.circuitName,
      description: candidate.filePath,
      detail: includeProjectName ? candidate.projectDisplayName : undefined,
      candidate,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `Multiple definitions found for '${candidates[0].circuitName}'`,
      matchOnDescription: true,
      matchOnDetail: true,
    });
    return picked?.candidate;
  }

  async showNotFound(
    circuitName: string,
    offerSearchAllProjects: boolean,
  ): Promise<NotFoundAction | undefined> {
    const actions = offerSearchAllProjects
      ? [SEARCH_ALL_PROJECTS_ACTION, OPEN_CIRCUIT_SEARCH_ACTION]
      : [OPEN_CIRCUIT_SEARCH_ACTION];

    const choice = await vscode.window.showWarningMessage(
      `Circuit '${circuitName}' not found in this project.`,
      ...actions,
    );

    if (choice === SEARCH_ALL_PROJECTS_ACTION) {
      return 'searchAllProjects';
    }
    if (choice === OPEN_CIRCUIT_SEARCH_ACTION) {
      await vscode.commands.executeCommand('policyStudioTools.focusCircuitSearch', circuitName);
    }
    return undefined;
  }

  showValidationError(message: string): void {
    void vscode.window.showErrorMessage(message);
  }

  showError(message: string): void {
    void vscode.window.showErrorMessage(message);
  }
}

function createDeps(): CircuitNavigationDeps {
  const store = getSharedProjectRegistryStore();
  return {
    getProjects: () => store.getProjectRegistry().projects,
    getProjectForFile: (filePath) =>
      getProjectForFile(filePath, store.getProjectRegistry().projects),
    getIndex: (project) => buildCircuitIndex(project),
    host: new VscodeNavigationHost(),
  };
}

/**
 * Shared navigation API for other features (search results, graph nodes,
 * editor links). Resolves and navigates without going through the command.
 */
export async function jumpToCircuit(
  circuitName: string,
  options?: JumpToCircuitOptions,
): Promise<JumpResult> {
  return jumpToCircuitCore(createDeps(), circuitName, options);
}

export async function resolveCircuitDefinitions(
  projectId: string,
  circuitName: string,
): Promise<CircuitDefinitionCandidate[]> {
  return resolveCircuitDefinitionsCore(createDeps(), projectId, circuitName);
}

function circuitNameFromActiveEditor(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }

  const selected = editor.document.getText(editor.selection).trim();
  if (selected && looksLikeCircuitReference(selected)) {
    return selected;
  }

  const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active);
  if (wordRange) {
    const word = editor.document.getText(wordRange).trim();
    if (word && looksLikeCircuitReference(word)) {
      return word;
    }
  }

  return undefined;
}

export class CircuitNavigationService {
  constructor(private readonly context: vscode.ExtensionContext) {}

  activate(): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        'policyStudioTools.jumpToCircuit',
        (circuitName?: string, options?: JumpToCircuitOptions) =>
          this.runJumpCommand(circuitName, options),
      ),
    );
  }

  private async runJumpCommand(
    circuitName?: string,
    options?: JumpToCircuitOptions,
  ): Promise<JumpResult> {
    let name = typeof circuitName === 'string' ? circuitName : undefined;

    if (!name) {
      name = circuitNameFromActiveEditor();
    }

    if (!name) {
      name = await vscode.window.showInputBox({
        prompt: 'Circuit name to jump to',
        placeHolder: 'e.g. PaymentService',
      });
      if (name === undefined) {
        return { kind: 'cancelled' };
      }
    }

    const sourceFilePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    return jumpToCircuit(name, { sourceFilePath, ...options });
  }
}
