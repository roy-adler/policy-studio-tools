import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { getSharedProjectRegistryStore } from '../projectRegistry/projectRegistryService';
import { buildProjectsTree, type ProjectsViewMode } from './projectsTreeModel';
import { projectsTreeShell, renderProjectsTreeRows } from './projectsTreeView';

interface ProjectsTreeMessage {
  type?: string;
  id?: string;
  command?: string;
  projectId?: string;
  kind?: string;
}

export class ProjectsTreeProvider implements vscode.WebviewViewProvider {
  private readonly collapsed = new Set<string>();
  private view: vscode.WebviewView | undefined;
  private viewMode: ProjectsViewMode = 'tree';

  constructor() {
    const store = getSharedProjectRegistryStore();
    store.onProjectsChanged(() => this.refresh());
    store.onScopeChanged(() => this.refresh());
  }

  getViewMode(): ProjectsViewMode {
    return this.viewMode;
  }

  setViewMode(mode: ProjectsViewMode): void {
    this.viewMode = mode;
    this.refresh();
  }

  refresh(): void {
    if (!this.view) {
      return;
    }

    const store = getSharedProjectRegistryStore();
    const nodes = buildProjectsTree(store.getProjectRegistry(), store.getScope(), this.viewMode);
    void this.view.webview.postMessage({
      type: 'render',
      html: renderProjectsTreeRows(nodes, this.collapsed),
    });
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const nonce = crypto.randomBytes(16).toString('hex');
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage((message: ProjectsTreeMessage) => {
      this.onMessage(message);
    });
    webviewView.webview.html = projectsTreeShell(webviewView.webview.cspSource, nonce);
  }

  private onMessage(message: ProjectsTreeMessage): void {
    if (message.type === 'ready') {
      this.refresh();
      return;
    }
    if (message.type !== 'activate' || !message.id) {
      return;
    }

    if (message.kind === 'folder' || message.kind === 'workspaceFolder') {
      if (this.collapsed.has(message.id)) {
        this.collapsed.delete(message.id);
      } else {
        this.collapsed.add(message.id);
      }
      this.refresh();
      return;
    }

    if (!message.command) {
      return;
    }
    if (message.projectId) {
      void vscode.commands.executeCommand(message.command, message.projectId);
      return;
    }
    void vscode.commands.executeCommand(message.command);
  }
}

export function registerSetActiveProjectCommand(
  setActiveProject: (projectId: string) => void,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'policyStudioTools.setActiveProject',
    (projectId: string) => {
      setActiveProject(projectId);
    },
  );
}
