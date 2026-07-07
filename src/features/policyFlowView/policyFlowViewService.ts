import * as path from 'path';
import * as vscode from 'vscode';
import { resolveCircuitDefinitions } from '../circuitNavigation/circuitNavigationService';
import type { CircuitDefinitionCandidate } from '../circuitNavigation/types';
import { buildCircuitIndex } from '../circuitSearch/circuitIndex';
import { readAndParsePolicyFile } from '../circuitSearch/policyFileDiscovery';
import type { ParsedCircuit } from '../circuitSearch/types';
import { getProjectForFile } from '../projectRegistry/discoverProjects';
import { getSharedProjectRegistryStore } from '../projectRegistry/projectRegistryService';
import type { PolicyStudioProject } from '../projectRegistry/types';
import { getSharedToolsHubService } from '../toolsSidebar/toolsHubService';
import { buildFlowGraph } from './flowGraph';
import { layoutFlowGraph } from './flowLayout';
import { getFlowPanelHtml } from './flowPanelHtml';
import { POLICY_FLOW_TOOL } from './toolDescriptor';

const REFRESH_DEBOUNCE_MS = 300;
const LARGE_FLOW_NODE_HINT = 150;

interface OpenPanel {
  panel: vscode.WebviewPanel;
  project: PolicyStudioProject;
  circuitName: string;
  absolutePath: string;
  watcher: vscode.FileSystemWatcher;
  refreshTimer?: ReturnType<typeof setTimeout>;
  nodeRanges: Map<string, { start: { line: number; character: number }; end: { line: number; character: number } }>;
}

type CircuitQuickPickItem = vscode.QuickPickItem & {
  project: PolicyStudioProject;
  circuitName: string;
  absolutePath: string;
};

