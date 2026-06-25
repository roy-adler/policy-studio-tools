import * as vscode from 'vscode';
import { getSharedToolsHubService } from '../toolsSidebar/toolsHubService';
import { getSharedProjectRegistryStore } from '../projectRegistry/projectRegistryService';
import { invalidateCircuitIndex } from './circuitIndex';
import { jumpToReferencedCircuit, openCircuitSearchResult } from './circuitSearchNavigation';
import { searchCircuits } from './searchCircuits';
import type { CircuitSearchResult } from './types';
import { DEFAULT_MAX_RESULTS } from './types';

type SearchQuickPickItem = vscode.QuickPickItem & {
  result: CircuitSearchResult;
};

export class CircuitSearchService {
  private searchGeneration = 0;

  constructor(private readonly context: vscode.ExtensionContext) {}

  activate(): void {
    const hub = getSharedToolsHubService();
    hub.registerTool({
      id: 'search-circuits',
      label: 'Search circuits',
      iconId: 'search',
      command: 'policyStudioTools.searchCircuits',
      group: 'navigate',
      order: 1,
      when: 'policyStudio.projectDetected',
      available: true,
    });

    const markerWatcher = vscode.workspace.createFileSystemWatcher(
      '**/*.{xml,yaml,yml}',
    );

    this.context.subscriptions.push(
      markerWatcher,
      markerWatcher.onDidCreate(() => invalidateCircuitIndex()),
      markerWatcher.onDidChange(() => invalidateCircuitIndex()),
      markerWatcher.onDidDelete(() => invalidateCircuitIndex()),
      vscode.commands.registerCommand('policyStudioTools.searchCircuits', () =>
        this.runSearchCommand(),
      ),
    );
  }

  private async runSearchCommand(): Promise<void> {
    const store = getSharedProjectRegistryStore();
    const projects = store.getProjectsInScope();

    if (projects.length === 0) {
      void vscode.window.showWarningMessage(
        'No Policy Studio projects in the current scope to search.',
      );
      return;
    }

    await vscode.commands.executeCommand('policyStudioTools.focusCircuitSearch');
  }

  async executeSearchWithQuickPick(projects: import('../projectRegistry/types').PolicyStudioProject[], query: string): Promise<void> {
    const generation = ++this.searchGeneration;

    const response = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Searching Policy Studio circuits',
        cancellable: false,
      },
      async () => {
        const maxResults = vscode.workspace
          .getConfiguration()
          .get<number>('policyStudio.circuitSearch.maxResults', DEFAULT_MAX_RESULTS);
        return searchCircuits(projects, query, { maxResults });
      },
    );

    if (generation !== this.searchGeneration) {
      return;
    }

    const { results, summary } = response;
    const summaryText = [
      `${summary.totalMatches} match(es)`,
      `${summary.filesScanned} file(s) scanned`,
      summary.filesSkipped > 0 ? `${summary.filesSkipped} file(s) skipped (invalid XML)` : '',
      `${summary.durationMs}ms`,
    ]
      .filter(Boolean)
      .join(' · ');

    if (results.length === 0) {
      void vscode.window.showInformationMessage(`No matches found. ${summaryText}`);
      return;
    }

    const items: SearchQuickPickItem[] = results.map((result) => ({
      label: result.matchKind === 'referencedCircuit'
        ? `$(link) ${result.referencedCircuit}`
        : result.circuitName,
      description: result.filterName,
      detail: [
        projects.length > 1 ? result.projectDisplayName : undefined,
        result.filePath,
        result.matchPreview,
      ]
        .filter(Boolean)
        .join(' · '),
      result,
      buttons:
        result.matchKind === 'referencedCircuit' && result.referencedCircuit
          ? [{ iconPath: new vscode.ThemeIcon('arrow-right'), tooltip: 'Go to referenced circuit' }]
          : undefined,
    }));

    const quickPick = vscode.window.createQuickPick<SearchQuickPickItem>();
    quickPick.title = 'Circuit Search Results';
    quickPick.placeholder = summaryText;
    quickPick.items = items;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;

    quickPick.onDidTriggerItemButton(async (event) => {
      const referenced = event.item.result.referencedCircuit;
      if (!referenced) {
        return;
      }
      await jumpToReferencedCircuit(event.item.result.projectId, referenced);
    });

    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];
      quickPick.hide();
      if (selected) {
        void openCircuitSearchResult(selected.result);
      }
    });

    quickPick.show();
  }
}
