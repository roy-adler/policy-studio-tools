import * as vscode from 'vscode';
import { getSharedProjectRegistryStore } from '../projectRegistry/projectRegistryService';
import { loadPathInventory } from './loadPathInventory';
import {
  jumpToServicePathCircuit,
  openServicePathEntry,
} from './pathSearchNavigation';
import type { ServicePathEntry } from './types';

const DEBOUNCE_MS = 300;
const VIEW_TYPE = 'policyStudio.pathSearch';

type IncomingMessage =
  | { type: 'ready' }
  | { type: 'search'; query?: string }
  | { type: 'refresh' }
  | { type: 'openResult'; index?: number }
  | { type: 'goToCircuit'; index?: number };

interface WebviewPathResult {
  index: number;
  uriPrefix: string;
  projectDisplayName: string;
  interfaceName: string;
  httpMethod?: string;
  uriMatcher?: string;
  filterCircuit?: string;
}

export class PathSearchViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private lastResults: ServicePathEntry[] = [];
  private query = '';
  private focusPending = false;

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    };
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage((message: IncomingMessage) => {
      switch (message.type) {
        case 'ready':
          this.runSearch(this.query);
          if (this.focusPending) {
            this.postMessage({ type: 'focusInput' });
            this.focusPending = false;
          }
          break;
        case 'search':
          this.scheduleSearch(message.query ?? '');
          break;
        case 'refresh':
          this.runSearch(this.query);
          break;
        case 'openResult':
          this.withResult(message.index, openServicePathEntry);
          break;
        case 'goToCircuit':
          this.withResult(message.index, jumpToServicePathCircuit);
          break;
      }
    });
  }

  focus(): void {
    if (this.view) {
      this.view.show?.(true);
      this.postMessage({ type: 'focusInput' });
    } else {
      this.focusPending = true;
    }
    void vscode.commands.executeCommand(`workbench.view.extension.policy-studio.${VIEW_TYPE}`);
  }

  notifyProjectsChanged(): void {
    if (this.view) {
      this.runSearch(this.query);
    }
  }

  private withResult(
    index: number | undefined,
    action: (entry: ServicePathEntry) => Promise<void>,
  ): void {
    if (typeof index !== 'number') {
      return;
    }
    const result = this.lastResults[index];
    if (result) {
      void action(result);
    }
  }

  private scheduleSearch(query: string): void {
    this.query = query;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.runSearch(this.query);
    }, DEBOUNCE_MS);
  }

  private runSearch(query: string): void {
    this.query = query;
    const projects = getSharedProjectRegistryStore().getProjectRegistry().projects;
    const response = loadPathInventory(projects, query);
    this.lastResults = response.results;

    const results: WebviewPathResult[] = response.results.map((entry, index) => ({
      index,
      uriPrefix: entry.uriPrefix,
      projectDisplayName: entry.projectDisplayName,
      interfaceName: entry.interfaceName,
      httpMethod: entry.httpMethod,
      uriMatcher: entry.uriMatcher,
      filterCircuit: entry.filterCircuit,
    }));

    this.postMessage({
      type: 'state',
      projectDetected: projects.length > 0,
      query,
      results,
      projectsScanned: response.projectsScanned,
      warningCount: response.warnings.length,
    });
  }

  private postMessage(message: Record<string, unknown>): void {
    void this.view?.webview.postMessage(message);
  }

  private getHtml(): string {
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      margin: 0;
      padding: 8px;
    }
    .search {
      display: flex;
      gap: 4px;
      margin-bottom: 8px;
    }
    input {
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
      padding: 6px 8px;
      border: 1px solid var(--vscode-input-border, transparent);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
    }
    button {
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
    }
    .empty { opacity: 0.85; padding: 8px 4px; font-size: 12px; }
    .results { list-style: none; padding: 0; margin: 0; }
    .result {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 8px;
      margin-bottom: 6px;
      cursor: pointer;
    }
    .result:hover { background: var(--vscode-list-hoverBackground); }
    .title { font-weight: 600; font-family: var(--vscode-editor-font-family); }
    .qualifier { font-size: 11px; opacity: 0.85; margin-left: 6px; }
    .meta, .circuit { font-size: 11px; margin-top: 4px; }
    .meta { opacity: 0.85; }
    .circuit { font-family: var(--vscode-editor-font-family); }
    .actions { margin-top: 6px; }
    button.link {
      background: none;
      border: none;
      color: var(--vscode-textLink-foreground);
      padding: 0;
      font-size: 11px;
    }
    footer {
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid var(--vscode-panel-border);
      font-size: 11px;
      opacity: 0.8;
    }
  </style>
</head>
<body>
  <div class="search">
    <input id="query" type="search" placeholder="Search service paths…" />
    <button id="refresh" title="Refresh paths" aria-label="Refresh paths">↻</button>
  </div>
  <div id="status" class="empty"></div>
  <ul id="results" class="results"></ul>
  <footer id="summary"></footer>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const queryInput = document.getElementById('query');
    const refreshButton = document.getElementById('refresh');
    const statusEl = document.getElementById('status');
    const resultsEl = document.getElementById('results');
    const summaryEl = document.getElementById('summary');

    queryInput.addEventListener('input', () => {
      vscode.postMessage({ type: 'search', query: queryInput.value });
    });
    refreshButton.addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'focusInput') {
        queryInput.focus();
        queryInput.select();
      }
      if (message.type === 'state') {
        renderState(message);
      }
    });

    function renderState(state) {
      resultsEl.innerHTML = '';
      summaryEl.textContent = '';
      queryInput.value = state.query || '';
      const results = state.results || [];

      if (!state.projectDetected) {
        statusEl.className = 'empty';
        statusEl.textContent = 'Open a Policy Studio project to search paths.';
        return;
      }

      if (results.length === 0) {
        statusEl.className = 'empty';
        statusEl.textContent = queryInput.value.trim()
          ? 'No paths match.'
          : 'No service paths found under Environment Configuration/Service.';
      } else {
        statusEl.className = '';
        statusEl.textContent = '';
      }

      for (const result of results) {
        const li = document.createElement('li');
        li.className = 'result';
        li.addEventListener('click', () => {
          vscode.postMessage({ type: 'openResult', index: result.index });
        });

        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = result.uriPrefix;
        const qualifier = result.httpMethod || result.uriMatcher;
        if (qualifier) {
          const span = document.createElement('span');
          span.className = 'qualifier';
          span.textContent = qualifier;
          title.appendChild(span);
        }
        li.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = [result.projectDisplayName, result.interfaceName]
          .filter(Boolean)
          .join(' · ');
        li.appendChild(meta);

        if (result.filterCircuit) {
          const circuit = document.createElement('div');
          circuit.className = 'circuit';
          circuit.textContent = '→ ' + result.filterCircuit;
          li.appendChild(circuit);

          const actions = document.createElement('div');
          actions.className = 'actions';
          const button = document.createElement('button');
          button.className = 'link';
          button.textContent = 'Go to circuit';
          button.addEventListener('click', (event) => {
            event.stopPropagation();
            vscode.postMessage({ type: 'goToCircuit', index: result.index });
          });
          actions.appendChild(button);
          li.appendChild(actions);
        }

        resultsEl.appendChild(li);
      }

      const parts = [
        results.length + ' paths',
        state.projectsScanned + ' projects',
      ];
      if (state.warningCount > 0) {
        parts.push(state.warningCount + ' warnings');
      }
      summaryEl.textContent = parts.join(' · ');
    }

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
