import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getSharedProjectRegistryStore } from '../projectRegistry/projectRegistryService';
import { getSharedToolsHubService } from '../toolsSidebar/toolsHubService';
import { hasForbiddenPathSegment } from './envValuesModel';
import { addKey, createMissing, removeKey, setLeafValue } from './envValuesMutations';
import { getEnvValuesPanelShellHtml, renderEnvValuesEditorHtml } from './envValuesPanelHtml';
import { writeDirtyEnvDocuments } from './envValuesWriter';
import { listEnvRootsForProjects, type EnvRootCandidate } from './listEnvRoots';
import { loadEnvValuesSession } from './loadEnvValuesSession';
import { resolveAddKeyPath } from './resolveAddKeyPath';
import { ENV_VALUES_EDITOR_TOOL } from './toolDescriptor';
import type { EnvValuesModel } from './types';

function createNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

const BROWSE_ENV_FOLDER_LABEL = 'Browse ENV folder…';
const DISCARD_ACTION = 'Discard';
const REMOVE_ACTION = 'Remove';

type IncomingMessage =
  | { type: 'ready' }
  | { type: 'select'; path: string }
  | { type: 'setValue'; path: string; stageId: string; value: string }
  | { type: 'createMissing'; path: string; stageId: string }
  | { type: 'save' }
  | { type: 'reload' }
  | { type: 'addKey' }
  | { type: 'removeKey' }
  | { type: 'pickEnv' }
  | { type: 'switchEnv' };

type EnvQuickPickItem = vscode.QuickPickItem & {
  kind?: vscode.QuickPickItemKind;
  envRoot?: string;
  browse?: boolean;
};

export class EnvValuesEditorService {
  private panel: vscode.WebviewPanel | undefined;
  private model: EnvValuesModel | undefined;
  private selectedPath: string | undefined;
  /** Display label for the open ENV set (bundle / project name). */
  private envLabel: string | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  activate(): void {
    getSharedToolsHubService().registerTool(ENV_VALUES_EDITOR_TOOL);

    this.context.subscriptions.push(
      vscode.commands.registerCommand('policyStudioTools.openEnvValuesEditor', () =>
        this.openEditor(),
      ),
    );
  }

  private async openEditor(): Promise<void> {
    const selection = await this.pickEnvRoot({
      placeHolder: 'Select which ENV values to edit (type to filter)',
      allowCancel: true,
    });
    if (!selection) {
      return;
    }

    if (!(await this.confirmDiscardIfDirty())) {
      return;
    }

    this.loadAndShow(selection.envRoot, selection.label);
  }

