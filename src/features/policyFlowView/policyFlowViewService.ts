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
import { buildPolicyTree } from './policyTree';
import { POLICY_FLOW_TOOL } from './toolDescriptor';

const REFRESH_DEBOUNCE_MS = 300;
const LARGE_FLOW_NODE_HINT = 150;

interface ShownCircuit {
  project: PolicyStudioProject;
  circuitName: string;
  absolutePath: string;
}

interface OpenPanel {
  panel: vscode.WebviewPanel;
  /** Policy shown in the panel; undefined until one is chosen in the tree. */
  shown?: ShownCircuit;
  watcher?: vscode.Disposable;
  refreshTimer?: ReturnType<typeof setTimeout>;
  nodeRanges: Map<string, { start: { line: number; character: number }; end: { line: number; character: number } }>;
}

export class PolicyFlowViewService {
  private readonly panels = new Set<OpenPanel>();

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

    // No circuit in context: open the panel with the policy tree so the user
    // picks a policy from the project's folder structure.
    await this.openFlowPanel();
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

  private findPanel(project: PolicyStudioProject, circuitName: string): OpenPanel | undefined {
    for (const open of this.panels) {
      if (open.shown?.project.id === project.id && open.shown.circuitName === circuitName) {
        return open;
      }
    }
    return undefined;
  }

  private includeProject(): boolean {
    return getSharedProjectRegistryStore().getProjectRegistry().projects.length > 1;
  }

  private async openFlowPanel(
    project?: PolicyStudioProject,
    circuitName?: string,
    absolutePath?: string,
  ): Promise<void> {
    if (project && circuitName && absolutePath) {
      const existing = this.findPanel(project, circuitName);
      if (existing) {
        existing.panel.reveal();
        return;
      }
    } else {
      // Reuse a panel that is still waiting for a policy choice.
      const waiting = [...this.panels].find((entry) => !entry.shown);
      if (waiting) {
        waiting.panel.reveal();
        return;
      }
    }

    const panel = vscode.window.createWebviewPanel(
      'policyStudio.policyFlow',
      circuitName ? `Flow: ${circuitName}` : 'Policy Flow',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    panel.webview.html = getFlowPanelHtml(String(Date.now()));

    const open: OpenPanel = { panel, nodeRanges: new Map() };
    this.panels.add(open);
    if (project && circuitName && absolutePath) {
      this.showCircuit(open, { project, circuitName, absolutePath }, false);
    }

    panel.webview.onDidReceiveMessage(
      (message: {
        type: string;
        nodeId?: string;
        circuitName?: string;
        projectId?: string;
        absolutePath?: string;
      }) => {
        switch (message.type) {
          case 'ready':
            void this.postPolicyTree(open);
            void this.postFlowData(open);
            break;
          case 'refreshTree':
            void this.postPolicyTree(open, true);
            break;
          case 'selectPolicy':
            if (message.circuitName && message.projectId && message.absolutePath) {
              void this.selectPolicy(open, message.projectId, message.circuitName, message.absolutePath);
            }
            break;
          case 'openFilter':
            if (message.nodeId) {
              void this.openFilterDefinition(open, message.nodeId);
            }
            break;
          case 'openCircuit':
            if (message.circuitName && open.shown) {
              void this.openByName(message.circuitName, open.shown.project);
            }
            break;
        }
      },
    );

    panel.onDidDispose(() => {
      if (open.refreshTimer) {
        clearTimeout(open.refreshTimer);
      }
      open.watcher?.dispose();
      this.panels.delete(open);
    });
  }

  /** Tree click: show the chosen policy in this panel (or reveal the panel already showing it). */
  private async selectPolicy(
    open: OpenPanel,
    projectId: string,
    circuitName: string,
    absolutePath: string,
  ): Promise<void> {
    const project = getSharedProjectRegistryStore()
      .getProjectsInScope()
      .find((entry) => entry.id === projectId);
    if (!project) {
      void vscode.window.showWarningMessage('That project is no longer in the current scope.');
      return;
    }
    const other = this.findPanel(project, circuitName);
    if (other && other !== open) {
      other.panel.reveal();
      return;
    }
    this.showCircuit(open, { project, circuitName, absolutePath }, true);
  }

  private showCircuit(open: OpenPanel, shown: ShownCircuit, post: boolean): void {
    open.watcher?.dispose();
    if (open.refreshTimer) {
      clearTimeout(open.refreshTimer);
      open.refreshTimer = undefined;
    }
    open.shown = shown;
    open.nodeRanges.clear();
    open.panel.title = `Flow: ${shown.circuitName}`;

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(path.dirname(shown.absolutePath)),
        path.basename(shown.absolutePath),
      ),
    );
    const scheduleRefresh = () => {
      if (open.refreshTimer) {
        clearTimeout(open.refreshTimer);
      }
      open.refreshTimer = setTimeout(() => {
        open.refreshTimer = undefined;
        void this.postFlowData(open);
      }, REFRESH_DEBOUNCE_MS);
    };
    const subscriptions = [
      watcher,
      watcher.onDidChange(scheduleRefresh),
      watcher.onDidCreate(scheduleRefresh),
      watcher.onDidDelete(() => {
        void open.panel.webview.postMessage({
          ...this.emptyFlowMessage(open),
          banner: `File deleted: ${shown.absolutePath}. Close this panel or restore the file.`,
        });
      }),
    ];
    open.watcher = { dispose: () => subscriptions.forEach((entry) => entry.dispose()) };

