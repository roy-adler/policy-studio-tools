import * as vscode from 'vscode';
import { getSharedProjectRegistryStore } from '../projectRegistry/projectRegistryService';
import { getSharedToolsHubService } from '../toolsSidebar/toolsHubService';
import { PathSearchViewProvider } from './pathSearchViewProvider';
import { PATH_SEARCH_TOOL } from './toolDescriptor';

export class PathSearchService {
  private readonly viewProvider = new PathSearchViewProvider();

  constructor(private readonly context: vscode.ExtensionContext) {}

  activate(): void {
    getSharedToolsHubService().registerTool(PATH_SEARCH_TOOL);
    const store = getSharedProjectRegistryStore();
    this.context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        'policyStudio.pathSearch',
        this.viewProvider,
      ),
      vscode.commands.registerCommand('policyStudioTools.searchPaths', () =>
        this.focus(),
      ),
      store.onProjectsChanged(() => this.viewProvider.notifyProjectsChanged()),
    );
  }

  private async focus(): Promise<void> {
    await vscode.commands.executeCommand('workbench.view.extension.policy-studio');
    this.viewProvider.focus();
  }
}
