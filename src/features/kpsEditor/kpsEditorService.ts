import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { getSharedProjectRegistryStore } from '../projectRegistry/projectRegistryService';
import type { PolicyStudioProject } from '../projectRegistry/types';
import { getSharedToolsHubService } from '../toolsSidebar/toolsHubService';
import {
  applyKpsTargetEdit,
  defaultStageTarget,
  resolveStageTarget,
  type KpsStageTarget,
} from './kpsStageGroups';
import {
  addRow,
  createMissing,
  isSessionDirty,
  removeRow,
  setCell,
} from './kpsTableMutations';
import { getKpsPanelShellHtml, renderKpsEditorHtml } from './kpsPanelHtml';
import { listKpsRootsForProjects, type KpsRootCandidate } from './listKpsRoots';
import { loadKpsSession } from './loadKpsSession';
import { resolveKpsFollowActiveProject, resolveKpsOpenDecision } from './resolveKpsSelection';
import { KPS_EDITOR_TOOL } from './toolDescriptor';
import { writeDirtyKpsTables } from './kpsTableWriter';
import type { KpsSession } from './types';

function createNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

const BROWSE_KPS_FOLDER_LABEL = 'Browse KPS folder…';
const DISCARD_ACTION = 'Discard';
const REMOVE_ACTION = 'Remove';

type IncomingMessage =
  | { type: 'ready' }
  | { type: 'selectTable'; tableName: string }
  | { type: 'selectStage'; stageId: string }
  | { type: 'selectGroup'; memberIds: string[] }
  | {
      type: 'setCell';
      tableName: string;
      target: KpsStageTarget;
      rowIndex: number;
      column: string;
      value: string;
    }
  | { type: 'addRow'; tableName: string; target: KpsStageTarget }
  | { type: 'removeRow'; tableName: string; target: KpsStageTarget; rowIndex: number }
  | { type: 'createMissing'; tableName: string; stageId: string }
  | { type: 'save' }
  | { type: 'reload' }
  | { type: 'pickKps' }
  | { type: 'switchKps' }
  | { type: 'openSource'; source: 'json' | 'storeGroup' | 'typeGroup'; tableName: string; stageId: string };

type KpsQuickPickItem = vscode.QuickPickItem & {
  kind?: vscode.QuickPickItemKind;
  kpsRoot?: string;
  browse?: boolean;
};

export class KpsEditorService {
  private panel: vscode.WebviewPanel | undefined;
  private session: KpsSession | undefined;
  private selectedTableName: string | undefined;
  private stageTarget: KpsStageTarget | undefined;
  private kpsLabel: string | undefined;
  private followInFlight = false;

  constructor(private readonly context: vscode.ExtensionContext) {}

  activate(): void {
    getSharedToolsHubService().registerTool(KPS_EDITOR_TOOL);

    const store = getSharedProjectRegistryStore();
    this.context.subscriptions.push(
      vscode.commands.registerCommand('policyStudioTools.openKpsEditor', () => this.openEditor()),
      store.onScopeChanged(() => {
        void this.handleActiveProjectChanged();
      }),
    );
  }

  private async handleActiveProjectChanged(): Promise<void> {
    if (!this.panel || !this.session || this.followInFlight) {
      return;
    }

    const store = getSharedProjectRegistryStore();
    const allProjects = store.getProjectRegistry().projects;
    const candidates = listKpsRootsForProjects(allProjects);
    const decision = resolveKpsFollowActiveProject(
      candidates,
      allProjects,
      store.getScope(),
      this.session.kpsRoot,
    );

    if (decision.kind === 'noop') {
      return;
    }

    if (decision.kind === 'missing') {
      void vscode.window.showWarningMessage(
        `No sibling KPS/ with JSON tables found for "${decision.projectDisplayName}". Keeping the current KPS session.`,
      );
      return;
    }

    this.followInFlight = true;
    try {
      if (!(await this.confirmDiscardIfDirty())) {
        return;
      }
      this.loadAndShow(decision.candidate.kpsRoot, formatCandidateLabel(decision.candidate));
    } finally {
      this.followInFlight = false;
    }
  }

