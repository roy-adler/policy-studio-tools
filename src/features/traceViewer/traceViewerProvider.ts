import * as path from 'path';
import * as vscode from 'vscode';
import { getProjectForFile } from '../projectRegistry/discoverProjects';
import { getSharedProjectRegistryStore } from '../projectRegistry/projectRegistryService';
import { parseTrace } from './parseTrace';
import { getTraceViewerHtml } from './traceViewerHtml';
import type { TraceDocument } from './types';

export class TraceViewerProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'policyStudio.traceViewer';

  private readonly parseTokens = new Map<string, vscode.CancellationTokenSource>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const key = document.uri.toString();
    const parseToken = new vscode.CancellationTokenSource();
    this.parseTokens.set(key, parseToken);

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    webviewPanel.webview.html = getTraceViewerHtml(String(Date.now()));

    const postTraceData = async () => {
      if (parseToken.token.isCancellationRequested) {
        return;
      }

      const content = document.getText();
      const projectContext = this.resolveProjectContext(document.uri.fsPath);
      const traceDocument = parseTrace(content, {
        fileName: path.basename(document.uri.fsPath),
        fileSize: Buffer.byteLength(content, 'utf8'),
      });

      if (parseToken.token.isCancellationRequested) {
        return;
      }

      void webviewPanel.webview.postMessage({
        type: 'traceData',
        ...serializeTraceDocument(traceDocument, projectContext),
      });
    };

    webviewPanel.webview.onDidReceiveMessage((message: { type: string }) => {
      if (message.type === 'ready') {
        void postTraceData();
      }
    });

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== key) {
        return;
      }
      void vscode.window
        .showInformationMessage(
          'Trace file changed externally. Reload the viewer?',
          'Reload',
          'Ignore',
        )
        .then((choice) => {
          if (choice === 'Reload') {
            void postTraceData();
          }
        });
    });

    webviewPanel.onDidDispose(() => {
      parseToken.cancel();
      parseToken.dispose();
      this.parseTokens.delete(key);
      changeSubscription.dispose();
    });

    this.context.subscriptions.push(changeSubscription);
  }

  private resolveProjectContext(filePath: string): string | undefined {
    const store = getSharedProjectRegistryStore();
    const project = getProjectForFile(filePath, store.getProjectRegistry().projects);
    return project?.displayName;
  }
}

function serializeTraceDocument(
  document: TraceDocument,
  projectDisplayName: string | undefined,
): {
  metadata: TraceDocument['metadata'];
  entries: TraceDocument['entries'];
  warnings: TraceDocument['warnings'];
  parseError?: string;
  hasFailures: boolean;
  banner?: string;
} {
  const warnings = [...document.warnings];
  let banner: string | undefined;

  if (warnings.length > 0) {
    banner = warnings.map((warning) => warning.message).join(' ');
  }

  if (projectDisplayName) {
    const projectBanner = `Nearest project: ${projectDisplayName}`;
    banner = banner ? `${projectBanner} · ${banner}` : projectBanner;
  }

  return {
    metadata: document.metadata,
    entries: document.entries,
    warnings,
    parseError: document.parseError,
    hasFailures: document.hasFailures,
    banner,
  };
}
