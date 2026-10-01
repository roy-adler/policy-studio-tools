import * as crypto from 'crypto';
import {
  defaultStageTarget,
  findStageGroups,
  resolveStageTarget,
  type KpsStageTarget,
} from './kpsStageGroups';
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
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
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

export interface KpsCellPatch {
  bannersHtml: string;
  saveLabel: string;
  stageTabsHtml: string;
  target: KpsStageTarget;
  gridStageId: string;
  openJsonDisabled: boolean;
  cell: {
    rowIndex: number;
    column: string;
    value: string;
    warning?: string;
  } | null;
}

function renderBanners(session: KpsSession, tableName: string, stage: KpsStageTable): string {
  const banners: string[] = [];
  const dirtyCount = countDirty(session);
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
  return banners.join('');
}

function renderStageTabButtons(
  session: KpsSession,
  tableName: string,
  target: KpsStageTarget,
  gridStageId: string,
): string {
  const table = session.tables[tableName];
  const groups = findStageGroups(table, session.stageIds);
  const groupTabs = groups
    .map((group) => {
      const active =
        target.kind === 'group' &&
        group.memberIds.length === target.memberIds.length &&
        group.memberIds.every((id) => target.memberIds.includes(id))
          ? ' active'
          : '';
      return `<button class="stage-group${active}" data-group="${escapeHtml(group.memberIds.join(','))}">${escapeHtml(group.label)}</button>`;
    })
    .join('');
  const stageTabs = session.stageIds
    .map((id) => {
      const st = table.stages[id];
      const active = target.kind === 'stage' && id === gridStageId ? ' active' : '';
      const member =
        target.kind === 'group' && target.memberIds.includes(id) ? ' member' : '';
      const missing = st?.status === 'missing' ? ' missing' : '';
      return `<button class="stage-tab${active}${member}${missing}" data-stage="${escapeHtml(id)}">${escapeHtml(id)}</button>`;
    })
    .join('');
  return groupTabs + stageTabs;
}

