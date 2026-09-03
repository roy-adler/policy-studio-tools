import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { getSharedProjectRegistryStore } from '../projectRegistry/projectRegistryService';
import type { PolicyStudioProject } from '../projectRegistry/types';
import { getSharedToolsHubService } from '../toolsSidebar/toolsHubService';
import { cacheId } from './cacheIdentity';
import { renderCacheBrowserHtml } from './cachePanelHtml';
import { loadCacheSession } from './loadCacheSession';
import { shouldRevealCacheBrowserPanel } from './panelShowMode';
import { CACHE_BROWSER_TOOL } from './toolDescriptor';
import type { CacheSession } from './types';

type IncomingMessage =
  | { type: 'ready' }
  | { type: 'search'; query: string }
  | { type: 'select'; cacheId: string }
  | { type: 'refresh' }
  | { type: 'openCache'; cacheId: string }
  | { type: 'openUsage'; cacheId: string; usageIndex: number };

const NO_PROJECTS_MESSAGE = 'No Policy Studio projects in the current scope.';

export class CacheBrowserService {
  private panel: vscode.WebviewPanel | undefined;
  private session: CacheSession | undefined;
  private selectedId: string | undefined;
  private query = '';
  private nonce = '';

  constructor(private readonly context: vscode.ExtensionContext) {}

  activate(): void {
    getSharedToolsHubService().registerTool(CACHE_BROWSER_TOOL);

    const store = getSharedProjectRegistryStore();
    this.context.subscriptions.push(
      vscode.commands.registerCommand('policyStudioTools.openCacheBrowser', () =>
        this.openBrowser(),
      ),
      store.onScopeChanged(() => {
        if (this.panel) {
          this.reloadSession(store.getProjectsInScope());
        }
      }),
    );
  }

  private async openBrowser(): Promise<void> {
    const projects = getSharedProjectRegistryStore().getProjectsInScope();
    if (projects.length === 0) {
      await vscode.window.showWarningMessage(NO_PROJECTS_MESSAGE);
      return;
    }

    this.ensurePanel('open');
    this.reloadSession(projects);
  }

  private reloadSession(projects: PolicyStudioProject[]): void {
    this.session = loadCacheSession(projects);
    if (
      this.selectedId &&
      !this.session.caches.some((cache) => cacheId(cache) === this.selectedId)
    ) {
      this.selectedId = undefined;
    }

    this.render();
  }

  private ensurePanel(mode: 'open' | 'reload'): void {
    if (this.panel) {
      if (shouldRevealCacheBrowserPanel(mode)) {
        this.panel.reveal();
      }
      return;
    }

    this.nonce = crypto.randomBytes(16).toString('hex');
    this.panel = vscode.window.createWebviewPanel(
      'policyStudio.cacheBrowser',
      'Caches',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.onDidReceiveMessage((message: IncomingMessage) =>
      void this.handleMessage(message),
    );
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.session = undefined;
      this.selectedId = undefined;
      this.query = '';
      this.nonce = '';
    });
  }

  private render(): void {
    if (!this.panel || !this.session) {
      return;
    }

    this.panel.webview.html = renderCacheBrowserHtml(this.session, {
      nonce: this.nonce,
      cspSource: this.panel.webview.cspSource,
      selectedId: this.selectedId,
      query: this.query,
    });
  }

  private async handleMessage(message: IncomingMessage): Promise<void> {
    if (!this.session) {
      return;
    }

    switch (message.type) {
      case 'ready':
        break;
      case 'search':
        this.query = message.query;
        this.render();
        break;
      case 'select':
        this.selectedId = message.cacheId;
        this.render();
        break;
      case 'refresh':
        this.reloadSession(getSharedProjectRegistryStore().getProjectsInScope());
        break;
      case 'openCache': {
        const selected = this.session.caches.find(
          (cache) => cacheId(cache) === message.cacheId,
        );
        if (selected) {
          await this.openAtOffset(selected.filePath, selected.startOffset);
        }
        break;
      }
      case 'openUsage': {
        const usages = this.session.usages.filter(
          (usage) => usage.cacheId === message.cacheId,
        );
        const usage = usages[message.usageIndex];
        if (usage) {
          await this.openAtOffset(usage.filePath, usage.startOffset);
        }
        break;
      }
    }
  }

  private async openAtOffset(filePath: string, offset: number): Promise<void> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    const position = document.positionAt(offset);
    const selection = new vscode.Selection(position, position);
    await vscode.window.showTextDocument(document, {
      selection,
      viewColumn: vscode.ViewColumn.Beside,
    });
  }
}
