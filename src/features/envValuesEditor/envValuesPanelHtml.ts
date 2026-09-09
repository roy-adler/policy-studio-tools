import * as crypto from 'crypto';
import type { EnvScalar, EnvTreeNode, EnvValuesModel } from './types';
import {
  nodeOrDescendantHasMissing,
  resolveExpandedPaths,
} from './envTreeView';

function createNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface EnvValuesPanelViewState {
  expandedPaths?: Iterable<string>;
  searchQuery?: string;
  treeScrollTop?: number;
}

function getStyles(): string {
  return `<style>
    :root {
      --env-ok-color: var(--vscode-charts-green, #2ea043);
      --env-missing-color: #c9a227;
      --env-missing-bg: rgba(201, 162, 39, 0.28);
      --env-conflict-color: var(--vscode-charts-red, #d1242f);
    }
    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    header {
      flex: none;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    header .title { font-weight: 600; }
    .toolbar { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; }
    .toolbar button {
      background: var(--vscode-button-secondaryBackground, transparent);
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
      padding: 3px 10px;
      cursor: pointer;
      font-size: 12px;
    }
    .toolbar button:hover { border-color: var(--vscode-focusBorder); }
    .banner {
      flex: none;
      padding: 6px 12px;
      font-size: 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .banner.error {
      background: var(--vscode-inputValidation-errorBackground, #f8d7da);
      color: var(--vscode-inputValidation-errorForeground, inherit);
    }
    .banner.warning {
      background: var(--vscode-inputValidation-warningBackground, #fff3cd);
      color: var(--vscode-inputValidation-warningForeground, inherit);
    }
    #body {
      flex: 1;
      display: flex;
      min-height: 0;
    }
    #tree-pane {
      flex: 0 0 38%;
      max-width: 38%;
      display: flex;
      flex-direction: column;
      min-height: 0;
      border-right: 1px solid var(--vscode-panel-border);
    }
    .tree-search-wrap {
      flex: none;
      padding: 8px 8px 4px;
    }
    #tree-search {
      width: 100%;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 3px;
      padding: 4px 8px;
      font-size: 12px;
    }
    #tree {
      flex: 1;
      overflow: auto;
      padding: 4px 8px 8px;
    }
    #detail {
      flex: 1;
      overflow: auto;
      padding: 12px 16px;
    }
    ul.tree, ul.tree ul { list-style: none; margin: 0; padding-left: 14px; }
    ul.tree { padding-left: 0; }
    li.branch > details > summary {
      cursor: pointer;
      padding: 2px 6px;
      font-weight: 500;
      border-radius: 3px;
    }
    li.branch > details > summary.missing-highlight {
      background: var(--env-missing-bg);
      color: var(--vscode-foreground);
    }
    li.leaf {
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 3px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    li.leaf:hover { background: var(--vscode-list-hoverBackground); }
    li.leaf.selected {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }
    li.leaf.missing-highlight:not(.selected) {
      background: var(--env-missing-bg);
    }
    li.leaf.selected.missing-highlight {
      box-shadow: inset 3px 0 0 var(--env-missing-color);
    }
    li.leaf::before {
      content: '';
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--env-ok-color);
      flex: none;
    }
    li.leaf.status-missing::before { background: var(--env-missing-color); }
    li.leaf.status-conflict::before { background: var(--env-conflict-color); }
    li.tree-hidden, .tree-empty-filter { display: none; }
    .tree-empty-filter.visible { display: block; }
    .placeholder { opacity: 0.7; font-size: 12px; }
    h2 { font-size: 14px; margin: 0 0 4px; word-break: break-all; }
    .stage-rows { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
    .stage-row { display: flex; align-items: center; gap: 10px; }
    .stage-row.list-stage { align-items: flex-start; }
    .stage-label { flex: 0 0 80px; font-weight: 600; }
    .stage-row.list-stage .stage-label { padding-top: 6px; }
    .stage-value { flex: 1; display: flex; align-items: center; gap: 8px; }
    .stage-value input {
      flex: 1;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 3px;
      padding: 4px 8px;
      font-size: 12px;
    }
    .stage-value.missing { color: var(--env-missing-color); }
    .stage-value.conflict, .stage-value.error { color: var(--env-conflict-color); font-size: 12px; }
    .stage-value button {
      background: var(--vscode-button-secondaryBackground, transparent);
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
      padding: 2px 8px;
      cursor: pointer;
      font-size: 11px;
    }
    .list-editor {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }
    .list-item-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .list-item-row .list-item-input { flex: 1; min-width: 0; }
    .list-item-row .list-remove,
    .list-editor .list-add {
      flex: none;
      min-width: 28px;
      padding: 2px 0;
      font-size: 14px;
      line-height: 1.2;
    }
    .list-editor .list-add { align-self: flex-start; }
    .empty-state {
      max-width: 520px;
      margin: 32px auto;
      padding: 0 16px;
    }
    .empty-state h2 { font-size: 15px; margin-bottom: 8px; }
    .empty-state p { line-height: 1.5; }
    .empty-state pre {
      background: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.1));
      border-radius: 4px;
      padding: 8px 12px;
      overflow: auto;
    }
    .empty-state code {
      background: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.1));
      border-radius: 3px;
      padding: 1px 4px;
    }
  </style>`;
}