export function buildKpsCellPatch(
  session: KpsSession,
  tableName: string,
  stageTarget: KpsStageTarget,
  edited: { rowIndex: number; column: string },
): KpsCellPatch | undefined {
  const table = session.tables[tableName];
  if (!table) {
    return undefined;
  }
  const target = resolveStageTarget(stageTarget, table, session.stageIds);
  const gridStageId = target.kind === 'group' ? target.memberIds[0] : target.stageId;
  const stage = table.stages[gridStageId];
  if (!stage) {
    return undefined;
  }
  const modelCell = stage.status === 'present' ? stage.rows[edited.rowIndex]?.cells[edited.column] : undefined;
  return {
    bannersHtml: renderBanners(session, tableName, stage),
    saveLabel: `Save${countDirty(session) > 0 ? ` (${countDirty(session)})` : ''}`,
    stageTabsHtml: renderStageTabButtons(session, tableName, target, gridStageId),
    target,
    gridStageId,
    openJsonDisabled: target.kind === 'group' || stage.status === 'missing',
    cell: modelCell
      ? {
          rowIndex: edited.rowIndex,
          column: edited.column,
          value: scalarToInputValue(modelCell.value),
          warning: modelCell.warning,
        }
      : null,
  };
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
    .toolbar button:disabled, .tabs button:disabled {
      opacity: 0.5;
      cursor: default;
    }
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
    .tabs button.member {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
    }
    .tabs button.missing { border-style: dashed; }
    .grid-wrap {
      flex: 1;
      overflow: auto;
      overflow-anchor: none;
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

export interface KpsGridFocus {
  rowIndex: number;
  column: string;
  selectionStart?: number;
  selectionEnd?: number;
}

function gridViewScript(options: {
  gridScrollTop?: number;
  gridScrollLeft?: number;
  scrollGridToEnd?: boolean;
  focusCell?: KpsGridFocus;
}): string {
  const scrollTop =
    typeof options.gridScrollTop === 'number' && Number.isFinite(options.gridScrollTop)
      ? Math.max(0, Math.trunc(options.gridScrollTop))
      : undefined;
  const scrollLeft =
    typeof options.gridScrollLeft === 'number' && Number.isFinite(options.gridScrollLeft)
      ? Math.max(0, Math.trunc(options.gridScrollLeft))
      : 0;
  const focus =
    options.focusCell &&
    Number.isInteger(options.focusCell.rowIndex) &&
    options.focusCell.rowIndex >= 0 &&
    options.focusCell.column
      ? options.focusCell
      : undefined;
  const selectionStart = Number.isInteger(focus?.selectionStart) ? focus?.selectionStart : undefined;
  const selectionEnd = Number.isInteger(focus?.selectionEnd) ? focus?.selectionEnd : undefined;

  const applyScroll = options.scrollGridToEnd
    ? `if (gridWrap) {
        gridWrap.scrollTop = gridWrap.scrollHeight;
        gridWrap.scrollLeft = ${scrollLeft};
      }`
    : scrollTop !== undefined
      ? `if (gridWrap) {
          gridWrap.scrollTop = ${scrollTop};
          gridWrap.scrollLeft = ${scrollLeft};
        }`
      : '';

  const focusScript = focus
    ? `const focusInput = Array.from(document.querySelectorAll('table.grid input')).find((input) =>
        input.getAttribute('data-row') === ${JSON.stringify(String(focus.rowIndex))} &&
        input.getAttribute('data-column') === ${JSON.stringify(focus.column)}
      );
      if (focusInput instanceof HTMLInputElement) {
        focusInput.focus({ preventScroll: true });
        ${
          selectionStart !== undefined && selectionEnd !== undefined
            ? `focusInput.setSelectionRange(${selectionStart}, ${selectionEnd});`
            : ''
        }
        applyGridScroll();
      }`
    : '';

  return `
    const gridWrap = document.querySelector('.grid-wrap');
    const applyGridScroll = () => {
      ${applyScroll}
    };
    applyGridScroll();
    requestAnimationFrame(() => {
      applyGridScroll();
      requestAnimationFrame(applyGridScroll);
    });
    let savedGridScroll = gridWrap ? gridWrap.scrollTop : 0;
    let savedGridScrollLeft = gridWrap ? gridWrap.scrollLeft : 0;
    let suppressGridScroll = false;
    const keepGridScroll = () => {
      if (!gridWrap) {
        return;
      }
      gridWrap.scrollTop = savedGridScroll;
      gridWrap.scrollLeft = savedGridScrollLeft;
    };
    gridWrap?.addEventListener('pointerdown', (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('input')) {
        return;
      }
      suppressGridScroll = true;
      savedGridScroll = gridWrap.scrollTop;
      savedGridScrollLeft = gridWrap.scrollLeft;
    }, true);
    gridWrap?.addEventListener('focusin', () => {
      if (!suppressGridScroll) {
        return;
      }
      keepGridScroll();
      requestAnimationFrame(() => {
        keepGridScroll();
        requestAnimationFrame(() => {
          keepGridScroll();
          suppressGridScroll = false;
        });
      });
    });
    ${focusScript}
    function gridScrollPayload() {
      const wrap = document.querySelector('.grid-wrap');
      if (!wrap) {
        return { gridScrollTop: 0, gridScrollLeft: 0, gridAtBottom: false };
      }
      return {
        gridScrollTop: wrap.scrollTop,
        gridScrollLeft: wrap.scrollLeft,
        gridAtBottom: wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 4,
      };
    }
    const vscodeApi = acquireVsCodeApi();
    const vscode = {
      postMessage(message) {
        const active = document.activeElement;
        const focusCell = active instanceof HTMLInputElement && active.matches('table.grid input')
          ? {
              rowIndex: Number(active.getAttribute('data-row')),
              column: active.getAttribute('data-column'),
              selectionStart: active.selectionStart,
              selectionEnd: active.selectionEnd,
            }
          : undefined;
        const payload = Object.assign({}, message, gridScrollPayload());
        if (focusCell && focusCell.column) {
          payload.focusCell = focusCell;
        }
        vscodeApi.postMessage(payload);
      },
    };
  `;
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
    stageTarget?: KpsStageTarget;
    kpsLabel?: string;
    nonce?: string;
    gridScrollTop?: number;
    gridScrollLeft?: number;
    scrollGridToEnd?: boolean;
    focusCell?: KpsGridFocus;
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
  const requested: KpsStageTarget = options.stageTarget
    ? options.stageTarget
    : options.stageId && table.stages[options.stageId]
      ? { kind: 'stage', stageId: options.stageId }
      : defaultStageTarget(table, session.stageIds);
  const target = resolveStageTarget(requested, table, session.stageIds);
  const gridStageId = target.kind === 'group' ? target.memberIds[0] : target.stageId;
  const stage = table.stages[gridStageId];
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

  const stageTabs = renderStageTabButtons(session, tableName, target, gridStageId);
  const banners = renderBanners(session, tableName, stage);

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
  <div id="banners">${banners}</div>
  <div id="main">
    <div class="tabs"><span class="label">Tables</span>${tableTabs}</div>
    <div class="tabs" id="stage-tabs"><span class="label">Stages</span><span id="stage-tab-buttons">${stageTabs}</span></div>
    <div class="tabs">
      <span class="label">Open</span>
      <button id="openJson"${target.kind === 'group' || stage.status === 'missing' ? ' disabled' : ''}>JSON</button>
      <button id="openStoreGroup"${table.storeGroupPath ? '' : ' disabled'}>Store Group</button>
      <button id="openTypeGroup"${table.typeGroupPath ? '' : ' disabled'}>Type Group</button>
    </div>
    ${renderStageBody(stage, table, tableName, gridStageId)}
  </div>
  <script nonce="${nonce}">
    ${gridViewScript(options)}
    const tableName = ${JSON.stringify(tableName)};
    const initialTarget = ${JSON.stringify(target)};
    let activeTarget = initialTarget;
    const gridStageId = ${JSON.stringify(gridStageId)};
    let activeGridStageId = gridStageId;

    function bindStageTabButtons() {
      document.querySelectorAll('#stage-tab-buttons .stage-group').forEach((button) => {
        button.addEventListener('click', () => {
          const memberIds = (button.getAttribute('data-group') ?? '').split(',').filter(Boolean);
          vscode.postMessage({ type: 'selectGroup', memberIds });
        });
      });
      document.querySelectorAll('#stage-tab-buttons .stage-tab').forEach((button) => {
        button.addEventListener('click', () => {
          vscode.postMessage({ type: 'selectStage', stageId: button.getAttribute('data-stage') });
        });
      });
    }

    function applyCellPatch(patch) {
      const wrap = document.querySelector('.grid-wrap');
      const top = wrap ? wrap.scrollTop : 0;
      const left = wrap ? wrap.scrollLeft : 0;
      const banners = document.getElementById('banners');
      if (banners) banners.innerHTML = patch.bannersHtml;
      const save = document.getElementById('save');
      if (save) save.textContent = patch.saveLabel;
      const buttons = document.getElementById('stage-tab-buttons');
      if (buttons) {
        buttons.innerHTML = patch.stageTabsHtml;
        bindStageTabButtons();
      }
      activeTarget = patch.target;
      activeGridStageId = patch.gridStageId;
      const openJson = document.getElementById('openJson');
      if (openJson) openJson.disabled = Boolean(patch.openJsonDisabled);
      if (patch.cell) {
        const input = Array.from(document.querySelectorAll('table.grid input')).find((candidate) =>
          candidate.getAttribute('data-row') === String(patch.cell.rowIndex) &&
          candidate.getAttribute('data-column') === patch.cell.column
        );
        if (input instanceof HTMLInputElement && document.activeElement !== input) {
          input.value = patch.cell.value;
        }
        const cellElement = input instanceof HTMLInputElement ? input.closest('td') : null;
        if (cellElement) {
          cellElement.classList.toggle('warn', Boolean(patch.cell.warning));
          if (patch.cell.warning) cellElement.title = patch.cell.warning;
          else cellElement.removeAttribute('title');
        }
      }
      if (wrap) {
        wrap.scrollTop = top;
        wrap.scrollLeft = left;
      }
    }

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || message.type !== 'cellPatch' || !message.patch) return;
      applyCellPatch(message.patch);
    });

    document.getElementById('save')?.addEventListener('click', () => vscode.postMessage({ type: 'save' }));
    document.getElementById('reload')?.addEventListener('click', () => vscode.postMessage({ type: 'reload' }));
    document.getElementById('switchKps')?.addEventListener('click', () => vscode.postMessage({ type: 'switchKps' }));
    document.getElementById('pickKps')?.addEventListener('click', () => vscode.postMessage({ type: 'pickKps' }));
    document.getElementById('openJson')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'openSource', source: 'json', tableName, stageId: activeGridStageId });
    });
    document.getElementById('openStoreGroup')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'openSource', source: 'storeGroup', tableName, activeGridStageId });
    });
    document.getElementById('openTypeGroup')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'openSource', source: 'typeGroup', tableName, activeGridStageId });
    });
    document.getElementById('addRow')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'addRow', tableName, target: activeTarget });
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
    bindStageTabButtons();
    document.querySelectorAll('.remove-row').forEach((button) => {
      button.addEventListener('click', () => {
        const rowIndex = Number(button.getAttribute('data-row'));
        vscode.postMessage({ type: 'removeRow', tableName, target: activeTarget, rowIndex });
      });
    });
    document.querySelectorAll('table.grid input').forEach((input) => {
      input.addEventListener('change', () => {
        vscode.postMessage({
          type: 'setCell',
          tableName,
          target: activeTarget,
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
