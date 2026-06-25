import * as path from 'path';
import * as vscode from 'vscode';
import type { PolicyStudioProject } from '../projectRegistry/types';
import { getSharedProjectRegistryStore } from '../projectRegistry/projectRegistryService';
import { buildCircuitIndex, invalidateCircuitIndex, resolveCircuitDefinitions } from './circuitIndex';
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

    const query = await vscode.window.showInputBox({
      placeHolder: 'Search circuits, filters, attributes, scripts, or references',
      prompt: 'Enter a search query',
      ignoreFocusOut: true,
    });

    if (query === undefined) {
      return;
    }

    if (!query.trim()) {
      void vscode.window.showInformationMessage(
        'Enter a non-empty search query to scan policy files.',
      );
      return;
    }

    await this.executeSearch(projects, query.trim());
  }

  async executeSearch(projects: PolicyStudioProject[], query: string): Promise<void> {
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
      await this.jumpToReferencedCircuit(event.item.result.projectId, referenced);
    });

    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];
      quickPick.hide();
      if (selected) {
        void this.openSearchResult(selected.result);
      }
    });

    quickPick.show();
  }

  private async openSearchResult(result: CircuitSearchResult): Promise<void> {
    const project = getSharedProjectRegistryStore()
      .getProjectRegistry()
      .projects.find((p) => p.id === result.projectId);
    if (!project) {
      return;
    }

    const absolutePath = vscode.Uri.file(path.join(project.rootPath, result.jumpTarget.filePath));
    const document = await vscode.workspace.openTextDocument(absolutePath);
    const editor = await vscode.window.showTextDocument(document, {
      selection: new vscode.Range(
        result.jumpTarget.range.start.line,
        result.jumpTarget.range.start.character,
        result.jumpTarget.range.end.line,
        result.jumpTarget.range.end.character,
      ),
      viewColumn: vscode.ViewColumn.Active,
    });
    editor.revealRange(
      new vscode.Range(
        result.jumpTarget.range.start.line,
        result.jumpTarget.range.start.character,
        result.jumpTarget.range.end.line,
        result.jumpTarget.range.end.character,
      ),
      vscode.TextEditorRevealType.InCenter,
    );
  }

  private async jumpToReferencedCircuit(projectId: string, circuitName: string): Promise<void> {
    const store = getSharedProjectRegistryStore();
    const project = store.getProjectRegistry().projects.find((p) => p.id === projectId);
    if (!project) {
      return;
    }

    const index = await buildCircuitIndex(project);
    const definitions = resolveCircuitDefinitions(index, circuitName);

    if (definitions.length === 0) {
      void vscode.window.showWarningMessage(`Circuit '${circuitName}' not found in this project.`);
      return;
    }

    if (definitions.length === 1) {
      await this.openDefinition(project.rootPath, definitions[0]);
      return;
    }

    const picked = await vscode.window.showQuickPick(
      definitions.map((definition) => ({
        label: definition.circuitName,
        description: definition.filePath,
        definition,
      })),
      { placeHolder: `Multiple definitions found for ${circuitName}` },
    );

    if (picked) {
      await this.openDefinition(project.rootPath, picked.definition);
    }
  }

  private async openDefinition(
    projectRoot: string,
    definition: { absolutePath: string; range: CircuitSearchResult['jumpTarget']['range'] },
  ): Promise<void> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(definition.absolutePath));
    const selection = new vscode.Range(
      definition.range.start.line,
      definition.range.start.character,
      definition.range.end.line,
      definition.range.end.character,
    );
    const editor = await vscode.window.showTextDocument(document, { selection });
    editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
  }
}
