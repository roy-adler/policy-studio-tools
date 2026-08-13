import * as crypto from 'crypto';
import type { KpsSession, KpsStageTable } from './types';
import { isSessionDirty } from './kpsTableMutations';

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

function scalarToInputValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

function countDirty(session: KpsSession): number {
  let count = 0;
  for (const table of Object.values(session.tables)) {
    for (const stage of Object.values(table.stages)) {
      if (stage.dirty) {
        count += 1;
      }
    }
  }
  return count;
}

function getStyles(): string {
  return `<style>
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
    .toolbar button, .tabs button, .row-actions button, #addRow, #createMissing {
      background: var(--vscode-button-secondaryBackground, transparent);
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
      padding: 3px 10px;
      cursor: pointer;
      font-size: 12px;
    }
    .toolbar button:hover, .tabs button:hover { border-color: var(--vscode-focusBorder); }
    .banner {
      flex: none;
      padding: 6px 12px;
      font-size: 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-inputValidation-warningBackground, #fff3cd);
    }
    .banner.error {
      background: var(--vscode-inputValidation-errorBackground, #f8d7da);
    }
    #main {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      padding: 8px 12px 12px;
      gap: 8px;
    }
    .tabs {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      align-items: center;
    }
    .tabs .label {
      opacity: 0.7;
      font-size: 11px;
      margin-right: 4px;
    }
    .tabs button.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
    }
    .tabs button.missing { border-style: dashed; }
    .grid-wrap {
      flex: 1;
      overflow: auto;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
    }
    table.grid {
      border-collapse: collapse;
      width: 100%;
      font-size: 12px;
    }
    table.grid th, table.grid td {
      border-bottom: 1px solid var(--vscode-panel-border);
      padding: 4px 6px;
      text-align: left;
      vertical-align: middle;
    }
    table.grid th {
      position: sticky;
      top: 0;
      background: var(--vscode-editor-background);
      z-index: 1;
    }
    table.grid input {
      width: 100%;
      min-width: 80px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 3px;
      padding: 3px 6px;
      font-size: 12px;
    }
    table.grid th.unexpected {
      color: var(--vscode-charts-orange, #bf8700);
    }
    table.grid td.warn input {
      border-color: var(--vscode-charts-orange, #bf8700);
    }
    .footer-actions { display: flex; gap: 8px; align-items: center; }
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
  </style>`;
}

function renderStageBody(
  stage: KpsStageTable,
  table: { columns: string[]; schemaColumns: string[] },
  tableName: string,
  stageId: string,
): string {
  if (stage.status === 'missing') {
    return `<div class="empty-state">
      <h2>Missing in ${escapeHtml(stageId)}</h2>
      <p><code>${escapeHtml(tableName)}</code> is not present in this stage. The Type Group still defines the columns; create the file to edit rows.</p>
      <button id="createMissing" data-table="${escapeHtml(tableName)}" data-stage="${escapeHtml(stageId)}">Create missing</button>
    </div>`;
  }

  if (stage.status === 'error') {
    return `<div class="empty-state">
      <h2>Invalid JSON in ${escapeHtml(stageId)}</h2>
      <p>${escapeHtml(stage.parseError ?? 'Parse error')}</p>
    </div>`;
  }

  const schemaSet = new Set(table.schemaColumns);
  const header =
    table.columns
      .map((column) => {
        const unexpected = schemaSet.size > 0 && !schemaSet.has(column);
        const cls = unexpected ? ' class="unexpected"' : '';
        const title = unexpected ? ' title="Not in Type Group"' : '';
        return `<th${cls}${title}>${escapeHtml(column)}</th>`;
      })
      .join('') + '<th></th>';
  const rows = stage.rows
    .map((row, rowIndex) => {
      const cells = table.columns
        .map((column) => {
          const cell = row.cells[column];
          if (!cell || !cell.editable) {
            const preview =
              cell?.nested !== undefined
                ? JSON.stringify(cell.nested)
                : scalarToInputValue(cell?.value);
            return `<td class="locked" title="${escapeHtml(cell?.warning ?? 'Non-editable')}">${escapeHtml(preview)}</td>`;
          }
          const warnClass = cell.warning ? ' class="warn"' : '';
          const title = cell.warning ? ` title="${escapeHtml(cell.warning)}"` : '';
          return `<td${warnClass}${title}><input data-row="${rowIndex}" data-column="${escapeHtml(column)}" value="${escapeHtml(scalarToInputValue(cell.value))}" /></td>`;
        })
        .join('');
      return `<tr>${cells}<td class="row-actions"><button class="remove-row" data-row="${rowIndex}">−</button></td></tr>`;
    })
    .join('');

  return `<div class="grid-wrap">
    <table class="grid">
      <thead><tr>${header}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div class="footer-actions">
    <button id="addRow">+ Add row</button>
  </div>`;
}

export function getKpsPanelShellHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${getStyles()}
</head>
<body>
  <header>
    <span class="title">KPS editor</span>
    <div class="toolbar">
      <button id="save">Save</button>
      <button id="reload">Reload</button>
      <button id="switchKps">Switch KPS…</button>
      <button id="pickKps">Open KPS folder…</button>
    </div>
  </header>
  <div id="main"><p>Loading…</p></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

