import * as vscode from 'vscode';
import { CircuitGraphService } from './features/circuitGraph/circuitGraphService';
import { CircuitNavigationService } from './features/circuitNavigation/circuitNavigationService';
import { CircuitSearchService } from './features/circuitSearch/circuitSearchService';
import { ExportDocumentationService } from './features/exportDocumentation/exportDocumentationService';
import { PathTemplateValidatorService } from './features/pathTemplateValidator/pathTemplateValidatorService';
import { PolicyDiffService } from './features/policyDiff/policyDiffService';
import { PolicyFlowViewService } from './features/policyFlowView/policyFlowViewService';
import { ProjectRegistryService } from './features/projectRegistry/projectRegistryService';
import { ToolsSidebarService } from './features/toolsSidebar/toolsSidebarService';
import { TraceViewerService } from './features/traceViewer/traceViewerService';

export function activate(context: vscode.ExtensionContext): void {
  const projectRegistry = new ProjectRegistryService(context);
  projectRegistry.activate();

  const toolsSidebar = new ToolsSidebarService(context, projectRegistry);
  toolsSidebar.activate();

  const circuitSearch = new CircuitSearchService(context);
  circuitSearch.activate();

  const circuitNavigation = new CircuitNavigationService(context);
  circuitNavigation.activate();

  const policyFlowView = new PolicyFlowViewService(context);
  policyFlowView.activate();

  const pathTemplateValidator = new PathTemplateValidatorService(context);
  pathTemplateValidator.activate();

  const circuitGraph = new CircuitGraphService(context);
  circuitGraph.activate();

  const exportDocumentation = new ExportDocumentationService(context);
  exportDocumentation.activate();

  const policyDiff = new PolicyDiffService(context);
  policyDiff.activate();

  const traceViewer = new TraceViewerService(context);
  traceViewer.activate();

  context.subscriptions.push(
    vscode.commands.registerCommand('policyStudioTools.placeholder', () => {
      void vscode.window.showInformationMessage('Policy Studio project detected');
    }),
  );
}

export function deactivate(): void {}