function getToolbarHtml(dirtyCount: number, envLabel?: string): string {
  const title = envLabel
    ? `ENV values — ${escapeHtml(envLabel)}`
    : 'ENV values editor';
  return `<header>
    <span class="title">${title}</span>
    <div class="toolbar">
      <button id="save">Save${dirtyCount > 0 ? ` (${dirtyCount})` : ''}</button>
      <button id="reload">Reload</button>
      <button id="addKey">Add key</button>
      <button id="removeKey">Remove key</button>
      <button id="switchEnv">Switch ENV…</button>
      <button id="pickEnv">Open ENV folder…</button>
    </div>
  </header>`;
}

export function getEnvValuesPanelShellHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${getStyles()}
</head>
<body>
  ${getToolbarHtml(0)}
  <div id="body">
    <div id="tree"><p class="placeholder">Loading…</p></div>
    <div id="detail"><p class="placeholder">Loading…</p></div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

function leafStatusClass(node: EnvTreeNode): string {
  const cells = Object.values(node.cells ?? {});
  if (cells.some((cell) => cell.kind === 'conflict')) {
    return 'status-conflict';
  }
  if (cells.some((cell) => cell.kind === 'missing')) {
    return 'status-missing';
  }
  return 'status-ok';
}

function isAncestorOfSelection(node: EnvTreeNode, selectedPath?: string): boolean {
  if (!selectedPath) {
    return false;
  }
  return selectedPath === node.path || selectedPath.startsWith(`${node.path}.`);
}

function renderTree(
  nodes: EnvTreeNode[],
  selectedPath: string | undefined,
  expanded: Set<string>,
): string {
  return `<ul class="tree">${nodes.map((node) => renderNode(node, selectedPath, expanded)).join('')}</ul>`;
}

function leafSearchText(node: EnvTreeNode): string {
  const parts = [node.path, node.name];
  for (const cell of Object.values(node.cells ?? {})) {
    if (cell.kind === 'value') {
      parts.push(String(cell.value ?? ''));
    } else if (cell.kind === 'list') {
      for (const entry of cell.values) {
        parts.push(String(entry ?? ''));
      }
    }
  }
  return parts.join(' ').toLowerCase();
}

function renderNode(
  node: EnvTreeNode,
  selectedPath: string | undefined,
  expanded: Set<string>,
): string {
  const missing = nodeOrDescendantHasMissing(node);

  if (!node.children) {
    const classes = ['leaf', leafStatusClass(node)];
    if (node.path === selectedPath) {
      classes.push('selected');
    }
    if (missing) {
      classes.push('missing-highlight');
    }
    return `<li class="${classes.join(' ')}" data-path="${escapeHtml(node.path)}" data-search="${escapeHtml(leafSearchText(node))}">${escapeHtml(node.name)}</li>`;
  }

  const open =
    expanded.has(node.path) || isAncestorOfSelection(node, selectedPath) ? ' open' : '';
  const summaryClass = missing ? ' class="missing-highlight"' : '';
  return `<li class="branch">
    <details data-path="${escapeHtml(node.path)}"${open}>
      <summary${summaryClass}>${escapeHtml(node.name)}</summary>
      ${renderTree(node.children, selectedPath, expanded)}
    </details>
  </li>`;
}

