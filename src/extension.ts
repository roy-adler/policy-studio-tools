import * as vscode from 'vscode';
import { CircuitNavigationService } from './features/circuitNavigation/circuitNavigationService';
import { CircuitSearchService } from './features/circuitSearch/circuitSearchService';
import { ProjectRegistryService } from './features/projectRegistry/projectRegistryService';
import { ToolsSidebarService } from './features/toolsSidebar/toolsSidebarService';

export function activate(context: vscode.ExtensionContext): void {
  const projectRegistry = new ProjectRegistryService(context);
  projectRegistry.activate();

  const toolsSidebar = new ToolsSidebarService(context, projectRegistry);
  toolsSidebar.activate();

  const circuitSearch = new CircuitSearchService(context);
  circuitSearch.activate();

  const circuitNavigation = new CircuitNavigationService(context);
  circuitNavigation.activate();

  context.subscriptions.push(
    vscode.commands.registerCommand('policyStudioTools.placeholder', () => {
      void vscode.window.showInformationMessage('Policy Studio project detected');
    }),
  );
}

export function deactivate(): void {}
