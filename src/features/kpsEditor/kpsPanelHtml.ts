import * as crypto from 'crypto';
import { getSaveShortcutScript } from '../webviewSave/saveShortcut';
import {
  defaultStageTarget,
  findStageGroups,
  resolveStageTarget,
  type KpsStageTarget,
} from './kpsStageGroups';
import {
  collectRowAcrossStages,
  keyIdLabel,
  rowKeyIdAt,
  stageRowKeyIds,
} from './kpsRowStages';
import type { KpsCell, KpsSession, KpsStageTable, KpsTableModel } from './types';

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
  editWarning: string | null;
  cell: {
    rowIndex: number;
    column: string;
    value: string;
    warning?: string;
  } | null;
  /**
   * The edited column's value in every stage that has the edited row's key,
   * so open all-stages panels (and the grid) show the committed values.
   */
  stageValues: {
    keyId: string;
    column: string;
    values: Array<{ stageId: string; rowIndex: number; value: string; warning?: string }>;
  } | null;
  /** Set when the edit came from an all-stages panel: anchors the edit warning there. */
  detailAnchor: { keyId: string; stageId: string; column: string } | null;
}

function renderBanners(session: KpsSession, tableName: string, stage: KpsStageTable): string {
  const banners: string[] = [];
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
  edited: { rowIndex: number; column: string; stageId?: string; fromDetail?: boolean },
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
  const editedStageId = edited.stageId ?? gridStageId;
  const gridRowIndex =
    editedStageId === gridStageId
      ? edited.rowIndex
      : (() => {
          const keyId = rowKeyIdAt(session, tableName, editedStageId, edited.rowIndex);
          return keyId === undefined
            ? -1
            : stageRowKeyIds(session, tableName, gridStageId).indexOf(keyId);
        })();
  const modelCell =
    stage.status === 'present' && gridRowIndex >= 0
      ? stage.rows[gridRowIndex]?.cells[edited.column]
      : undefined;
  const keyId = rowKeyIdAt(session, tableName, editedStageId, edited.rowIndex);
  const stageValues =
    keyId === undefined
      ? null
      : {
          keyId,
          column: edited.column,
          values: collectRowAcrossStages(session, tableName, keyId).flatMap((entry) => {
            if (entry.status !== 'present') {
              return [];
            }
            const cell = entry.row.cells[edited.column];
            if (!cell || !cell.editable) {
              return [];
            }
            return [
              {
                stageId: entry.stageId,
                rowIndex: entry.rowIndex,
                value: scalarToInputValue(cell.value),
                warning: cell.warning,
              },
            ];
          }),
        };
  return {
    bannersHtml: renderBanners(session, tableName, stage),
    saveLabel: `Save${countDirty(session) > 0 ? ` (${countDirty(session)})` : ''}`,
    stageTabsHtml: renderStageTabButtons(session, tableName, target, gridStageId),
    target,
    gridStageId,
    openJsonDisabled: target.kind === 'group' || stage.status === 'missing',
    editWarning: session.editWarning ?? null,
    cell: modelCell
      ? {
          rowIndex: gridRowIndex,
          column: edited.column,
          value: scalarToInputValue(modelCell.value),
          warning: modelCell.warning,
        }
      : null,
    stageValues,
    detailAnchor:
      edited.fromDetail && keyId !== undefined
        ? { keyId, stageId: editedStageId, column: edited.column }
        : null,
  };
}

function renderCell(cell: KpsCell | undefined, inputAttrs: string): string {
  if (!cell || !cell.editable) {
    const preview =
      cell?.nested !== undefined ? JSON.stringify(cell.nested) : scalarToInputValue(cell?.value);
    const lockedWarning = cell?.warning ?? 'Non-editable';
    return `<td class="locked" data-warning="${escapeHtml(lockedWarning)}">${escapeHtml(preview)}</td>`;
  }
  const warnClass = cell.warning ? ' class="warn"' : '';
  const warning = cell.warning ? ` data-warning="${escapeHtml(cell.warning)}"` : '';
  return `<td${warnClass}${warning}><input ${inputAttrs} value="${escapeHtml(scalarToInputValue(cell.value))}" /></td>`;
}

/** Grid columns before the table's own columns: drag handle and row number. */
const LEADING_GRID_COLUMNS = 2;

