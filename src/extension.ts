import * as vscode from 'vscode';
import { ProjectRegistryService } from './features/projectRegistry/projectRegistryService';

export function activate(context: vscode.ExtensionContext): void {
  const projectRegistry = new ProjectRegistryService(context);
  projectRegistry.activate();

  context.subscriptions.push(
    vscode.commands.registerCommand('policyStudioTools.placeholder', () => {
      void vscode.window.showInformationMessage('Policy Studio project detected');
    }),
  );
}

export function deactivate(): void {}