export class PolicyFlowViewService {
  private readonly panels = new Map<string, OpenPanel>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  activate(): void {
    getSharedToolsHubService().registerTool(POLICY_FLOW_TOOL);

    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        'policyStudioTools.showPolicyFlow',
        (circuitName?: string, projectId?: string) =>
          this.runShowFlowCommand(circuitName, projectId),
      ),
    );
  }

  private async runShowFlowCommand(circuitName?: string, projectId?: string): Promise<void> {
    const store = getSharedProjectRegistryStore();
    const projects = store.getProjectsInScope();

    if (projects.length === 0) {
      void vscode.window.showWarningMessage(
        'No Policy Studio projects in the current scope.',
      );
      return;
    }

    if (circuitName) {
      const project = projectId
        ? projects.find((entry) => entry.id === projectId)
        : undefined;
      await this.openByName(circuitName, project ?? projects[0]);
      return;
    }

    const fromEditor = await this.circuitFromActiveEditor();
    if (fromEditor) {
      await this.openFlowPanel(fromEditor.project, fromEditor.circuitName, fromEditor.absolutePath);
      return;
    }

    await this.pickCircuit(projects);
  }

  private async circuitFromActiveEditor(): Promise<
    { project: PolicyStudioProject; circuitName: string; absolutePath: string } | undefined
  > {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return undefined;
    }

    const store = getSharedProjectRegistryStore();
    const filePath = editor.document.uri.fsPath;
    const project = getProjectForFile(filePath, store.getProjectRegistry().projects);
    if (!project) {
      return undefined;
    }

    const indexed = await readAndParsePolicyFile(project, filePath);
    const cursorOffset = editor.document.offsetAt(editor.selection.active);
    const containing = indexed.circuits.find(
      (circuit) => cursorOffset >= circuit.startOffset && cursorOffset <= circuit.endOffset,
    );
    if (!containing) {
      return undefined;
    }

    return { project, circuitName: containing.name, absolutePath: filePath };
  }

  private async pickCircuit(projects: PolicyStudioProject[]): Promise<void> {
    const items: CircuitQuickPickItem[] = [];
    const includeProject = projects.length > 1;

    for (const project of projects) {
      const index = await buildCircuitIndex(project);
      for (const [name, definitions] of index.circuitByName.entries()) {
        for (const definition of definitions) {
          items.push({
            label: name,
            description: definition.filePath,
            detail: includeProject ? project.displayName : undefined,
            project,
            circuitName: name,
            absolutePath: definition.absolutePath,
          });
        }
      }
    }

    if (items.length === 0) {
      void vscode.window.showInformationMessage('No circuits found in the current scope.');
      return;
    }

    items.sort((a, b) => a.label.localeCompare(b.label));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a policy to visualize',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (picked) {
      await this.openFlowPanel(picked.project, picked.circuitName, picked.absolutePath);
    }
  }

  private async openByName(circuitName: string, project: PolicyStudioProject): Promise<void> {
    const candidates = await resolveCircuitDefinitions(project.id, circuitName);
    if (candidates.length === 0) {
      void vscode.window.showWarningMessage(
        `Circuit '${circuitName}' not found in this project.`,
      );
      return;
    }

    let chosen: CircuitDefinitionCandidate | undefined = candidates[0];
    if (candidates.length > 1) {
      const items = candidates.map((candidate) => ({
        label: candidate.circuitName,
        description: candidate.filePath,
        candidate,
      }));
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `Multiple definitions found for '${circuitName}'`,
        matchOnDescription: true,
      });
      chosen = picked?.candidate;
    }

    if (chosen) {
      await this.openFlowPanel(project, chosen.circuitName, chosen.absolutePath);
    }
  }

  private async openFlowPanel(
    project: PolicyStudioProject,
    circuitName: string,
    absolutePath: string,
  ): Promise<void> {
    const key = `${project.id}::${circuitName}`;
    const existing = this.panels.get(key);
    if (existing) {
      existing.panel.reveal();
      return;
    }

    const includeProject = getSharedProjectRegistryStore().getProjectRegistry().projects.length > 1;
    const panel = vscode.window.createWebviewPanel(
      'policyStudio.policyFlow',
      `Flow: ${circuitName}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    panel.webview.html = getFlowPanelHtml(String(Date.now()));

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(path.dirname(absolutePath)),
        path.basename(absolutePath),
      ),
    );

    const open: OpenPanel = {
      panel,
      project,
      circuitName,
      absolutePath,
      watcher,
      nodeRanges: new Map(),
    };
    this.panels.set(key, open);

    panel.webview.onDidReceiveMessage(
      (message: { type: string; nodeId?: string; circuitName?: string }) => {
        switch (message.type) {
          case 'ready':
            void this.postFlowData(open, includeProject);
            break;
          case 'openFilter':
            if (message.nodeId) {
              void this.openFilterDefinition(open, message.nodeId);
            }
            break;
          case 'openCircuit':
            if (message.circuitName) {
              void this.openByName(message.circuitName, open.project);
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
        void this.postFlowData(open, includeProject);
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
      watcher.onDidChange(scheduleRefresh),
      watcher.onDidDelete(() => {
        void open.panel.webview.postMessage({
          type: 'flowData',
          circuitName: open.circuitName,
          projectDisplayName: includeProject ? open.project.displayName : '',
          banner: `File deleted: ${open.absolutePath}. Close this panel or restore the file.`,
          nodes: [],
          edges: [],
          positions: {},
          width: 0,
          height: 0,
          warnings: [],
        });
      }),
    );
  }

  private async loadCircuit(open: OpenPanel): Promise<{ circuit?: ParsedCircuit; content: string; parseError?: string }> {
    const indexed = await readAndParsePolicyFile(open.project, open.absolutePath);
    return {
      circuit: indexed.circuits.find((circuit) => circuit.name === open.circuitName),
      content: indexed.content,
      parseError: indexed.parseError,
    };
  }

  private async postFlowData(open: OpenPanel, includeProject: boolean): Promise<void> {
    let banner: string | undefined;
    let circuit: ParsedCircuit | undefined;
    let content = '';

    try {
      const loaded = await this.loadCircuit(open);
      circuit = loaded.circuit;
      content = loaded.content;
      if (loaded.parseError) {
        banner = `Parse error in ${open.absolutePath}: ${loaded.parseError}`;
      } else if (!circuit) {
        banner = `Circuit '${open.circuitName}' no longer exists in ${open.absolutePath}.`;
      }
    } catch (error) {
      banner = `Unable to read ${open.absolutePath}: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }

    if (!circuit) {
      void open.panel.webview.postMessage({
        type: 'flowData',
        circuitName: open.circuitName,
        projectDisplayName: includeProject ? open.project.displayName : '',
        banner,
        nodes: [],
        edges: [],
        positions: {},
        width: 0,
        height: 0,
        warnings: [],
      });
      return;
    }

    const graph = buildFlowGraph(circuit, content);
    const layout = layoutFlowGraph(graph);

    open.nodeRanges.clear();
    for (const node of graph.nodes) {
      if (node.range) {
        open.nodeRanges.set(node.id, node.range);
      }
    }

    const warnings = [...graph.warnings];
    if (graph.nodes.length > LARGE_FLOW_NODE_HINT) {
      warnings.push(
        `This policy has ${graph.nodes.length} filters — the view may be slow.`,
      );
    }

    const positions: Record<string, { x: number; y: number }> = {};
    for (const [id, position] of layout.positions) {
      positions[id] = { x: position.x, y: position.y };
    }

    void open.panel.webview.postMessage({
      type: 'flowData',
      circuitName: graph.circuitName,
      projectDisplayName: includeProject ? open.project.displayName : '',
      banner,
      nodes: graph.nodes,
      edges: graph.edges,
      positions,
      width: layout.width,
      height: layout.height,
      warnings,
    });
  }

  private async openFilterDefinition(open: OpenPanel, nodeId: string): Promise<void> {
    const range = open.nodeRanges.get(nodeId);
    if (!range) {
      return;
    }

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(open.absolutePath));
    const selection = new vscode.Range(
      range.start.line,
      range.start.character,
      range.end.line,
      range.end.character,
    );
    const editor = await vscode.window.showTextDocument(document, {
      selection,
      viewColumn: vscode.ViewColumn.Beside,
    });
    editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
  }
}
