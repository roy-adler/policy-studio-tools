import * as crypto from 'crypto';
import type { EnvScalar, EnvTreeNode, EnvValuesModel } from './types';

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

function getStyles(): string {
  return `<style>
    :root {
      --env-ok-color: var(--vscode-charts-green, #2ea043);
      --env-missing-color: var(--vscode-charts-orange, #bf8700);
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
    #tree {
      flex: 0 0 38%;
      max-width: 38%;
      overflow: auto;
      border-right: 1px solid var(--vscode-panel-border);
      padding: 8px;
    }
    #detail {
      flex: 1;
      overflow: auto;
      padding: 12px 16px;
    }
    ul.tree, ul.tree ul { list-style: none; margin: 0; padding-left: 14px; }
    ul.tree { padding-left: 0; }
    li.branch > details > summary { cursor: pointer; padding: 2px 0; font-weight: 500; }
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

function renderTree(nodes: EnvTreeNode[], selectedPath?: string): string {
  return `<ul class="tree">${nodes.map((node) => renderNode(node, selectedPath)).join('')}</ul>`;
}

function renderNode(node: EnvTreeNode, selectedPath?: string): string {
  if (!node.children) {
    const classes = ['leaf', leafStatusClass(node)];
    if (node.path === selectedPath) {
      classes.push('selected');
    }
    return `<li class="${classes.join(' ')}" data-path="${escapeHtml(node.path)}">${escapeHtml(node.name)}</li>`;
  }

  const open = isAncestorOfSelection(node, selectedPath) ? ' open' : '';
  return `<li class="branch">
    <details${open}>
      <summary>${escapeHtml(node.name)}</summary>
      ${renderTree(node.children, selectedPath)}
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

function renderDetail(model: EnvValuesModel, selectedPath?: string): string {
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

export function renderEnvValuesEditorHtml(
  model: EnvValuesModel,
  selectedPath?: string,
  envLabel?: string,
): string {
  const nonce = createNonce();
  const dirtyCount = Object.values(model.documents).filter((document) => document.dirty).length;
  const modelJson = JSON.stringify(model).replace(/</g, '\\u003c');
  const bodyHtml =
    model.stages.length === 0
      ? renderEmptyState(model.envRoot)
      : `<div id="tree">${renderTree(model.tree, selectedPath)}</div>
    <div id="detail">${renderDetail(model, selectedPath)}</div>`;

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
    const vscode = acquireVsCodeApi();

    document.querySelectorAll('#tree .leaf').forEach((el) => {
      el.addEventListener('click', () => {
        vscode.postMessage({ type: 'select', path: el.dataset.path });
      });
    });

    document.querySelectorAll('.value-input').forEach((el) => {
      el.addEventListener('change', () => {
        vscode.postMessage({
          type: 'setValue',
          path: el.dataset.path,
          stageId: el.dataset.stage,
          value: el.value,
        });
      });
    });

    function collectListValues(editor) {
      return Array.from(editor.querySelectorAll('.list-item-input')).map((input) => input.value);
    }

    function postList(path, stageId, values) {
      vscode.postMessage({ type: 'setList', path, stageId, values });
    }

    document.querySelectorAll('.list-item-input').forEach((el) => {
      el.addEventListener('change', () => {
        const editor = el.closest('.list-editor');
        postList(editor.dataset.path, editor.dataset.stage, collectListValues(editor));
      });
    });

    document.querySelectorAll('.list-remove').forEach((el) => {
      el.addEventListener('click', () => {
        const editor = el.closest('.list-editor');
        const index = Number(el.dataset.index);
        const values = collectListValues(editor);
        values.splice(index, 1);
        postList(editor.dataset.path, editor.dataset.stage, values);
      });
    });

    document.querySelectorAll('.list-add').forEach((el) => {
      el.addEventListener('click', () => {
        const editor = el.closest('.list-editor');
        const values = collectListValues(editor);
        values.push('');
        postList(editor.dataset.path, editor.dataset.stage, values);
      });
    });

    document.querySelectorAll('.create-missing').forEach((el) => {
      el.addEventListener('click', () => {
        vscode.postMessage({
          type: 'createMissing',
          path: el.dataset.path,
          stageId: el.dataset.stage,
        });
      });
    });

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
