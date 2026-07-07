import * as vscode from 'vscode';
import { getSharedToolsHubService } from '../toolsSidebar/toolsHubService';
import { TRACE_VIEWER_TOOL } from './toolDescriptor';
import { TraceViewerProvider } from './traceViewerProvider';

export class TraceViewerService {
  private readonly provider: TraceViewerProvider;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.provider = new TraceViewerProvider(context);
  }

  activate(): void {
    getSharedToolsHubService().registerTool(TRACE_VIEWER_TOOL);

    this.context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(
        TraceViewerProvider.viewType,
        this.provider,
        {
          webviewOptions: {
            retainContextWhenHidden: true,
          },
          supportsMultipleEditorsPerDocument: false,
        },
      ),
      vscode.commands.registerCommand('policyStudioTools.openTraceFile', () =>
        this.openTraceFile(),
      ),
    );
  }

  private async openTraceFile(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        'Trace files': ['trc'],
      },
      openLabel: 'Open trace',
    });

    const uri = uris?.[0];
    if (!uri) {
      return;
    }

    await vscode.commands.executeCommand(
      'vscode.openWith',
      uri,
      TraceViewerProvider.viewType,
    );
  }
}