  /**
   * Searchable Quick Pick of in-scope projects that have a sibling ENV/,
   * plus Browse ENV folder….
   */
  private async pickEnvRoot(options: {
    placeHolder: string;
    allowCancel: boolean;
  }): Promise<{ envRoot: string; label: string } | undefined> {
    const store = getSharedProjectRegistryStore();
    const projects = store.getProjectsInScope();
    const candidates = listEnvRootsForProjects(projects);

    if (candidates.length === 0 && projects.length === 0) {
      void vscode.window.showErrorMessage('No Policy Studio projects in the current scope.');
      return undefined;
    }

    if (candidates.length === 1) {
      const only = candidates[0];
      // Still offer browse via explicit toolbar later; open the only match directly.
      return { envRoot: only.envRoot, label: formatCandidateLabel(only) };
    }

    const items: EnvQuickPickItem[] = [
      ...candidates.map((candidate) => ({
        label: formatCandidateLabel(candidate),
        description: candidate.project.relativePath || candidate.project.rootPath,
        detail: `Stages: ${candidate.stageIds.join(', ')} — ${candidate.envRoot}`,
        envRoot: candidate.envRoot,
      })),
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      {
        label: BROWSE_ENV_FOLDER_LABEL,
        description: 'Choose any ENV folder on disk',
        browse: true,
      },
    ];

    if (candidates.length === 0) {
      void vscode.window.showWarningMessage(
        'No sibling ENV/ folders with values.yaml were found for projects in scope. Browse to pick one, or check project scope.',
      );
    }

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: options.placeHolder,
      matchOnDescription: true,
      matchOnDetail: true,
      ignoreFocusOut: true,
    });

    if (!picked) {
      return options.allowCancel ? undefined : undefined;
    }

    if (picked.browse) {
      const folder = await this.pickEnvFolder();
      if (!folder) {
        return undefined;
      }
      return { envRoot: folder, label: path.basename(path.dirname(folder)) || path.basename(folder) };
    }

    if (!picked.envRoot) {
      return undefined;
    }

    return { envRoot: picked.envRoot, label: picked.label };
  }

  private hasDirtyDocuments(): boolean {
    return (
      !!this.model && Object.values(this.model.documents).some((document) => document.dirty)
    );
  }

  private async confirmDiscardIfDirty(): Promise<boolean> {
    if (!this.hasDirtyDocuments()) {
      return true;
    }

    const confirm = await vscode.window.showWarningMessage(
      'Discard unsaved changes and reload from disk?',
      { modal: true },
      DISCARD_ACTION,
    );
    return confirm === DISCARD_ACTION;
  }

  private async pickEnvFolder(): Promise<string | undefined> {
    const folders = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select ENV folder',
      title: 'Select ENV folder',
    });
    return folders?.[0]?.fsPath;
  }

  private loadAndShow(envRoot: string, label?: string): void {
    try {
      this.model = loadEnvValuesSession(envRoot);
      this.selectedPath = undefined;
      this.envLabel = label ?? path.basename(path.dirname(envRoot)) ?? path.basename(envRoot);
      this.showPanel();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Failed to load ENV values: ${message}`);
    }
  }

  private showPanel(): void {
    if (!this.model) {
      return;
    }

    if (this.panel) {
      this.panel.reveal();
      this.render();
      return;
    }

    const nonce = createNonce();
    this.panel = vscode.window.createWebviewPanel(
      'policyStudio.envValuesEditor',
      'ENV values editor',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = getEnvValuesPanelShellHtml(nonce);

    this.panel.webview.onDidReceiveMessage((message: IncomingMessage) =>
      this.handleMessage(message),
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  private render(): void {
    if (!this.panel || !this.model) {
      return;
    }
    const titleLabel = this.envLabel ?? path.basename(this.model.envRoot);
    this.panel.title = `ENV values: ${titleLabel}`;
    this.panel.webview.html = renderEnvValuesEditorHtml(
      this.model,
      this.selectedPath,
      titleLabel,
    );
  }

  private async handleMessage(message: IncomingMessage): Promise<void> {
    if (!this.model && message.type !== 'switchEnv' && message.type !== 'pickEnv') {
      return;
    }

    switch (message.type) {
      case 'ready':
        this.render();
        break;
      case 'select':
        this.selectedPath = message.path;
        this.render();
        break;
      case 'setValue':
        if (!this.model) {
          return;
        }
        this.model = setLeafValue(this.model, message.path, message.stageId, message.value);
        this.render();
        break;
      case 'createMissing':
        if (!this.model) {
          return;
        }
        this.model = createMissing(this.model, message.path, message.stageId);
        this.render();
        break;
      case 'addKey':
        await this.handleAddKey();
        break;
      case 'removeKey':
        await this.handleRemoveKey();
        break;
      case 'save':
        await this.handleSave();
        break;
      case 'reload':
        await this.handleReload();
        break;
      case 'pickEnv':
        await this.handlePickEnv();
        break;
      case 'switchEnv':
        await this.handleSwitchEnv();
        break;
    }
  }

  private async handleSwitchEnv(): Promise<void> {
    const selection = await this.pickEnvRoot({
      placeHolder: 'Switch ENV values set (type to filter)',
      allowCancel: true,
    });
    if (!selection) {
      return;
    }

    if (!(await this.confirmDiscardIfDirty())) {
      return;
    }

    this.loadAndShow(selection.envRoot, selection.label);
  }

  private async handleAddKey(): Promise<void> {
    if (!this.model) {
      return;
    }

    const input = await vscode.window.showInputBox({
      prompt: this.selectedPath
        ? `New key, relative to "${this.selectedPath}" (or a dotted path for an absolute key)`
        : 'Dotted key path to add (e.g. A.NEW_KEY)',
      placeHolder: this.selectedPath ? 'NEW_KEY or A.NEW_KEY' : 'A.NEW_KEY',
      validateInput: (value) => (value.trim().length > 0 ? undefined : 'Path is required'),
    });

    if (!input) {
      return;
    }

    const targetPath = resolveAddKeyPath(this.selectedPath, input);
    if (hasForbiddenPathSegment(targetPath)) {
      void vscode.window.showErrorMessage(
        `Invalid key path "${targetPath}": "__proto__", "prototype", and "constructor" are not allowed.`,
      );
      return;
    }

    const previousModel = this.model;
    const nextModel = addKey(this.model, targetPath);
    if (nextModel === previousModel) {
      void vscode.window.showWarningMessage(
        `Could not add "${targetPath}": the key already exists or the path conflicts with an existing value.`,
      );
      return;
    }

    this.model = nextModel;
    this.selectedPath = targetPath;
    this.render();
  }

  private async handleRemoveKey(): Promise<void> {
    if (!this.model || !this.selectedPath) {
      void vscode.window.showWarningMessage('Select a key in the tree before removing it.');
      return;
    }

    const targetPath = this.selectedPath;
    const confirm = await vscode.window.showWarningMessage(
      `Remove "${targetPath}" from all stages?`,
      { modal: true },
      REMOVE_ACTION,
    );

    if (confirm !== REMOVE_ACTION) {
      return;
    }

    this.model = removeKey(this.model, targetPath);
    this.selectedPath = undefined;
    this.render();
  }

  private async handleSave(): Promise<void> {
    if (!this.model) {
      return;
    }

    try {
      const result = writeDirtyEnvDocuments(this.model);
      this.model = result.model;
      this.render();

      if (result.written.length > 0) {
        void vscode.window.showInformationMessage(
          `Saved ${result.written.length} ENV values file(s).`,
        );
      } else {
        void vscode.window.showInformationMessage('No changes to save.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Failed to save ENV values: ${message}`);
    }
  }

  private async handleReload(): Promise<void> {
    if (!this.model) {
      return;
    }

    const envRoot = this.model.envRoot;
    const label = this.envLabel;

    if (!(await this.confirmDiscardIfDirty())) {
      return;
    }

    this.loadAndShow(envRoot, label);
  }

  private async handlePickEnv(): Promise<void> {
    const folder = await this.pickEnvFolder();
    if (!folder) {
      return;
    }

    if (!(await this.confirmDiscardIfDirty())) {
      return;
    }

    this.loadAndShow(folder);
  }
}

function formatCandidateLabel(candidate: EnvRootCandidate): string {
  if (candidate.bundleName && candidate.bundleName !== candidate.project.displayName) {
    return `${candidate.bundleName} — ${candidate.project.displayName}`;
  }
  return candidate.project.displayName;
}