function findNode(nodes: EnvTreeNode[], targetPath: string): EnvTreeNode | undefined {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return node;
    }
    if (node.children) {
      const found = findNode(node.children, targetPath);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

function formatScalar(value: EnvScalar): string {
  return value === null || value === undefined ? '' : String(value);
}

export function renderEnvValuesDetailHtml(
  model: EnvValuesModel,
  selectedPath?: string,
): string {
  if (!selectedPath) {
    return `<p class="placeholder">Select a key from the tree to view and edit its values.</p>`;
  }

  const node = findNode(model.tree, selectedPath);
  if (!node || !node.cells) {
    return `<p class="placeholder">Select a key from the tree to view and edit its values.</p>`;
  }

  const rows = model.stages.map((stage) => {
    const document = model.documents[stage.id];
    if (document?.parseError) {
      return `<div class="stage-row">
        <div class="stage-label">${escapeHtml(stage.id)}</div>
        <div class="stage-value error">Parse error: ${escapeHtml(document.parseError)}</div>
      </div>`;
    }

    const cell = node.cells?.[stage.id];
    if (!cell || cell.kind === 'missing') {
      return `<div class="stage-row">
        <div class="stage-label">${escapeHtml(stage.id)}</div>
        <div class="stage-value missing">
          <span>Missing</span>
          <button class="create-missing" data-path="${escapeHtml(selectedPath)}" data-stage="${escapeHtml(stage.id)}">Create missing</button>
        </div>
      </div>`;
    }

    if (cell.kind === 'conflict') {
      return `<div class="stage-row">
        <div class="stage-label">${escapeHtml(stage.id)}</div>
        <div class="stage-value conflict">${escapeHtml(cell.detail)}</div>
      </div>`;
    }

    if (cell.kind === 'list') {
      const items =
        cell.values.length === 0
          ? ''
          : cell.values
              .map(
                (entry, index) => `<div class="list-item-row">
            <input type="text" class="list-item-input" data-path="${escapeHtml(selectedPath)}" data-stage="${escapeHtml(stage.id)}" data-index="${index}" value="${escapeHtml(formatScalar(entry))}" />
            <button type="button" class="list-remove" data-path="${escapeHtml(selectedPath)}" data-stage="${escapeHtml(stage.id)}" data-index="${index}" title="Remove item">−</button>
          </div>`,
              )
              .join('');
      return `<div class="stage-row list-stage">
        <div class="stage-label">${escapeHtml(stage.id)}</div>
        <div class="stage-value">
          <div class="list-editor" data-path="${escapeHtml(selectedPath)}" data-stage="${escapeHtml(stage.id)}">
            ${items}
            <button type="button" class="list-add" data-path="${escapeHtml(selectedPath)}" data-stage="${escapeHtml(stage.id)}" title="Add item">+</button>
          </div>
        </div>
      </div>`;
    }

    return `<div class="stage-row">
      <div class="stage-label">${escapeHtml(stage.id)}</div>
      <div class="stage-value">
        <input type="text" class="value-input" data-path="${escapeHtml(selectedPath)}" data-stage="${escapeHtml(stage.id)}" value="${escapeHtml(formatScalar(cell.value))}" />
      </div>
    </div>`;
  });

  return `<h2>${escapeHtml(selectedPath)}</h2><div class="stage-rows">${rows.join('')}</div>`;
}

function renderEmptyState(envRoot: string): string {
  return `<div class="empty-state">
    <h2>No ENV stages found</h2>
    <p>This editor expects an ENV folder laid out with one subfolder per stage,
    each containing a <code>values.yaml</code> file:</p>
    <pre>ENV/
  &lt;stage&gt;/
    values.yaml</pre>
    <p>No stage folders with a <code>values.yaml</code> file were found under
    <code>${escapeHtml(envRoot)}</code>. Use "Open ENV folder…" above to point this
    editor at a different ENV directory.</p>
  </div>`;
}

function renderBanner(model: EnvValuesModel): string {
  const parseErrors = Object.values(model.documents)
    .filter((document) => document.parseError)
    .map((document) => `${document.stageId}: ${document.parseError}`);

  const parts: string[] = [];
  if (parseErrors.length > 0) {
    parts.push(`<div class="banner error">${escapeHtml(parseErrors.join(' · '))}</div>`);
  }
  if (model.warnings.length > 0) {
    const preview = model.warnings.slice(0, 3).join(' · ');
    const suffix = model.warnings.length > 3 ? '…' : '';
    parts.push(
      `<div class="banner warning">${model.warnings.length} warning(s): ${escapeHtml(preview)}${suffix}</div>`,
    );
  }
  return parts.join('');
}

function ancestorsOfPath(path: string): string[] {
  const parts = path.split('.');
  const ancestors: string[] = [];
  for (let index = 1; index < parts.length; index++) {
    ancestors.push(parts.slice(0, index).join('.'));
  }
  return ancestors;
}

export function renderEnvValuesEditorHtml(
  model: EnvValuesModel,
  selectedPath?: string,
  envLabel?: string,
  viewState: EnvValuesPanelViewState = {},
): string {
  const nonce = createNonce();
  const dirtyCount = Object.values(model.documents).filter((document) => document.dirty).length;
  const searchQuery = viewState.searchQuery ?? '';

  // Always render the full tree. Search filtering runs in the webview so typing
  // does not replace the whole document (which caused flicker / lost focus).
  const userExpanded = new Set(viewState.expandedPaths ?? []);
  if (selectedPath) {
    for (const ancestor of ancestorsOfPath(selectedPath)) {
      userExpanded.add(ancestor);
    }
  }

  const expanded = resolveExpandedPaths(model.tree, userExpanded);
  const modelJson = JSON.stringify(model).replace(/</g, '\\u003c');
  const restoreTreeScroll =
    typeof viewState.treeScrollTop === 'number' && Number.isFinite(viewState.treeScrollTop)
      ? `const tree = document.getElementById('tree');
    if (tree) {
      tree.scrollTop = ${Math.max(0, Math.trunc(viewState.treeScrollTop))};
    }`
      : '';
  const bodyHtml =
    model.stages.length === 0
      ? renderEmptyState(model.envRoot)
      : `<div id="tree-pane">
      <div class="tree-search-wrap">
        <input id="tree-search" type="search" placeholder="Search keys or values…" value="${escapeHtml(searchQuery)}" />
      </div>
      <div id="tree">
        <p class="placeholder tree-empty-filter">No keys match the current search.</p>
        ${renderTree(model.tree, selectedPath, expanded)}
      </div>
    </div>
    <div id="detail">${renderEnvValuesDetailHtml(model, selectedPath)}</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${getStyles()}
</head>
<body>
  ${getToolbarHtml(dirtyCount, envLabel)}
  ${renderBanner(model)}
  <div id="body">
    ${bodyHtml}
  </div>
  <script type="application/json" id="model">${modelJson}</script>
  <script nonce="${nonce}">
    const vscodeApi = acquireVsCodeApi();
    function treeScrollTop() {
      const treeEl = document.getElementById('tree');
      return treeEl ? treeEl.scrollTop : 0;
    }
    const vscode = {
      postMessage(message) {
        vscodeApi.postMessage(Object.assign({}, message, { treeScrollTop: treeScrollTop() }));
      },
    };
    ${restoreTreeScroll}

    function autoExpandSingletons(detailsEl) {
      let current = detailsEl;
      while (current) {
        const tree = Array.from(current.children).find(
          (child) => child.tagName === 'UL' && child.classList.contains('tree'),
        );
        if (!tree) {
          break;
        }
        const items = Array.from(tree.children).filter(
          (child) => child.tagName === 'LI' && !child.classList.contains('tree-hidden'),
        );
        const branches = items.filter((child) => child.classList.contains('branch'));
        const leaves = items.filter((child) => child.classList.contains('leaf'));
        if (branches.length === 1 && leaves.length === 0) {
          const childDetails = branches[0].querySelector('details');
          if (childDetails && !childDetails.open) {
            childDetails.open = true;
            current = childDetails;
            continue;
          }
        }
        break;
      }
    }

    function applyTreeFilter(query) {
      const needle = (query || '').trim().toLowerCase();
      const root = document.getElementById('tree');
      if (!root) {
        return;
      }
      const empty = root.querySelector('.tree-empty-filter');
      const leaves = Array.from(root.querySelectorAll('li.leaf'));
      let visibleLeaves = 0;

      leaves.forEach((leaf) => {
        const haystack = leaf.getAttribute('data-search') || '';
        const match = !needle || haystack.indexOf(needle) !== -1;
        leaf.classList.toggle('tree-hidden', !match);
        if (match) {
          visibleLeaves += 1;
        }
      });

      Array.from(root.querySelectorAll('li.branch')).reverse().forEach((branch) => {
        const hasVisible = !!branch.querySelector('li.leaf:not(.tree-hidden)');
        branch.classList.toggle('tree-hidden', !hasVisible);
        if (hasVisible && needle) {
          const details = branch.querySelector('details');
          if (details) {
            details.open = true;
          }
        }
      });

      if (empty) {
        empty.classList.toggle('visible', !!needle && visibleLeaves === 0);
      }
    }

    function applySelectedLeaf(path) {
      document.querySelectorAll('#tree .leaf').forEach((leaf) => {
        leaf.classList.toggle('selected', leaf.dataset.path === path);
      });
    }

    function applyDetailHtml(html) {
      const detail = document.getElementById('detail');
      if (detail) {
        detail.innerHTML = html;
      }
    }

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || message.type !== 'showDetail') {
        return;
      }
      if (message.path) {
        applySelectedLeaf(message.path);
      }
      if (typeof message.html === 'string') {
        applyDetailHtml(message.html);
      }
    });

    document.querySelectorAll('#tree .leaf').forEach((el) => {
      el.addEventListener('click', () => {
        applySelectedLeaf(el.dataset.path);
        vscode.postMessage({ type: 'select', path: el.dataset.path });
      });
    });

    document.querySelectorAll('#tree details').forEach((el) => {
      el.addEventListener('toggle', () => {
        if (el.open) {
          autoExpandSingletons(el);
        }
        // Persist expand state only — do not ask the host to re-render.
        vscode.postMessage({
          type: 'toggleExpand',
          path: el.dataset.path,
          expanded: el.open,
        });
      });
    });

    const search = document.getElementById('tree-search');
    if (search) {
      applyTreeFilter(search.value);
      let timer = undefined;
      search.addEventListener('input', () => {
        applyTreeFilter(search.value);
        clearTimeout(timer);
        timer = setTimeout(() => {
          vscode.postMessage({ type: 'search', query: search.value });
        }, 150);
      });
    }

    function collectListValues(editor) {
      return Array.from(editor.querySelectorAll('.list-item-input')).map((input) => input.value);
    }

    function postList(path, stageId, values) {
      vscode.postMessage({ type: 'setList', path, stageId, values });
    }

    const detailPane = document.getElementById('detail');
    if (detailPane) {
      detailPane.addEventListener('change', (event) => {
        const el = event.target;
        if (!(el instanceof HTMLInputElement)) {
          return;
        }
        if (el.classList.contains('value-input')) {
          vscode.postMessage({
            type: 'setValue',
            path: el.dataset.path,
            stageId: el.dataset.stage,
            value: el.value,
          });
          return;
        }
        if (el.classList.contains('list-item-input')) {
          const editor = el.closest('.list-editor');
          if (editor) {
            postList(editor.dataset.path, editor.dataset.stage, collectListValues(editor));
          }
        }
      });

      detailPane.addEventListener('click', (event) => {
        const el = event.target;
        if (!(el instanceof HTMLElement)) {
          return;
        }
        if (el.classList.contains('list-remove')) {
          const editor = el.closest('.list-editor');
          if (!editor) {
            return;
          }
          const index = Number(el.dataset.index);
          const values = collectListValues(editor);
          values.splice(index, 1);
          postList(editor.dataset.path, editor.dataset.stage, values);
          return;
        }
        if (el.classList.contains('list-add')) {
          const editor = el.closest('.list-editor');
          if (!editor) {
            return;
          }
          const values = collectListValues(editor);
          values.push('');
          postList(editor.dataset.path, editor.dataset.stage, values);
          return;
        }
        if (el.classList.contains('create-missing')) {
          vscode.postMessage({
            type: 'createMissing',
            path: el.dataset.path,
            stageId: el.dataset.stage,
          });
        }
      });
    }

    document.getElementById('save').addEventListener('click', () => {
      vscode.postMessage({ type: 'save' });
    });
    document.getElementById('reload').addEventListener('click', () => {
      vscode.postMessage({ type: 'reload' });
    });
    document.getElementById('addKey').addEventListener('click', () => {
      vscode.postMessage({ type: 'addKey' });
    });
    document.getElementById('removeKey').addEventListener('click', () => {
      vscode.postMessage({ type: 'removeKey' });
    });
    document.getElementById('switchEnv').addEventListener('click', () => {
      vscode.postMessage({ type: 'switchEnv' });
    });
    document.getElementById('pickEnv').addEventListener('click', () => {
      vscode.postMessage({ type: 'pickEnv' });
    });
  </script>
</body>
</html>`;
}