export function renderKpsEditorHtml(
  session: KpsSession,
  options: {
    cspSource: string;
    tableName?: string;
    stageId?: string;
    kpsLabel?: string;
    nonce?: string;
  },
): string {
  const nonce = options.nonce ?? createNonce();
  void options.cspSource;

  if (session.stageIds.length === 0 || session.tableNames.length === 0) {
    const title = options.kpsLabel
      ? `KPS — ${escapeHtml(options.kpsLabel)}`
      : 'KPS editor';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  ${getStyles()}
</head>
<body>
  <header>
    <span class="title">${title}</span>
    <div class="toolbar">
      <button id="save">Save</button>
      <button id="reload">Reload</button>
      <button id="switchKps">Switch KPS…</button>
      <button id="pickKps">Open KPS folder…</button>
    </div>
  </header>
  <div class="empty-state">
    <h2>No KPS stages found</h2>
    <p>Expected layout:</p>
    <pre>KPS/
  DEVL/*.json
  TEST/*.json</pre>
    <p>Root: <code>${escapeHtml(session.kpsRoot)}</code></p>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('switchKps')?.addEventListener('click', () => vscode.postMessage({ type: 'switchKps' }));
    document.getElementById('pickKps')?.addEventListener('click', () => vscode.postMessage({ type: 'pickKps' }));
    document.getElementById('reload')?.addEventListener('click', () => vscode.postMessage({ type: 'reload' }));
    document.getElementById('save')?.addEventListener('click', () => vscode.postMessage({ type: 'save' }));
  </script>
</body>
</html>`;
  }

  const tableName =
    options.tableName && session.tables[options.tableName]
      ? options.tableName
      : session.tableNames[0];
  const table = session.tables[tableName];
  const stageId =
    options.stageId && table.stages[options.stageId]
      ? options.stageId
      : session.stageIds.find((id) => table.stages[id]?.status === 'present') ??
        session.stageIds[0];
  const stage = table.stages[stageId];
  const dirtyCount = countDirty(session);
  const title = options.kpsLabel
    ? `KPS — ${escapeHtml(options.kpsLabel)}`
    : 'KPS editor';

  const tableTabs = session.tableNames
    .map((name) => {
      const active = name === tableName ? ' active' : '';
      const label = name.replace(/\.json$/i, '');
      return `<button class="table-tab${active}" data-table="${escapeHtml(name)}">${escapeHtml(label)}</button>`;
    })
    .join('');

  const stageTabs = session.stageIds
    .map((id) => {
      const st = table.stages[id];
      const active = id === stageId ? ' active' : '';
      const missing = st?.status === 'missing' ? ' missing' : '';
      return `<button class="stage-tab${active}${missing}" data-stage="${escapeHtml(id)}">${escapeHtml(id)}</button>`;
    })
    .join('');

  const banners: string[] = [];
  if (isSessionDirty(session)) {
    banners.push(`<div class="banner">${dirtyCount} dirty stage file(s)</div>`);
  }
  if (session.editWarning) {
    banners.push(`<div class="banner">${escapeHtml(session.editWarning)}</div>`);
  }
  for (const warning of session.warnings) {
    if (warning.includes(tableName)) {
      banners.push(`<div class="banner">${escapeHtml(warning)}</div>`);
    }
  }
  if (stage.status === 'error') {
    banners.push(`<div class="banner error">${escapeHtml(stage.parseError ?? 'Parse error')}</div>`);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${getStyles()}
</head>
<body>
  <header>
    <span class="title">${title}</span>
    <div class="toolbar">
      <button id="save">Save${dirtyCount > 0 ? ` (${dirtyCount})` : ''}</button>
      <button id="reload">Reload</button>
      <button id="switchKps">Switch KPS…</button>
      <button id="pickKps">Open KPS folder…</button>
    </div>
  </header>
  ${banners.join('')}
  <div id="main">
    <div class="tabs"><span class="label">Tables</span>${tableTabs}</div>
    <div class="tabs"><span class="label">Stages</span>${stageTabs}</div>
    ${renderStageBody(stage, table, tableName, stageId)}
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const tableName = ${JSON.stringify(tableName)};
    const stageId = ${JSON.stringify(stageId)};

    document.getElementById('save')?.addEventListener('click', () => vscode.postMessage({ type: 'save' }));
    document.getElementById('reload')?.addEventListener('click', () => vscode.postMessage({ type: 'reload' }));
    document.getElementById('switchKps')?.addEventListener('click', () => vscode.postMessage({ type: 'switchKps' }));
    document.getElementById('pickKps')?.addEventListener('click', () => vscode.postMessage({ type: 'pickKps' }));
    document.getElementById('addRow')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'addRow', tableName, stageId });
    });
    document.getElementById('createMissing')?.addEventListener('click', (event) => {
      const button = event.currentTarget;
      vscode.postMessage({
        type: 'createMissing',
        tableName: button.getAttribute('data-table'),
        stageId: button.getAttribute('data-stage'),
      });
    });
    document.querySelectorAll('.table-tab').forEach((button) => {
      button.addEventListener('click', () => {
        vscode.postMessage({ type: 'selectTable', tableName: button.getAttribute('data-table') });
      });
    });
    document.querySelectorAll('.stage-tab').forEach((button) => {
      button.addEventListener('click', () => {
        vscode.postMessage({ type: 'selectStage', stageId: button.getAttribute('data-stage') });
      });
    });
    document.querySelectorAll('.remove-row').forEach((button) => {
      button.addEventListener('click', () => {
        const rowIndex = Number(button.getAttribute('data-row'));
        vscode.postMessage({ type: 'removeRow', tableName, stageId, rowIndex });
      });
    });
    document.querySelectorAll('table.grid input').forEach((input) => {
      input.addEventListener('change', () => {
        vscode.postMessage({
          type: 'setCell',
          tableName,
          stageId,
          rowIndex: Number(input.getAttribute('data-row')),
          column: input.getAttribute('data-column'),
          value: input.value,
        });
      });
    });
  </script>
</body>
</html>`;
}
