import * as vscode from 'vscode';
import { CircuitSearchViewProvider } from './circuitSearchViewProvider';
import { ProjectsTreeProvider, registerSetActiveProjectCommand } from './projectsTreeProvider';
import { ToolsTreeProvider } from './toolsTreeProvider';
import { getSharedToolsHubService } from './toolsHubService';
import {
  getSharedProjectRegistryStore,
  ProjectRegistryService,
} from '../projectRegistry/projectRegistryService';
import type { ProjectsViewMode } from './projectsTreeModel';

export const CONFIG_SHOW_ON_ACTIVATE = 'policyStudio.sidebar.showOnActivate';
export const SIDEBAR_FOCUSED_CONTEXT = 'policyStudio.sidebar.focused';
export const PROJECTS_VIEW_MODE_KEY = 'policyStudio.projects.viewMode';
export const PROJECTS_VIEW_MODE_CONTEXT = 'policyStudio.projects.viewMode';

const SIDEBAR_VIEW_CONTAINER = 'workbench.view.extension.policy-studio';

function parseViewMode(value: unknown): ProjectsViewMode {
  return value === 'list' ? 'list' : 'tree';
}

export class ToolsSidebarService {
  private readonly projectsProvider: ProjectsTreeProvider;
  private readonly toolsProvider: ToolsTreeProvider;
  private readonly circuitSearchProvider: CircuitSearchViewProvider;
  private hasShownOnActivate = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly projectRegistry: ProjectRegistryService,
  ) {
    this.projectsProvider = new ProjectsTreeProvider();
    this.toolsProvider = new ToolsTreeProvider();
    this.circuitSearchProvider = new CircuitSearchViewProvider();

    const hub = getSharedToolsHubService();
    hub.setSearchProvider(this.circuitSearchProvider);
  }

  activate(): void {
    const hub = getSharedToolsHubService();
    const store = getSharedProjectRegistryStore();

    const initialMode = parseViewMode(this.context.workspaceState.get(PROJECTS_VIEW_MODE_KEY));
    this.projectsProvider.setViewMode(initialMode);
    void vscode.commands.executeCommand('setContext', PROJECTS_VIEW_MODE_CONTEXT, initialMode);

    this.context.subscriptions.push(
      vscode.window.registerTreeDataProvider('policyStudio.projects', this.projectsProvider),
      vscode.window.registerTreeDataProvider('policyStudio.tools', this.toolsProvider),
      vscode.window.registerWebviewViewProvider(
        'policyStudio.circuitSearch',
        this.circuitSearchProvider,
      ),
      registerSetActiveProjectCommand((projectId) => {
        this.projectRegistry.activateProject(projectId);
      }),
      vscode.commands.registerCommand('policyStudioTools.toggleProjectsViewMode', () => {
        void this.toggleProjectsViewMode();
      }),
      vscode.commands.registerCommand('policyStudioTools.focusCircuitSearch', (query?: string) => {
        void this.focusCircuitSearch(query);
      }),
      store.onProjectsChanged(() => this.onRegistryChanged(true)),
      store.onScopeChanged(() => this.onScopeChanged()),
      hub.onDidChange(() => this.toolsProvider.refresh()),
    );

    this.onRegistryChanged(false);
  }

  private async toggleProjectsViewMode(): Promise<void> {
    const next: ProjectsViewMode =
      this.projectsProvider.getViewMode() === 'tree' ? 'list' : 'tree';
    this.projectsProvider.setViewMode(next);
    await this.context.workspaceState.update(PROJECTS_VIEW_MODE_KEY, next);
    await vscode.commands.executeCommand('setContext', PROJECTS_VIEW_MODE_CONTEXT, next);
  }

  async focusCircuitSearch(prefillQuery?: string): Promise<void> {
    await vscode.commands.executeCommand(SIDEBAR_VIEW_CONTAINER);
    getSharedToolsHubService().focusCircuitSearch(prefillQuery);
  }

  private onScopeChanged(): void {
    this.projectsProvider.refresh();
    getSharedToolsHubService().notifyScopeChanged();
  }

  private async onRegistryChanged(maybeShowOnActivate: boolean): Promise<void> {
    const registry = getSharedProjectRegistryStore().getProjectRegistry();
    const detected = registry.projects.length > 0;

    this.projectsProvider.refresh();
    this.toolsProvider.setProjectDetected(detected);
    this.circuitSearchProvider.notifyScopeChanged();

    if (maybeShowOnActivate && detected && !this.hasShownOnActivate) {
      const showOnActivate = vscode.workspace
        .getConfiguration()
        .get<boolean>(CONFIG_SHOW_ON_ACTIVATE, false);
      if (showOnActivate) {
        this.hasShownOnActivate = true;
        await vscode.commands.executeCommand(SIDEBAR_VIEW_CONTAINER);
      }
    }
  }
}
