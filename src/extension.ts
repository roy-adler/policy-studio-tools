import * as vscode from 'vscode';
import { ProjectDetection } from './features/projectDetection/projectDetection';

export function activate(context: vscode.ExtensionContext): void {
  const projectDetection = new ProjectDetection(context);
  projectDetection.activate();

  context.subscriptions.push(
    vscode.commands.registerCommand('policyStudioTools.placeholder', () => {
      void vscode.window.showInformationMessage('Policy Studio project detected');
    }),
  );
}

export function deactivate(): void {}
