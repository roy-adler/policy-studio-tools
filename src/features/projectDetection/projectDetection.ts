import * as vscode from 'vscode';
import { isPolicyStudioProject } from './detectPolicyStudioProject';

export const PROJECT_DETECTED_CONTEXT = 'policyStudio.projectDetected';
const STATUS_BAR_TEXT = 'Policy Studio project detected';

export class ProjectDetection {
  private readonly statusBarItem: vscode.StatusBarItem;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.statusBarItem.text = STATUS_BAR_TEXT;
    context.subscriptions.push(this.statusBarItem);
  }

  activate(): void {
    this.update();

    const onWorkspaceChange = () => this.update();
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(onWorkspaceChange),
    );
  }

  private update(): void {
    const detected = this.isDetectedInWorkspace();
    void vscode.commands.executeCommand(
      'setContext',
      PROJECT_DETECTED_CONTEXT,
      detected,
    );

    if (detected) {
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  private isDetectedInWorkspace(): boolean {
    const folders = vscode.workspace.workspaceFolders ?? [];
    return folders.some((folder) => isPolicyStudioProject(folder.uri.fsPath));
  }
}
