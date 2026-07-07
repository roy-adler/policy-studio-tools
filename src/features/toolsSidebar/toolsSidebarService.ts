import * as vscode from 'vscode';
import { CircuitSearchViewProvider } from './circuitSearchViewProvider';
import { ProjectsTreeProvider, registerSetActiveProjectCommand } from './projectsTreeProvider';
import { ToolsTreeProvider } from './toolsTreeProvider';
import { getSharedToolsHubService } from './toolsHubService';
import {
  getSharedProjectRegistryStore,
  ProjectRegistryService,
} from '../projectRegistry/projectRegistryService';

export const CONFIG_SHOW_ON_ACTIVATE = 'policyStudio.sidebar.showOnActivate';
export const SIDEBAR_FOCUSED_CONTEXT = 'policyStudio.sidebar.focused';

const SIDEBAR_VIEW_CONTAINER = 'workbench.view.extension.policy-studio';

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
      vscode.commands.registerCommand('policyStudioTools.focusCircuitSearch', (query?: string) => {
        void this.focusCircuitSearch(query);
      }),
      store.onProjectsChanged(() => this.onRegistryChanged(true)),
      store.onScopeChanged(() => this.onScopeChanged()),
      hub.onDidChange(() => this.toolsProvider.refresh()),
    );

    this.onRegistryChanged(false);
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
