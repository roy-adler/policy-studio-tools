import * as path from 'path';
import * as vscode from 'vscode';
import { getSharedProjectRegistryStore } from '../projectRegistry/projectRegistryService';
import type { PolicyStudioProject } from '../projectRegistry/types';
import { getSharedToolsHubService } from '../toolsSidebar/toolsHubService';
import { compareSnapshots } from './compareSnapshots';
import { loadPolicySnapshot } from './directoryAdapter';
import { getPolicyDiffPanelHtml, renderPolicyDiffReportHtml } from './policyDiffPanelHtml';
import { POLICY_DIFF_TOOL } from './toolDescriptor';
import type { PolicyDiffReport } from './types';

type SourceQuickPickItem = vscode.QuickPickItem & {
  sourceKind: 'project' | 'browse';
  sourcePath?: string;
};

export async function comparePolicySnapshots(
  leftPath: string,
  rightPath: string,
): Promise<PolicyDiffReport> {
  const left = await loadPolicySnapshot({ kind: 'directory', path: leftPath });
  const right = await loadPolicySnapshot({ kind: 'directory', path: rightPath });
  return compareSnapshots(left, right);
}

export class PolicyDiffService {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  activate(): void {
    getSharedToolsHubService().registerTool(POLICY_DIFF_TOOL);

    this.context.subscriptions.push(
      vscode.commands.registerCommand('policyStudioTools.comparePolicies', () =>
        this.runCompareCommand(),
      ),
    );
  }

  private async runCompareCommand(): Promise<void> {
    const leftPath = await this.pickSource('Select left (before) policy snapshot');
    if (!leftPath) {
      return;
    }

    const rightPath = await this.pickSource('Select right (after) policy snapshot');
    if (!rightPath) {
      return;
    }

    const report = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Comparing policy snapshots',
        cancellable: false,
      },
      async () => comparePolicySnapshots(leftPath, rightPath),
    );

    await this.showReport(report, leftPath, rightPath);

    if (report.identical) {
      void vscode.window.showInformationMessage('No semantic policy differences detected.');
    }
  }

  private async pickSource(title: string): Promise<string | undefined> {
    const store = getSharedProjectRegistryStore();
    const projects = store.getProjectsInScope();

    const items: SourceQuickPickItem[] = [
      ...projects.map((project) => ({
        label: project.displayName,
        description: project.relativePath || project.rootPath,
        detail: 'Project root from registry',
        sourceKind: 'project' as const,
        sourcePath: project.rootPath,
      })),
      {
        label: 'Browse folder…',
        description: 'Choose any directory on disk',
        sourceKind: 'browse' as const,
      },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: title,
      matchOnDescription: true,
    });

    if (!picked) {
      return undefined;
    }

    if (picked.sourceKind === 'project' && picked.sourcePath) {
      return picked.sourcePath;
    }

    const folders = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select folder',
      title,
    });

    return folders?.[0]?.fsPath;
  }

  private async showReport(
    report: PolicyDiffReport,
    leftPath: string,
    rightPath: string,
  ): Promise<void> {
    const title = `Policy diff: ${path.basename(leftPath)} → ${path.basename(rightPath)}`;

    if (this.panel) {
      this.panel.title = title;
      this.panel.webview.html = renderPolicyDiffReportHtml(report);
      this.panel.reveal();
      return;
    }

    const nonce = String(Date.now());
    this.panel = vscode.window.createWebviewPanel(
      'policyStudio.policyDiff',
      title,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = getPolicyDiffPanelHtml(nonce);

    this.panel.webview.onDidReceiveMessage((message: { type?: string }) => {
      if (message.type === 'ready') {
        if (this.panel) {
          this.panel.webview.html = renderPolicyDiffReportHtml(report);
        }
      }
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.panel.webview.html = renderPolicyDiffReportHtml(report);
  }
}

export function projectRootsForPicker(projects: PolicyStudioProject[]): string[] {
  return projects.map((project) => project.rootPath);
}