    if (post) {
      void this.postFlowData(open);
    }
  }

  private async postPolicyTree(open: OpenPanel, force = false): Promise<void> {
    const projects = getSharedProjectRegistryStore().getProjectsInScope();
    try {
      const indexes = await Promise.all(
        projects.map((project) => buildCircuitIndex(project, { force })),
      );
      void open.panel.webview.postMessage({
        type: 'policyTree',
        tree: buildPolicyTree(indexes),
      });
    } catch (error) {
      void open.panel.webview.postMessage({
        type: 'policyTree',
        tree: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private emptyFlowMessage(open: OpenPanel) {
    return {
      type: 'flowData',
      circuitName: open.shown?.circuitName ?? '',
      projectId: open.shown?.project.id ?? '',
      absolutePath: open.shown?.absolutePath ?? '',
      projectDisplayName: open.shown && this.includeProject() ? open.shown.project.displayName : '',
      banner: undefined as string | undefined,
      nodes: [],
      edges: [],
      positions: {},
      width: 0,
      height: 0,
      warnings: [],
    };
  }

  private async loadCircuit(shown: ShownCircuit): Promise<{ circuit?: ParsedCircuit; content: string; parseError?: string }> {
    const indexed = await readAndParsePolicyFile(shown.project, shown.absolutePath);
    return {
      circuit: indexed.circuits.find((circuit) => circuit.name === shown.circuitName),
      content: indexed.content,
      parseError: indexed.parseError,
    };
  }

  private async postFlowData(open: OpenPanel): Promise<void> {
    const shown = open.shown;
    if (!shown) {
      void open.panel.webview.postMessage({ ...this.emptyFlowMessage(open), noSelection: true });
      return;
    }
    const includeProject = this.includeProject();
    let banner: string | undefined;
    let circuit: ParsedCircuit | undefined;
    let content = '';

    try {
      const loaded = await this.loadCircuit(shown);
      circuit = loaded.circuit;
      content = loaded.content;
      if (loaded.parseError) {
        banner = `Parse error in ${shown.absolutePath}: ${loaded.parseError}`;
      } else if (!circuit) {
        banner = `Circuit '${shown.circuitName}' no longer exists in ${shown.absolutePath}.`;
      }
    } catch (error) {
      banner = `Unable to read ${shown.absolutePath}: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }

    if (!circuit) {
      void open.panel.webview.postMessage({ ...this.emptyFlowMessage(open), banner });
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
      projectId: shown.project.id,
      absolutePath: shown.absolutePath,
      projectDisplayName: includeProject ? shown.project.displayName : '',
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
    const shown = open.shown;
    if (!range || !shown) {
      return;
    }

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(shown.absolutePath));
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