  private async openEditor(): Promise<void> {
    const store = getSharedProjectRegistryStore();
    const allProjects = store.getProjectRegistry().projects;
    const candidates = listKpsRootsForProjects(allProjects);
    const decision = resolveKpsOpenDecision(candidates, store.getScope());

    if (decision.kind === 'open') {
      if (!(await this.confirmDiscardIfDirty())) {
        return;
      }
      this.loadAndShow(decision.candidate.kpsRoot, formatCandidateLabel(decision.candidate));
      return;
    }

    const selection = await this.pickKpsRoot({
      placeHolder: 'Select which KPS tables to edit (type to filter)',
      allowCancel: true,
      forcePicker: true,
      projects: allProjects,
    });
    if (!selection) {
      return;
    }

    if (!(await this.confirmDiscardIfDirty())) {
      return;
    }

    this.loadAndShow(selection.kpsRoot, selection.label);
  }

  private async pickKpsRoot(options: {
    placeHolder: string;
    allowCancel: boolean;
    forcePicker: boolean;
    projects: PolicyStudioProject[];
  }): Promise<{ kpsRoot: string; label: string } | undefined> {
    const candidates = listKpsRootsForProjects(options.projects);

    if (candidates.length === 0 && options.projects.length === 0) {
      void vscode.window.showErrorMessage('No Policy Studio projects discovered in the workspace.');
      return undefined;
    }

    if (!options.forcePicker && candidates.length === 1) {
      const only = candidates[0];
      return { kpsRoot: only.kpsRoot, label: formatCandidateLabel(only) };
    }

    const items: KpsQuickPickItem[] = [
      ...candidates.map((candidate) => ({
        label: formatCandidateLabel(candidate),
        description: candidate.project.relativePath || candidate.project.rootPath,
        detail: `Stages: ${candidate.stageIds.join(', ')} — ${candidate.kpsRoot}`,
        kpsRoot: candidate.kpsRoot,
      })),
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      {
        label: BROWSE_KPS_FOLDER_LABEL,
        description: 'Choose any KPS folder on disk',
        browse: true,
      },
    ];

    if (candidates.length === 0) {
      void vscode.window.showWarningMessage(
        'No sibling KPS/ folders with JSON tables were found for discovered projects. Browse to pick one, or check project discovery.',
      );
    }

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: options.placeHolder,
      matchOnDescription: true,
      matchOnDetail: true,
      ignoreFocusOut: true,
    });

    if (!picked) {
      return options.allowCancel ? undefined : undefined;
    }

    if (picked.browse) {
      const folder = await this.pickKpsFolder();
      if (!folder) {
        return undefined;
      }
      return {
        kpsRoot: folder,
        label: path.basename(path.dirname(folder)) || path.basename(folder),
      };
    }

    if (!picked.kpsRoot) {
      return undefined;
    }

    return { kpsRoot: picked.kpsRoot, label: picked.label };
  }

  private async confirmDiscardIfDirty(): Promise<boolean> {
    if (!this.session || !isSessionDirty(this.session)) {
      return true;
    }

    const confirm = await vscode.window.showWarningMessage(
      'Discard unsaved changes and reload from disk?',
      { modal: true },
      DISCARD_ACTION,
    );
    return confirm === DISCARD_ACTION;
  }

  private async pickKpsFolder(): Promise<string | undefined> {
    const folders = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select KPS folder',
      title: 'Select KPS folder',
    });
    return folders?.[0]?.fsPath;
  }

  private loadAndShow(kpsRoot: string, label?: string): void {
    const previousRoot = this.session?.kpsRoot;
    const sameKps =
      previousRoot !== undefined && path.resolve(previousRoot) === path.resolve(kpsRoot);

    try {
      this.session = loadKpsSession(kpsRoot);
      this.kpsLabel = label ?? path.basename(path.dirname(kpsRoot)) ?? path.basename(kpsRoot);

      if (!sameKps) {
        this.selectedTableName = this.session.tableNames[0];
        const table = this.selectedTableName
          ? this.session.tables[this.selectedTableName]
          : undefined;
        if (table) {
          this.stageTarget = defaultStageTarget(table, this.session.stageIds);
        } else {
          this.stageTarget = { kind: 'stage', stageId: this.session.stageIds[0] ?? '' };
        }
      } else {
        if (
          !this.selectedTableName ||
          !this.session.tables[this.selectedTableName]
        ) {
          this.selectedTableName = this.session.tableNames[0];
        }
        const table = this.selectedTableName
          ? this.session.tables[this.selectedTableName]
          : undefined;
        if (table) {
          this.stageTarget = this.stageTarget
            ? resolveStageTarget(this.stageTarget, table, this.session.stageIds)
            : defaultStageTarget(table, this.session.stageIds);
        } else {
          this.stageTarget = { kind: 'stage', stageId: this.session.stageIds[0] ?? '' };
        }
      }

      this.showPanel();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Failed to load KPS tables: ${message}`);
    }
  }

  private showPanel(): void {
    if (!this.session) {
      return;
    }

    if (this.panel) {
      this.panel.reveal();
      this.render();
      return;
    }

    const nonce = createNonce();
    this.panel = vscode.window.createWebviewPanel(
      'policyStudio.kpsEditor',
      'KPS editor',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = getKpsPanelShellHtml(nonce);

    this.panel.webview.onDidReceiveMessage((message: IncomingMessage) =>
      void this.handleMessage(message),
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  private render(): void {
    if (!this.panel || !this.session) {
      return;
    }
    const titleLabel = this.kpsLabel ?? path.basename(this.session.kpsRoot);
    this.panel.title = `KPS: ${titleLabel}`;
    this.panel.webview.html = renderKpsEditorHtml(this.session, {
      cspSource: this.panel.webview.cspSource,
      tableName: this.selectedTableName,
      stageTarget: this.stageTarget,
      kpsLabel: titleLabel,
    });
  }

  private async handleMessage(message: IncomingMessage): Promise<void> {
    if (!this.session && message.type !== 'switchKps' && message.type !== 'pickKps') {
      return;
    }

    switch (message.type) {
      case 'ready':
        this.render();
        break;
      case 'selectTable':
        this.selectedTableName = message.tableName;
        if (this.session && this.session.tables[message.tableName]) {
          this.stageTarget = defaultStageTarget(
            this.session.tables[message.tableName],
            this.session.stageIds,
          );
        }
        this.render();
        break;
      case 'selectStage':
        this.stageTarget = { kind: 'stage', stageId: message.stageId };
        this.render();
        break;
      case 'selectGroup':
        if (!this.session || !this.selectedTableName) {
          return;
        }
        {
          const table = this.session.tables[this.selectedTableName];
          const requested = { kind: 'group' as const, memberIds: message.memberIds };
          this.stageTarget = table
            ? resolveStageTarget(requested, table, this.session.stageIds)
            : requested;
        }
        this.render();
        break;
      case 'setCell':
        if (!this.session) {
          return;
        }
        {
          const result = applyKpsTargetEdit(
            this.session,
            message.tableName,
            message.target,
            (stageId) => {
              setCell(
                this.session!,
                message.tableName,
                stageId,
                message.rowIndex,
                message.column,
                message.value,
              );
            },
          );
          if (result.applied) {
            this.stageTarget = result.target;
            this.render();
          }
        }
        break;
      case 'addRow':
        if (!this.session) {
          return;
        }
        {
          const result = applyKpsTargetEdit(
            this.session,
            message.tableName,
            message.target,
            (stageId) => {
              addRow(this.session!, message.tableName, stageId);
            },
          );
          if (result.applied) {
            this.stageTarget = result.target;
            this.render();
          }
        }
        break;
      case 'removeRow':
        await this.handleRemoveRow(message.tableName, message.target, message.rowIndex);
        break;
      case 'createMissing':
        if (!this.session) {
          return;
        }
        createMissing(this.session, message.tableName, message.stageId);
        this.stageTarget = { kind: 'stage', stageId: message.stageId };
        this.render();
        break;
      case 'save':
        await this.handleSave();
        break;
      case 'reload':
        await this.handleReload();
        break;
      case 'pickKps':
        await this.handlePickKps();
        break;
      case 'switchKps':
        await this.handleSwitchKps();
        break;
      case 'openSource':
        await this.handleOpenSource(message.source, message.tableName, message.stageId);
        break;
    }
  }

  private async handleOpenSource(
    source: 'json' | 'storeGroup' | 'typeGroup',
    tableName: string,
    stageId: string,
  ): Promise<void> {
    if (!this.session) {
      return;
    }

    const table = this.session.tables[tableName];
    if (!table) {
      void vscode.window.showWarningMessage(`Unknown table "${tableName}".`);
      return;
    }

    let filePath: string | undefined;
    if (source === 'json') {
      filePath = table.stages[stageId]?.filePath;
    } else if (source === 'storeGroup') {
      filePath = table.storeGroupPath;
    } else {
      filePath = table.typeGroupPath;
    }

    if (!filePath) {
      const label =
        source === 'json' ? 'JSON' : source === 'storeGroup' ? 'Store Group' : 'Type Group';
      void vscode.window.showWarningMessage(`No ${label} file is linked for this table.`);
      return;
    }

    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
      await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Could not open ${filePath}: ${message}`);
    }
  }

  private async handleRemoveRow(
    tableName: string,
    target: KpsStageTarget,
    rowIndex: number,
  ): Promise<void> {
    if (!this.session) {
      return;
    }

    const label =
      target.kind === 'group'
        ? this.session.stageIds.filter((id) => target.memberIds.includes(id)).join('/')
        : target.stageId;
    const confirm = await vscode.window.showWarningMessage(
      `Remove row ${rowIndex + 1} from ${label}?`,
      { modal: true },
      REMOVE_ACTION,
    );
    if (confirm !== REMOVE_ACTION) {
      return;
    }

    const result = applyKpsTargetEdit(this.session, tableName, target, (stageId) => {
      removeRow(this.session!, tableName, stageId, rowIndex);
    });
    if (result.applied) {
      this.stageTarget = result.target;
      this.render();
    }
  }

  private async handleSwitchKps(): Promise<void> {
    const store = getSharedProjectRegistryStore();
    const selection = await this.pickKpsRoot({
      placeHolder: 'Switch KPS set (type to filter by policy or path)',
      allowCancel: true,
      forcePicker: true,
      projects: store.getProjectRegistry().projects,
    });
    if (!selection) {
      return;
    }

    if (!(await this.confirmDiscardIfDirty())) {
      return;
    }

    this.loadAndShow(selection.kpsRoot, selection.label);
  }

  private async handleSave(): Promise<void> {
    if (!this.session) {
      return;
    }

    try {
      const result = writeDirtyKpsTables(this.session);
      this.render();

      if (result.written.length > 0) {
        void vscode.window.showInformationMessage(
          `Saved ${result.written.length} KPS table file(s).`,
        );
      } else {
        void vscode.window.showInformationMessage('No changes to save.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Failed to save KPS tables: ${message}`);
    }
  }

  private async handleReload(): Promise<void> {
    if (!this.session) {
      return;
    }

    const kpsRoot = this.session.kpsRoot;
    const label = this.kpsLabel;

    if (!(await this.confirmDiscardIfDirty())) {
      return;
    }

    this.loadAndShow(kpsRoot, label);
  }

  private async handlePickKps(): Promise<void> {
    const folder = await this.pickKpsFolder();
    if (!folder) {
      return;
    }

    if (!(await this.confirmDiscardIfDirty())) {
      return;
    }

    this.loadAndShow(folder);
  }
}

function formatCandidateLabel(candidate: KpsRootCandidate): string {
  if (candidate.bundleName && candidate.bundleName !== candidate.project.displayName) {
    return `${candidate.bundleName} — ${candidate.project.displayName}`;
  }
  return candidate.project.displayName;
}
