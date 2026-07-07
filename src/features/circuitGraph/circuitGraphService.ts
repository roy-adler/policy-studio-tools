import * as vscode from 'vscode';
import { buildCircuitIndex, invalidateCircuitIndex } from '../circuitSearch/circuitIndex';
import { jumpToCircuit } from '../circuitNavigation/circuitNavigationService';
import { getSharedProjectRegistryStore } from '../projectRegistry/projectRegistryService';
import type { PolicyStudioProject } from '../projectRegistry/types';
import { getSharedToolsHubService } from '../toolsSidebar/toolsHubService';
import { buildCircuitReferenceGraph } from './buildCircuitReferenceGraph';
import { layoutCircuitGraph } from './circuitGraphLayout';
import { getCircuitGraphPanelHtml } from './circuitGraphPanelHtml';
import { filterGraph } from './filterGraph';
import { CIRCUIT_GRAPH_TOOL } from './toolDescriptor';

const REFRESH_DEBOUNCE_MS = 300;
const LARGE_GRAPH_NODE_HINT = 200;

interface OpenPanel {
  panel: vscode.WebviewPanel;
  project: PolicyStudioProject;
  watcher: vscode.FileSystemWatcher;
  refreshTimer?: ReturnType<typeof setTimeout>;
  searchQuery: string;
}

export class CircuitGraphService {
  private readonly panels = new Map<string, OpenPanel>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  activate(): void {
    getSharedToolsHubService().registerTool(CIRCUIT_GRAPH_TOOL);

    this.context.subscriptions.push(
      vscode.commands.registerCommand('policyStudioTools.showCircuitGraph', (projectId?: string) =>
        this.runShowGraphCommand(projectId),
      ),
    );
  }

  private async runShowGraphCommand(projectId?: string): Promise<void> {
    const store = getSharedProjectRegistryStore();
    const projects = store.getProjectsInScope();

    if (projects.length === 0) {
      void vscode.window.showWarningMessage(
        'No Policy Studio projects in the current scope.',
      );
      return;
    }

    let project: PolicyStudioProject | undefined;
    if (projectId) {
      project = projects.find((entry) => entry.id === projectId);
    } else if (projects.length === 1) {
      project = projects[0];
    } else {
      const picked = await vscode.window.showQuickPick(
        projects.map((entry) => ({
          label: entry.displayName,
          description: entry.relativePath || entry.rootPath,
          project: entry,
        })),
        { placeHolder: 'Select a project for the circuit graph' },
      );
      project = picked?.project;
    }

    if (!project) {
      return;
    }

    await this.openGraphPanel(project);
  }

  private async openGraphPanel(project: PolicyStudioProject): Promise<void> {
    const key = project.id;
    const existing = this.panels.get(key);
    if (existing) {
      existing.panel.reveal();
      return;
    }

    const includeProject = getSharedProjectRegistryStore().getProjectRegistry().projects.length > 1;
    const panel = vscode.window.createWebviewPanel(
      'policyStudio.circuitGraph',
      `Circuit graph: ${project.displayName}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    panel.webview.html = getCircuitGraphPanelHtml(String(Date.now()));

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(project.rootPath), '**/*.{xml,yaml,yml}'),
    );

    const open: OpenPanel = {
      panel,
      project,
      watcher,
      searchQuery: '',
    };
    this.panels.set(key, open);

    panel.webview.onDidReceiveMessage(
      (message: { type: string; query?: string; circuitName?: string }) => {
        switch (message.type) {
          case 'ready':
            void this.postGraphData(open, includeProject);
            break;
          case 'search':
            open.searchQuery = typeof message.query === 'string' ? message.query : '';
            void this.postGraphData(open, includeProject);
            break;
          case 'openCircuit':
            if (message.circuitName) {
              void jumpToCircuit(message.circuitName, { projectId: open.project.id });
            }
            break;
        }
      },
    );

    const scheduleRefresh = () => {
      if (open.refreshTimer) {
        clearTimeout(open.refreshTimer);
      }
      open.refreshTimer = setTimeout(() => {
        open.refreshTimer = undefined;
        invalidateCircuitIndex(open.project.id);
        void this.postGraphData(open, includeProject);
      }, REFRESH_DEBOUNCE_MS);
    };

    panel.onDidDispose(() => {
      if (open.refreshTimer) {
        clearTimeout(open.refreshTimer);
      }
      open.watcher.dispose();
      this.panels.delete(key);
    });

    this.context.subscriptions.push(
      watcher,
      watcher.onDidChange(scheduleRefresh),
      watcher.onDidCreate(scheduleRefresh),
      watcher.onDidDelete(scheduleRefresh),
    );
  }

  private async postGraphData(open: OpenPanel, includeProject: boolean): Promise<void> {
    let banner: string | undefined;
    let warnings: string[] = [];

    try {
      const index = await buildCircuitIndex(open.project, { force: true });
      if (index.invalidFiles.length > 0) {
        warnings.push(
          `${index.invalidFiles.length} policy file(s) could not be parsed and were skipped.`,
        );
      }

      const fullGraph = buildCircuitReferenceGraph(index);
      const graph = filterGraph(fullGraph, open.searchQuery);
      const layout = layoutCircuitGraph(graph);

      if (fullGraph.nodes.length > LARGE_GRAPH_NODE_HINT) {
        warnings.push(
          `This project has ${fullGraph.nodes.length} circuits — use the search filter to narrow the view.`,
        );
      }

      const positions: Record<string, { x: number; y: number }> = {};
      for (const [id, position] of layout.positions) {
        positions[id] = { x: position.x, y: position.y };
      }

      void open.panel.webview.postMessage({
        type: 'graphData',
        projectDisplayName: includeProject ? open.project.displayName : '',
        searchQuery: open.searchQuery,
        banner,
        warnings,
        nodes: graph.nodes,
        edges: graph.edges,
        entryPoints: graph.entryPoints,
        missingReferences: graph.missingReferences,
        cycles: graph.cycles,
        positions,
        width: layout.width,
        height: layout.height,
      });
    } catch (error) {
      banner = `Unable to build circuit graph: ${
        error instanceof Error ? error.message : String(error)
      }`;
      void open.panel.webview.postMessage({
        type: 'graphData',
        projectDisplayName: includeProject ? open.project.displayName : '',
        searchQuery: open.searchQuery,
        banner,
        warnings: [],
        nodes: [],
        edges: [],
        entryPoints: [],
        missingReferences: [],
        cycles: [],
        positions: {},
        width: 0,
        height: 0,
      });
    }
  }
}
