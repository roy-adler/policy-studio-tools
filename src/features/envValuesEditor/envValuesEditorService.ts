import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getSharedProjectRegistryStore } from '../projectRegistry/projectRegistryService';
import { getSharedToolsHubService } from '../toolsSidebar/toolsHubService';
import { resolveSiblingEnvRoot } from './discoverEnvStages';
import { addKey, createMissing, removeKey, setLeafValue } from './envValuesMutations';
import { getEnvValuesPanelShellHtml, renderEnvValuesEditorHtml } from './envValuesPanelHtml';
import { writeDirtyEnvDocuments } from './envValuesWriter';
import { loadEnvValuesSession } from './loadEnvValuesSession';
import { pickProjectRootForEnvEditor } from './pickProjectRootForEnvEditor';
import { ENV_VALUES_EDITOR_TOOL } from './toolDescriptor';
import type { EnvValuesModel } from './types';

const PICK_ENV_FOLDER_ACTION = 'Pick ENV folder…';
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
  | { type: 'pickEnv' };

export class EnvValuesEditorService {
  private panel: vscode.WebviewPanel | undefined;
  private model: EnvValuesModel | undefined;
  private selectedPath: string | undefined;

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
    const store = getSharedProjectRegistryStore();
    const projects = store.getProjectsInScope();

    if (projects.length === 0) {
      void vscode.window.showErrorMessage('No Policy Studio projects in the current scope.');
      return;
    }

    let project = pickProjectRootForEnvEditor(projects, store.getScope());
    if (!project) {
      const picked = await vscode.window.showQuickPick(
        projects.map((entry) => ({
          label: entry.displayName,
          description: entry.relativePath || entry.rootPath,
          project: entry,
        })),
        { placeHolder: 'Select a project for the ENV values editor' },
      );
      project = picked?.project;
    }

    if (!project) {
      return;
    }

    const envRoot = await this.resolveEnvRoot(resolveSiblingEnvRoot(project.rootPath));
    if (!envRoot) {
      return;
    }

    this.loadAndShow(envRoot);
  }

  private async resolveEnvRoot(sibling: string): Promise<string | undefined> {
    if (fs.existsSync(sibling)) {
      return sibling;
    }

    const choice = await vscode.window.showWarningMessage(
      `No ENV folder found next to the project (expected ${sibling}).`,
      { modal: true },
      PICK_ENV_FOLDER_ACTION,
    );

    if (choice !== PICK_ENV_FOLDER_ACTION) {
      return undefined;
    }

    return this.pickEnvFolder();
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

  private loadAndShow(envRoot: string): void {
    this.model = loadEnvValuesSession(envRoot);
    this.selectedPath = undefined;
    this.showPanel();
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

    const nonce = String(Date.now());
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
    this.panel.title = `ENV values editor: ${path.basename(this.model.envRoot)}`;
    this.panel.webview.html = renderEnvValuesEditorHtml(this.model, this.selectedPath);
  }

  private async handleMessage(message: IncomingMessage): Promise<void> {
    if (!this.model) {
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
        this.model = setLeafValue(this.model, message.path, message.stageId, message.value);
        this.render();
        break;
      case 'createMissing':
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
    }
  }

  private async handleAddKey(): Promise<void> {
    if (!this.model) {
      return;
    }

    const input = await vscode.window.showInputBox({
      prompt: 'Dotted key path to add (e.g. A.NEW_KEY)',
      placeHolder: 'A.NEW_KEY',
      validateInput: (value) => (value.trim().length > 0 ? undefined : 'Path is required'),
    });

    if (!input) {
      return;
    }

    const targetPath = input.trim();
    this.model = addKey(this.model, targetPath);
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
  }

  private async handleReload(): Promise<void> {
    if (!this.model) {
      return;
    }

    const envRoot = this.model.envRoot;
    const hasDirtyStages = Object.values(this.model.documents).some((document) => document.dirty);

    if (hasDirtyStages) {
      const confirm = await vscode.window.showWarningMessage(
        'Discard unsaved changes and reload from disk?',
        { modal: true },
        DISCARD_ACTION,
      );
      if (confirm !== DISCARD_ACTION) {
        return;
      }
    }

    this.loadAndShow(envRoot);
  }

  private async handlePickEnv(): Promise<void> {
    const folder = await this.pickEnvFolder();
    if (!folder) {
      return;
    }
    this.loadAndShow(folder);
  }
}