/**
 * The inline panel under a grid row: that key's row in every stage, editable
 * per stage. Stages without the key, without the table file, or with invalid
 * JSON are listed with the reason instead of values.
 */
export function renderKpsRowDetail(
  session: KpsSession,
  tableName: string,
  keyId: string,
  gridStageId: string,
): string {
  const table = session.tables[tableName];
  if (!table) {
    return '';
  }
  const entries = collectRowAcrossStages(session, tableName, keyId);
  const colspan = LEADING_GRID_COLUMNS + table.columns.length + 1;
  const header =
    '<th class="stage-col">Stage</th><th class="row-col">Row</th>' +
    table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('');
  const body = entries
    .map((entry) => {
      const current = entry.stageId === gridStageId ? ' current' : '';
      const label = `<td class="stage-col">${escapeHtml(entry.stageId)}</td>`;
      if (entry.status !== 'present') {
        const reason =
          entry.status === 'absent'
            ? 'No row with this key in this stage'
            : entry.status === 'missing'
              ? 'Table file missing in this stage'
              : `Invalid JSON: ${entry.parseError ?? 'parse error'}`;
        return `<tr class="stage-line ${entry.status}${current}" data-stage="${escapeHtml(entry.stageId)}">${label}<td class="row-col">–</td><td class="stage-reason" colspan="${table.columns.length}">${escapeHtml(reason)}</td></tr>`;
      }
      const cells = table.columns
        .map((column) =>
          renderCell(
            entry.row.cells[column],
            `class="stage-input" data-key-id="${escapeHtml(keyId)}" data-stage="${escapeHtml(entry.stageId)}" data-stage-row="${entry.rowIndex}" data-column="${escapeHtml(column)}"`,
          ),
        )
        .join('');
      return `<tr class="stage-line present${current}" data-stage="${escapeHtml(entry.stageId)}">${label}<td class="row-col">${entry.rowIndex + 1}</td>${cells}</tr>`;
    })
    .join('');
  const presentCount = entries.filter((entry) => entry.status === 'present').length;
  const keyLabel = table.keyColumn
    ? `${escapeHtml(table.keyColumn)} = <code>${escapeHtml(keyIdLabel(keyId))}</code>`
    : '';
  return `<tr class="row-detail" data-key-id="${escapeHtml(keyId)}"><td colspan="${colspan}">
    <div class="row-detail-panel">
      <div class="row-detail-title">All stages for ${keyLabel} <span class="row-detail-count">${presentCount} of ${entries.length} stages have this key</span></div>
      <table class="stage-values">
        <thead><tr>${header}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </td></tr>`;
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
      position: relative;
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
    #banners {
      position: absolute;
      left: 12px;
      right: 12px;
      bottom: 12px;
      z-index: 5;
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 40%;
      overflow: auto;
      pointer-events: none;
    }
    #banners:empty { display: none; }
    .cell-notice {
      position: fixed;
      z-index: 6;
      max-width: 280px;
      padding: 4px 8px;
      font-size: 11px;
      line-height: 1.35;
      border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      border-radius: 4px;
      background: var(--vscode-inputValidation-errorBackground, #f8d7da);
      color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground, #be1100));
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
      pointer-events: none;
    }
    .banner {
      padding: 6px 12px;
      font-size: 12px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      background: var(--vscode-inputValidation-warningBackground, #fff3cd);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
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
    .grid-search-wrap { flex: none; display: flex; align-items: center; gap: 8px; }
    #grid-search {
      flex: 1;
      max-width: 420px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 3px;
      padding: 4px 8px;
      font-size: 12px;
    }
    #grid-search-count { opacity: 0.7; font-size: 11px; }
    table.grid tbody tr.search-hidden { display: none; }
    .grid-empty-filter { display: none; padding: 8px; opacity: 0.7; font-size: 12px; }
    .grid-empty-filter.visible { display: block; }
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
    .draggable-row {
      transition: background-color 0.15s;
    }
    .draggable-row.dragging {
      opacity: 0.5;
      background-color: var(--vscode-list-inactiveSelectionBackground, #338eff33);
    }
    .drag-handle {
      width: 24px;
      text-align: center;
      padding: 4px 2px;
      user-select: none;
    }
    .drag-grip {
      display: inline-block;
      cursor: grab;
      font-size: 14px;
      line-height: 1;
      color: var(--vscode-charts-gray, #6e7681);
      letter-spacing: -2px;
    }
    .drag-grip:hover { color: var(--vscode-foreground); }
    .drag-grip:active { cursor: grabbing; }
    .row-num-cell {
      white-space: nowrap;
      width: 1%;
      padding-right: 8px;
      user-select: none;
    }
    .row-expand {
      background: transparent;
      border: none;
      color: var(--vscode-foreground);
      cursor: pointer;
      padding: 0 4px 0 0;
      font-size: 11px;
      width: 16px;
      opacity: 0.8;
    }
    .row-expand:hover { opacity: 1; }
    .row-expand:disabled { opacity: 0.3; cursor: default; }
    .row-num {
      display: inline-block;
      min-width: 2ch;
      text-align: right;
      font-variant-numeric: tabular-nums;
      color: var(--vscode-editorLineNumber-foreground, var(--vscode-descriptionForeground));
    }
    tr.draggable-row.expanded > td { border-bottom-color: transparent; }
    tr.row-detail > td {
      padding: 0 6px 8px 30px;
    }
    .row-detail-panel {
      border: 1px solid var(--vscode-panel-border);
      border-left: 3px solid var(--vscode-focusBorder, #007fd4);
      border-radius: 3px;
      padding: 6px 8px;
      background: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.06));
    }
    .row-detail-title { font-size: 11px; margin-bottom: 4px; }
    .row-detail-count { opacity: 0.7; margin-left: 8px; }
    table.grid table.stage-values {
      border-collapse: collapse;
      width: 100%;
    }
    table.grid table.stage-values th {
      position: static;
      background: transparent;
      font-weight: 600;
      font-size: 11px;
      opacity: 0.8;
    }
    table.grid table.stage-values td, table.grid table.stage-values th {
      padding: 2px 6px;
    }
    table.grid table.stage-values tr:last-child td { border-bottom: none; }
    .stage-values .stage-col { font-weight: 600; white-space: nowrap; width: 1%; }
    .stage-values .row-col {
      white-space: nowrap;
      width: 1%;
      font-variant-numeric: tabular-nums;
      color: var(--vscode-editorLineNumber-foreground, var(--vscode-descriptionForeground));
    }
    .stage-values tr.current .stage-col::after { content: ' (shown)'; font-weight: normal; opacity: 0.7; }
    .stage-values tr.absent .stage-reason,
    .stage-values tr.missing .stage-reason {
      font-style: italic;
      color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground));
    }
    .stage-values tr.absent .stage-col,
    .stage-values tr.missing .stage-col { opacity: 0.6; }
    .stage-values tr.error .stage-reason { color: var(--vscode-errorForeground, #be1100); }
    .stage-values td.differs input {
      border-left: 3px solid var(--vscode-charts-yellow, #cca700);
    }
    table.grid tbody tr.drag-over-top td {
      box-shadow: inset 0 2px 0 0 var(--vscode-focusBorder, #007fd4);
    }
    table.grid tbody tr.drag-over-bottom td {
      box-shadow: inset 0 -2px 0 0 var(--vscode-focusBorder, #007fd4);
    }
  </style>`;
}

function renderStageBody(
  session: KpsSession,
  stage: KpsStageTable,
  table: KpsTableModel,
  tableName: string,
  stageId: string,
  expandedKeys: Set<string>,
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
    '<th class="drag-handle-header" style="width:24px;text-align:center;"></th>' +
    '<th class="row-num-cell" title="Row position in this stage file (display only)">#</th>' +
    table.columns
      .map((column) => {
        const unexpected = schemaSet.size > 0 && !schemaSet.has(column);
        const cls = unexpected ? ' class="unexpected"' : '';
        const warning = unexpected ? ' data-warning="Not in Type Group"' : '';
        return `<th${cls}${warning}>${escapeHtml(column)}</th>`;
      })
      .join('') + '<th></th>';
  const keyIds = stageRowKeyIds(session, tableName, stageId);
  const rows = stage.rows
    .map((row, rowIndex) => {
      const cells = table.columns
        .map((column) =>
          renderCell(
            row.cells[column],
            `class="grid-input" data-row="${rowIndex}" data-column="${escapeHtml(column)}"`,
          ),
        )
        .join('');
      const keyId = keyIds[rowIndex];
      const expanded = keyId !== undefined && expandedKeys.has(keyId);
      const expander =
        keyId === undefined
          ? `<button class="row-expand" disabled title="No ${escapeHtml(table.keyColumn ?? 'key')} value: cannot match this row in other stages">▸</button>`
          : `<button class="row-expand" aria-expanded="${expanded}" title="Show this ${escapeHtml(table.keyColumn ?? 'key')} in all stages">${expanded ? '▾' : '▸'}</button>`;
      const keyAttr = keyId === undefined ? '' : ` data-key-id="${escapeHtml(keyId)}"`;
      const gridRow = `<tr data-row-index="${rowIndex}"${keyAttr} class="draggable-row${expanded ? ' expanded' : ''}"><td class="drag-handle"><span class="drag-grip" draggable="true" data-row-index="${rowIndex}" title="Drag to reorder">⋮⋮</span></td><td class="row-num-cell">${expander}<span class="row-num">${rowIndex + 1}</span></td>${cells}<td class="row-actions"><button class="remove-row" data-row="${rowIndex}">−</button></td></tr>`;
      return expanded && keyId !== undefined
        ? gridRow + renderKpsRowDetail(session, tableName, keyId, stageId)
        : gridRow;
    })
    .join('');

  return `<div class="grid-wrap">
    <p class="placeholder grid-empty-filter">No rows match the current search.</p>
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
    ? `const focusInput = Array.from(document.querySelectorAll('table.grid input.grid-input')).find((input) =>
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

  const dragDropScript = `
    const gridTable = document.querySelector('table.grid');
    let draggedRow = null;
    let dragOverRow = null;
    let dragGhost = null;

    function bindDragEvents() {
      document.querySelectorAll('.drag-grip').forEach((grip) => {
        if (grip.dataset.dragBound === 'true') return;
        grip.dataset.dragBound = 'true';
        grip.addEventListener('dragstart', handleDragStart);
      });
      document.querySelectorAll('.draggable-row').forEach(row => {
        if (row.dataset.dragBound === 'true') return;
        row.dataset.dragBound = 'true';
        row.addEventListener('dragover', handleDragOver);
        row.addEventListener('drop', handleDrop);
      });
      const tbody = document.querySelector('table.grid tbody');
      if (tbody && tbody.dataset.dragEndBound !== 'true') {
        tbody.dataset.dragEndBound = 'true';
        tbody.addEventListener('dragend', handleDragEnd);
      }
    }

    function handleDragStart(event) {
      const grip = event.currentTarget;
      draggedRow = grip instanceof Element ? grip.closest('.draggable-row') : null;
      if (!draggedRow) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedRow.getAttribute('data-row-index'));
      // Use the full row as the drag ghost, not just the grip.
      const ghost = draggedRow.cloneNode(true);
      ghost.style.width = draggedRow.offsetWidth + 'px';
      ghost.style.opacity = '0.8';
      ghost.style.position = 'absolute';
      ghost.style.top = '-9999px';
      ghost.style.left = '-9999px';
      ghost.style.pointerEvents = 'none';
      document.body.appendChild(ghost);
      dragGhost = ghost;
      event.dataTransfer.setDragImage(ghost, 12, Math.min(16, draggedRow.offsetHeight / 2));
      draggedRow.classList.add('dragging');
    }

    function clearDragIndicators() {
      document.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach((row) => {
        row.classList.remove('drag-over-top', 'drag-over-bottom');
      });
    }

    function handleDragOver(event) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';

      const targetRow = event.target instanceof Element ? event.target.closest('.draggable-row') : null;
      clearDragIndicators();
      if (!targetRow || targetRow === draggedRow) {
        return;
      }
      dragOverRow = targetRow;
      const rect = targetRow.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      targetRow.classList.add(before ? 'drag-over-top' : 'drag-over-bottom');
    }

    function handleDrop(event) {
      event.preventDefault();
      clearDragIndicators();
      dragOverRow = null;

      if (!draggedRow) {
        return;
      }
      const fromIndex = parseInt(draggedRow.getAttribute('data-row-index') || '-1', 10);
      const targetRow = event.target instanceof Element ? event.target.closest('.draggable-row') : null;
      if (fromIndex === -1 || !targetRow || targetRow === draggedRow) {
        return;
      }
      const targetIndex = parseInt(targetRow.getAttribute('data-row-index') || '-1', 10);
      if (targetIndex === -1) {
        return;
      }
      const rect = targetRow.getBoundingClientRect();
      const dropAfter = event.clientY >= rect.top + rect.height / 2;
      let toIndex = dropAfter ? targetIndex + 1 : targetIndex;
      // Adjust for the source row being removed before insertion.
      if (fromIndex < toIndex) {
        toIndex -= 1;
      }
      if (toIndex === fromIndex) {
        return;
      }
      vscode.postMessage({
        type: 'moveRow',
        tableName,
        target: activeTarget,
        fromRowIndex: fromIndex,
        toRowIndex: toIndex
      });
    }

    function handleDragEnd(event) {
      clearDragIndicators();
      if (dragGhost) {
        dragGhost.remove();
        dragGhost = null;
      }
      draggedRow = null;
      dragOverRow = null;
      document.querySelectorAll('.draggable-row').forEach(row => row.classList.remove('dragging'));
    }

    // Re-bind drag events on refresh
    bindDragEvents();
    
    window.addEventListener('bindDragEvents', bindDragEvents);
  `;

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
    ${dragDropScript}
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
        const focusCell = active instanceof HTMLInputElement && active.matches('table.grid input.grid-input')
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
    ${getSaveShortcutScript()}
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
    searchQuery?: string;
    /** Key ids of the selected table's rows whose all-stages panel is open. */
    expandedRowKeys?: Iterable<string>;
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
    ${getSaveShortcutScript()}
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
  const searchQuery = options.searchQuery ?? '';
  const searchHtml =
    stage.status === 'present'
      ? `<div class="grid-search-wrap">
      <input id="grid-search" type="search" aria-label="Search rows" placeholder="Search keys or values…" value="${escapeHtml(searchQuery)}" />
      <span id="grid-search-count"></span>
    </div>`
      : '';

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
    ${searchHtml}
    ${renderStageBody(session, stage, table, tableName, gridStageId, new Set(options.expandedRowKeys ?? []))}
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

    let stickyNotice = null;
    let hoverNotice = null;

    function cellNoticeElement() {
      let notice = document.getElementById('cell-notice');
      if (!notice) {
        notice = document.createElement('div');
        notice.id = 'cell-notice';
        notice.className = 'cell-notice';
        notice.hidden = true;
        document.body.appendChild(notice);
      }
      return notice;
    }

    function findCellAnchor(rowIndex, column) {
      return Array.from(document.querySelectorAll('table.grid input.grid-input')).find((candidate) =>
        candidate.getAttribute('data-row') === String(rowIndex) &&
        candidate.getAttribute('data-column') === column
      ) || null;
    }

    function placeCellNotice(anchor, message) {
      const notice = cellNoticeElement();
      if (!anchor || !message) {
        notice.hidden = true;
        return;
      }
      notice.hidden = false;
      notice.textContent = message;
      const rect = anchor.getBoundingClientRect();
      notice.style.left = Math.max(8, rect.left) + 'px';
      let top = rect.bottom + 4;
      notice.style.top = top + 'px';
      const height = notice.offsetHeight;
      if (top + height > window.innerHeight - 8) {
        top = Math.max(8, rect.top - height - 4);
        notice.style.top = top + 'px';
      }
    }

    function findStageInput(keyId, stageId, column) {
      return Array.from(document.querySelectorAll('table.grid input.stage-input')).find((candidate) =>
        candidate.getAttribute('data-key-id') === keyId &&
        candidate.getAttribute('data-stage') === stageId &&
        candidate.getAttribute('data-column') === column
      ) || null;
    }

    function refreshCellNotice() {
      if (hoverNotice) {
        placeCellNotice(hoverNotice.anchor, hoverNotice.message);
        return;
      }
      if (stickyNotice) {
        const anchor = stickyNotice.detail
          ? findStageInput(stickyNotice.detail.keyId, stickyNotice.detail.stageId, stickyNotice.detail.column)
          : findCellAnchor(stickyNotice.rowIndex, stickyNotice.column);
        placeCellNotice(anchor, stickyNotice.message);
        return;
      }
      placeCellNotice(null, '');
    }

    function bindCellNotice() {
      const wrap = document.querySelector('.grid-wrap');
      if (!wrap || wrap.dataset.noticeBound === 'true') return;
      wrap.dataset.noticeBound = 'true';
      wrap.addEventListener('pointerover', (event) => {
        const cell = event.target instanceof Element ? event.target.closest('td, th') : null;
        const message = cell?.getAttribute('data-warning');
        if (!cell || !message) {
          hoverNotice = null;
          refreshCellNotice();
          return;
        }
        hoverNotice = { anchor: cell, message };
        refreshCellNotice();
      });
      wrap.addEventListener('pointerout', (event) => {
        const cell = event.target instanceof Element ? event.target.closest('td, th') : null;
        if (!hoverNotice || hoverNotice.anchor !== cell) return;
        const next = event.relatedTarget;
        if (next instanceof Node && cell.contains(next)) return;
        hoverNotice = null;
        refreshCellNotice();
      });
      wrap.addEventListener('scroll', () => refreshCellNotice());
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
        const input = Array.from(document.querySelectorAll('table.grid input.grid-input')).find((candidate) =>
          candidate.getAttribute('data-row') === String(patch.cell.rowIndex) &&
          candidate.getAttribute('data-column') === patch.cell.column
        );
        if (input instanceof HTMLInputElement && document.activeElement !== input) {
          input.value = patch.cell.value;
        }
        const cellElement = input instanceof HTMLInputElement ? input.closest('td') : null;
        if (cellElement) {
          cellElement.classList.toggle('warn', Boolean(patch.cell.warning));
          if (patch.cell.warning) cellElement.setAttribute('data-warning', patch.cell.warning);
          else cellElement.removeAttribute('data-warning');
        }
      }
      if (patch.stageValues) {
        patch.stageValues.values.forEach((entry) => {
          const input = findStageInput(patch.stageValues.keyId, entry.stageId, patch.stageValues.column);
          if (!(input instanceof HTMLInputElement)) return;
          if (document.activeElement !== input) input.value = entry.value;
          const td = input.closest('td');
          if (td) {
            td.classList.toggle('warn', Boolean(entry.warning));
            if (entry.warning) td.setAttribute('data-warning', entry.warning);
            else td.removeAttribute('data-warning');
          }
        });
        document.querySelectorAll('tr.row-detail').forEach(refreshDetailDiffs);
      }
      if (patch.editWarning && patch.detailAnchor) {
        stickyNotice = { detail: patch.detailAnchor, message: patch.editWarning };
      } else if (patch.editWarning && patch.cell) {
        stickyNotice = {
          rowIndex: patch.cell.rowIndex,
          column: patch.cell.column,
          message: patch.editWarning,
        };
      } else {
        stickyNotice = null;
      }
      if (wrap) {
        wrap.scrollTop = top;
        wrap.scrollLeft = left;
      }
      // Re-bind drag events after DOM update
      window.dispatchEvent(new Event('bindDragEvents'));
      refreshCellNotice();
    }

    function findGridRowByKey(keyId) {
      return Array.from(document.querySelectorAll('table.grid tr.draggable-row')).find((row) =>
        row.getAttribute('data-key-id') === keyId
      ) || null;
    }

    function detailRowOf(gridRow) {
      const next = gridRow ? gridRow.nextElementSibling : null;
      return next && next.classList.contains('row-detail') ? next : null;
    }

    function cellText(td) {
      const input = td.querySelector('input');
      return input instanceof HTMLInputElement ? input.value : (td.textContent || '');
    }

    // Marks values that differ from the stage shown in the grid.
    function refreshDetailDiffs(detail) {
      const lines = Array.from(detail.querySelectorAll('tr.stage-line.present'));
      const reference = lines.find((line) => line.getAttribute('data-stage') === activeGridStageId);
      lines.forEach((line) => {
        const cells = Array.from(line.children).slice(2);
        const refCells = reference ? Array.from(reference.children).slice(2) : [];
        cells.forEach((td, index) => {
          const differs = !!reference && line !== reference && refCells[index] && cellText(td) !== cellText(refCells[index]);
          td.classList.toggle('differs', differs);
          if (differs && !td.hasAttribute('data-warning')) td.title = 'Differs from ' + activeGridStageId;
          else td.removeAttribute('title');
        });
      });
    }

    function bindDetail(detail) {
      if (!detail || detail.dataset.bound === 'true') return;
      detail.dataset.bound = 'true';
      detail.querySelectorAll('input.stage-input').forEach((input) => {
        input.addEventListener('input', () => refreshDetailDiffs(detail));
        input.addEventListener('change', () => {
          vscode.postMessage({
            type: 'setStageCell',
            tableName,
            stageId: input.getAttribute('data-stage'),
            rowIndex: Number(input.getAttribute('data-stage-row')),
            column: input.getAttribute('data-column'),
            value: input.value,
          });
        });
      });
      refreshDetailDiffs(detail);
    }

    function setExpanderState(gridRow, expanded) {
      const button = gridRow ? gridRow.querySelector('.row-expand') : null;
      if (button) {
        button.textContent = expanded ? '▾' : '▸';
        button.setAttribute('aria-expanded', String(expanded));
      }
      if (gridRow) gridRow.classList.toggle('expanded', expanded);
    }

    function insertRowDetail(keyId, html) {
      const gridRow = findGridRowByKey(keyId);
      if (!gridRow || !html) return;
      const existing = detailRowOf(gridRow);
      if (existing) existing.remove();
      const holder = document.createElement('tbody');
      holder.innerHTML = html;
      const detail = holder.firstElementChild;
      if (!detail) return;
      gridRow.after(detail);
      detail.classList.toggle('search-hidden', gridRow.classList.contains('search-hidden'));
      setExpanderState(gridRow, true);
      bindDetail(detail);
    }

    document.querySelectorAll('table.grid tr.draggable-row .row-expand').forEach((button) => {
      button.addEventListener('click', () => {
        const gridRow = button.closest('tr.draggable-row');
        const keyId = gridRow ? gridRow.getAttribute('data-key-id') : null;
        if (!gridRow || !keyId) return;
        const open = detailRowOf(gridRow);
        if (open) {
          open.remove();
          setExpanderState(gridRow, false);
          vscode.postMessage({ type: 'toggleRowDetail', tableName, keyId, expanded: false });
        } else {
          vscode.postMessage({ type: 'toggleRowDetail', tableName, keyId, expanded: true });
        }
      });
    });
    document.querySelectorAll('table.grid tr.row-detail').forEach(bindDetail);

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message) return;
      if (message.type === 'rowDetail') {
        insertRowDetail(message.keyId, message.html);
        return;
      }
      if (message.type !== 'cellPatch' || !message.patch) return;
      applyCellPatch(message.patch);
    });

    document.getElementById('save')?.addEventListener('click', () => vscode.postMessage({ type: 'save' }));
    document.getElementById('reload')?.addEventListener('click', () => vscode.postMessage({ type: 'reload' }));
    ${getSaveShortcutScript()}
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
    bindCellNotice();
    document.querySelectorAll('.remove-row').forEach((button) => {
      button.addEventListener('click', () => {
        const rowIndex = Number(button.getAttribute('data-row'));
        vscode.postMessage({ type: 'removeRow', tableName, target: activeTarget, rowIndex });
      });
    });
    function rowSearchText(row) {
      const parts = [];
      row.querySelectorAll('td').forEach((cell) => {
        if (cell.classList.contains('row-num-cell') || cell.classList.contains('drag-handle')) return;
        const input = cell.querySelector('input');
        parts.push(input instanceof HTMLInputElement ? input.value : (cell.textContent || ''));
      });
      return parts.join(' ').toLowerCase();
    }

    function applyGridFilter(query) {
      const needle = (query || '').trim().toLowerCase();
      const rows = Array.from(document.querySelectorAll('table.grid tr.draggable-row'));
      let visible = 0;
      rows.forEach((row) => {
        const match = !needle || rowSearchText(row).indexOf(needle) !== -1;
        row.classList.toggle('search-hidden', !match);
        const detail = detailRowOf(row);
        if (detail) detail.classList.toggle('search-hidden', !match);
        if (match) visible += 1;
      });
      const empty = document.querySelector('.grid-empty-filter');
      if (empty) empty.classList.toggle('visible', !!needle && rows.length > 0 && visible === 0);
      const count = document.getElementById('grid-search-count');
      if (count) count.textContent = needle ? visible + ' of ' + rows.length + ' rows' : '';
    }

    const gridSearch = document.getElementById('grid-search');
    if (gridSearch instanceof HTMLInputElement) {
      applyGridFilter(gridSearch.value);
      let searchTimer = undefined;
      gridSearch.addEventListener('input', () => {
        applyGridFilter(gridSearch.value);
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          vscode.postMessage({ type: 'search', query: gridSearch.value });
        }, 150);
      });
    }

    document.querySelectorAll('table.grid input.grid-input').forEach((input) => {
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
