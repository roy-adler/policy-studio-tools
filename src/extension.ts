import * as vscode from 'vscode';
import { CircuitSearchService } from './features/circuitSearch/circuitSearchService';
import { ProjectRegistryService } from './features/projectRegistry/projectRegistryService';

export function activate(context: vscode.ExtensionContext): void {
  const projectRegistry = new ProjectRegistryService(context);
  projectRegistry.activate();

  const circuitSearch = new CircuitSearchService(context);
  circuitSearch.activate();

  context.subscriptions.push(
    vscode.commands.registerCommand('policyStudioTools.placeholder', () => {
      void vscode.window.showInformationMessage('Policy Studio project detected');
    }),
  );
}

export function deactivate(): void {}
