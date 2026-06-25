import * as vscode from 'vscode';
import { jumpToReferencedCircuit, openCircuitSearchResult } from '../circuitSearch/circuitSearchNavigation';
import { searchCircuits } from '../circuitSearch/searchCircuits';
import type { CircuitSearchResponse, CircuitSearchResult } from '../circuitSearch/types';
import { DEFAULT_MAX_RESULTS } from '../circuitSearch/types';
import { getSharedProjectRegistryStore } from '../projectRegistry/projectRegistryService';
import type { ProjectScope } from '../projectRegistry/types';
import type { CircuitSearchViewHost } from './types';

const DEBOUNCE_MS = 300;
const VIEW_TYPE = 'policyStudio.circuitSearch';

interface WebviewSearchResult {
  circuitName: string;
  filterName?: string;
  projectId: string;
  projectDisplayName: string;
  filePath: string;
  matchPreview: string;
  matchKind: string;
  referencedCircuit?: string;
  index: number;
}

export class CircuitSearchViewProvider implements vscode.WebviewViewProvider, CircuitSearchViewHost {
  private view: vscode.WebviewView | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private searchGeneration = 0;
  private lastScopeSnapshot = '';
  private lastResults: CircuitSearchResult[] = [];
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

    webviewView.webview.onDidReceiveMessage((message: { type: string; query?: string; index?: number; projectId?: string; circuitName?: string }) => {
      switch (message.type) {
        case 'ready':
          this.postState({ projectDetected: this.isProjectDetected() });
          if (this.focusPending) {
            this.postMessage({ type: 'focusInput' });
            this.focusPending = false;
          }
          break;
        case 'search':
          this.scheduleSearch(message.query ?? '');
          break;
        case 'openResult':
          if (typeof message.index === 'number') {
            const result = this.lastResults[message.index];
            if (result) {
              void openCircuitSearchResult(result);
            }
          }
          break;
        case 'goToCircuit':
          if (message.projectId && message.circuitName) {
            void jumpToReferencedCircuit(message.projectId, message.circuitName);
          }
          break;
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void vscode.commands.executeCommand('setContext', 'policyStudio.sidebar.focused', true);
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

  notifyScopeChanged(): void {
    const snapshot = this.scopeSnapshot();
    if (snapshot !== this.lastScopeSnapshot && this.lastScopeSnapshot !== '') {
      this.lastResults = [];
      this.postState({
        projectDetected: this.isProjectDetected(),
        scopeChanged: true,
        results: [],
        summary: undefined,
        searching: false,
      });
    }
    this.lastScopeSnapshot = snapshot;
  }

  private scopeSnapshot(): string {
    const store = getSharedProjectRegistryStore();
    const scope = store.getScope();
    return JSON.stringify(scope);
  }

  private isProjectDetected(): boolean {
    return getSharedProjectRegistryStore().getProjectRegistry().projects.length > 0;
  }

  private scheduleSearch(query: string): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.runSearch(query);
    }, DEBOUNCE_MS);
  }

  private async runSearch(query: string): Promise<void> {
    const generation = ++this.searchGeneration;
    const trimmed = query.trim();

    if (!trimmed) {
      this.lastResults = [];
      this.postState({
        projectDetected: this.isProjectDetected(),
        results: [],
        summary: undefined,
        searching: false,
      });
      return;
    }

    const store = getSharedProjectRegistryStore();
    const projects = store.getProjectsInScope();
    if (projects.length === 0) {
      this.postState({
        projectDetected: false,
        results: [],
        summary: undefined,
        searching: false,
      });
      return;
    }

    this.postState({ searching: true, projectDetected: true });

    const maxResults = vscode.workspace
      .getConfiguration()
      .get<number>('policyStudio.circuitSearch.maxResults', DEFAULT_MAX_RESULTS);
    const response: CircuitSearchResponse = await searchCircuits(projects, trimmed, { maxResults });

    if (generation !== this.searchGeneration) {
      return;
    }

    this.lastResults = response.results;
    this.lastScopeSnapshot = this.scopeSnapshot();
    this.postResults(response);
  }

  private postResults(response: CircuitSearchResponse): void {
    const includeProject = getSharedProjectRegistryStore().getProjectsInScope().length > 1;
    const results: WebviewSearchResult[] = response.results.map((result, index) => ({
      index,
      circuitName: result.circuitName,
      filterName: result.filterName,
      projectId: result.projectId,
      projectDisplayName: includeProject ? result.projectDisplayName : '',
      filePath: result.filePath,
      matchPreview: result.matchPreview,
      matchKind: result.matchKind,
      referencedCircuit: result.referencedCircuit,
    }));

    this.postState({
      projectDetected: true,
      results,
      summary: {
        totalMatches: response.summary.totalMatches,
        filesScanned: response.summary.filesScanned,
        filesSkipped: response.summary.filesSkipped,
        durationMs: response.summary.durationMs,
      },
      searching: false,
      scopeChanged: false,
    });
  }

  private postState(state: Record<string, unknown>): void {
    this.postMessage({ type: 'state', ...state });
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
    input {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      border: 1px solid var(--vscode-input-border, transparent);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      margin-bottom: 8px;
    }
    .empty, .scope-changed, .searching {
      opacity: 0.85;
      padding: 8px 4px;
      font-size: 12px;
    }
    .results { list-style: none; padding: 0; margin: 0; }
    .result {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 8px;
      margin-bottom: 6px;
      cursor: pointer;
    }
    .result:hover { background: var(--vscode-list-hoverBackground); }
    .title { font-weight: 600; }
    .meta { font-size: 11px; opacity: 0.85; margin-top: 4px; }
    .preview { font-size: 11px; margin-top: 4px; font-family: var(--vscode-editor-font-family); }
    .actions { margin-top: 6px; }
    button.link {
      background: none;
      border: none;
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      padding: 0;
      font-size: 11px;
    }
    footer {
      margin-top: 8px;
      font-size: 11px;
      opacity: 0.8;
      border-top: 1px solid var(--vscode-panel-border);
      padding-top: 6px;
    }
  </style>
</head>
<body>
  <input id="query" type="search" placeholder="Search circuits, filters, attributes…" />
  <div id="status" class="empty">Open a Policy Studio project to search circuits.</div>
  <ul id="results" class="results"></ul>
  <footer id="summary"></footer>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const queryInput = document.getElementById('query');
    const statusEl = document.getElementById('status');
    const resultsEl = document.getElementById('results');
    const summaryEl = document.getElementById('summary');
    let lastResults = [];

    queryInput.addEventListener('input', () => {
      vscode.postMessage({ type: 'search', query: queryInput.value });
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
      lastResults = state.results || [];

      if (!state.projectDetected) {
        statusEl.className = 'empty';
        statusEl.textContent = 'Open a Policy Studio project to search circuits.';
        return;
      }

      if (state.scopeChanged) {
        statusEl.className = 'scope-changed';
        statusEl.textContent = 'Scope changed — search again.';
        return;
      }

      if (state.searching) {
        statusEl.className = 'searching';
        statusEl.textContent = 'Searching…';
        return;
      }

      if (!queryInput.value.trim()) {
        statusEl.className = 'empty';
        statusEl.textContent = 'Enter a search query.';
        return;
      }

      if (lastResults.length === 0) {
        statusEl.className = 'empty';
        statusEl.textContent = 'No matches found.';
      } else {
        statusEl.textContent = '';
        statusEl.className = '';
      }

      for (const result of lastResults) {
        const li = document.createElement('li');
        li.className = 'result';
        li.addEventListener('click', () => {
          vscode.postMessage({ type: 'openResult', index: result.index });
        });

        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = result.matchKind === 'referencedCircuit'
          ? (result.referencedCircuit || result.circuitName)
          : result.circuitName;
        li.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = [
          result.projectDisplayName,
          result.filterName,
          result.filePath,
          result.matchKind,
        ].filter(Boolean).join(' · ');
        li.appendChild(meta);

        const preview = document.createElement('div');
        preview.className = 'preview';
        preview.textContent = result.matchPreview;
        li.appendChild(preview);

        if (result.matchKind === 'referencedCircuit' && result.referencedCircuit) {
          const actions = document.createElement('div');
          actions.className = 'actions';
          const btn = document.createElement('button');
          btn.className = 'link';
          btn.textContent = 'Go to circuit';
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({
              type: 'goToCircuit',
              projectId: result.projectId,
              circuitName: result.referencedCircuit,
            });
          });
          actions.appendChild(btn);
          li.appendChild(actions);
        }

        resultsEl.appendChild(li);
      }

      if (state.summary) {
        const parts = [
          state.summary.totalMatches + ' match(es)',
          state.summary.filesScanned + ' file(s) scanned',
        ];
        if (state.summary.filesSkipped > 0) {
          parts.push(state.summary.filesSkipped + ' skipped (invalid XML)');
        }
        parts.push(state.summary.durationMs + 'ms');
        summaryEl.textContent = parts.join(' · ');
      }
    }

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
