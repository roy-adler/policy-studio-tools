import * as path from 'path';
import { cacheId, cacheListHint } from './cacheIdentity';
import { searchCaches } from './searchCaches';
import type { CacheSession, CacheUsage, ParsedCache } from './types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function usagesForCache(session: CacheSession, cache: ParsedCache): CacheUsage[] {
  const id = cacheId(cache);
  return session.usages.filter((usage) => usage.cacheId === id);
}

function groupedCaches(caches: ParsedCache[]): {
  local: ParsedCache[];
  distributed: ParsedCache[];
  other: ParsedCache[];
} {
  const sorted = [...caches].sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.projectDisplayName.localeCompare(right.projectDisplayName),
  );
  return {
    local: sorted.filter((cache) => cache.kind === 'local'),
    distributed: sorted.filter((cache) => cache.kind === 'distributed'),
    other: sorted.filter((cache) => cache.kind === 'other'),
  };
}

function renderCacheRow(
  session: CacheSession,
  cache: ParsedCache,
  selectedId: string,
  showProject: boolean,
): string {
  const id = cacheId(cache);
  const usages = usagesForCache(session, cache);
  const hint = cacheListHint(cache);
  return `<button class="cache-row${id === selectedId ? ' selected' : ''}" data-id="${escapeHtml(id)}">
    <span class="cache-name">${escapeHtml(cache.name)}</span>
    <span class="cache-meta">${usages.length} uses${hint ? ` · ${escapeHtml(hint)}` : ''}</span>
    ${showProject ? `<span class="cache-project">${escapeHtml(cache.projectDisplayName)}</span>` : ''}
  </button>`;
}

function renderGroups(
  session: CacheSession,
  caches: ParsedCache[],
  selectedId: string,
): string {
  const groups = groupedCaches(caches);
  const showProject = new Set(session.caches.map((cache) => cache.projectId)).size > 1;
  return (
    [
      ['Local', groups.local],
      ['Distributed', groups.distributed],
      ['Other', groups.other],
    ] as const
  )
    .filter(([, group]) => group.length > 0)
    .map(
      ([label, group]) => `<section class="cache-group">
        <h2>${label}</h2>
        ${group
          .map((cache) => renderCacheRow(session, cache, selectedId, showProject))
          .join('')}
      </section>`,
    )
    .join('');
}

function usageLabel(usage: CacheUsage): string {
  const circuit = usage.circuitName ? `${usage.circuitName} / ` : '';
  const filter = usage.filterName ?? usage.fieldName ?? 'Reference';
  const type = usage.filterType ? ` (${usage.filterType})` : '';
  return `${circuit}${filter}${type} — ${usage.matchPreview}`;
}

function renderDetails(session: CacheSession, cache: ParsedCache): string {
  const usages = usagesForCache(session, cache);
  const settings = Object.entries(cache.fields)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([name, value]) =>
        `<tr><th>${escapeHtml(name)}</th><td>${escapeHtml(value)}</td></tr>`,
    )
    .join('');
  const usageRows =
    usages.length > 0
      ? usages
          .map(
            (usage, index) => `<button class="usage-row" data-usage="${index}">
              <span>${escapeHtml(usageLabel(usage))}</span>
              <span class="usage-file">${escapeHtml(path.basename(usage.filePath))}</span>
            </button>`,
          )
          .join('')
      : '<p class="empty-usage">No policies or caching filters reference this cache yet.</p>';

  return `<article class="details">
    <h2>${escapeHtml(cache.name)}</h2>
    <p class="entity-type">${escapeHtml(cache.entityType)}</p>
    <h3>Settings</h3>
    <table><tbody>${settings}</tbody></table>
    <h3>Usages</h3>
    <div class="usage-list">${usageRows}</div>
  </article>`;
}

function styles(): string {
  return `<style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .title { font-weight: 600; }
    .project-label { opacity: 0.75; }
    #search {
      flex: 1;
      min-width: 120px;
      max-width: 420px;
      margin-left: auto;
      padding: 4px 7px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    }
    button {
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      background: var(--vscode-button-secondaryBackground, transparent);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
      cursor: pointer;
    }
    button:disabled { opacity: 0.5; cursor: default; }
    .toolbar-button { padding: 4px 10px; }
    .banner {
      padding: 6px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-inputValidation-warningBackground);
    }
    main { display: grid; grid-template-columns: minmax(220px, 34%) 1fr; flex: 1; min-height: 0; }
    .inventory { overflow: auto; padding: 8px; border-right: 1px solid var(--vscode-panel-border); }
    .cache-group h2 { margin: 10px 6px 5px; font-size: 12px; text-transform: uppercase; opacity: 0.75; }
    .cache-row, .usage-row {
      display: flex;
      width: 100%;
      padding: 7px 8px;
      margin-bottom: 3px;
      text-align: left;
      flex-direction: column;
      gap: 2px;
    }
    .cache-row.selected {
      color: var(--vscode-list-activeSelectionForeground);
      background: var(--vscode-list-activeSelectionBackground);
      border-color: var(--vscode-focusBorder);
    }
    .cache-name { font-weight: 600; }
    .cache-meta, .cache-project, .usage-file, .entity-type { opacity: 0.72; font-size: 11px; }
    .detail-pane { overflow: auto; padding: 16px; }
    .details h2 { margin-top: 0; }
    .details h3 { margin: 20px 0 8px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 5px 7px; border-bottom: 1px solid var(--vscode-panel-border); text-align: left; }
    th { width: 35%; font-weight: 600; }
    .empty-state { margin: 32px auto; max-width: 520px; }
    @media (max-width: 620px) {
      header { flex-wrap: wrap; }
      #search { order: 2; margin-left: 0; max-width: none; width: 100%; }
      main { grid-template-columns: 1fr; }
      .inventory { border-right: 0; border-bottom: 1px solid var(--vscode-panel-border); }
    }
  </style>`;
}

export function renderCacheBrowserHtml(
  session: CacheSession,
  options: {
    nonce: string;
    cspSource: string;
    selectedId?: string;
    query: string;
  },
): string {
  const filtered = searchCaches(session.caches, options.query);
  const selected =
    filtered.find((cache) => cacheId(cache) === options.selectedId) ?? filtered[0];
  const selectedId = selected ? cacheId(selected) : '';
  const emptyCopy = options.query.trim()
    ? 'No caches match.'
    : 'No caches under Libraries/Cache Manager.';
  const inventory = filtered.length
    ? renderGroups(session, filtered, selectedId)
    : `<p class="empty-state">${emptyCopy}</p>`;
  const detail = selected
    ? renderDetails(session, selected)
    : `<p class="empty-state">${emptyCopy}</p>`;
  const banner = session.warnings.length
    ? `<div class="banner">${escapeHtml(session.warnings.join(' · '))}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${escapeHtml(options.cspSource)}; script-src 'nonce-${escapeHtml(options.nonce)}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${styles()}
</head>
<body>
  <header>
    <span class="title">Caches</span>
    <span class="project-label">${escapeHtml(session.projectLabel)}</span>
    <input id="search" type="search" aria-label="Search caches" placeholder="Search caches" value="${escapeHtml(options.query)}" />
    <button id="refresh" class="toolbar-button">Refresh</button>
    <button id="openCache" class="toolbar-button"${selected ? '' : ' disabled'}>Open YAML</button>
  </header>
  ${banner}
  <main data-selected-id="${escapeHtml(selectedId)}">
    <nav class="inventory" aria-label="Caches">${inventory}</nav>
    <section class="detail-pane">${detail}</section>
  </main>
  <script nonce="${escapeHtml(options.nonce)}">
    const vscode = acquireVsCodeApi();
    const selectedCacheId = document.querySelector('main')?.getAttribute('data-selected-id') ?? '';
    let searchTimer;
    document.getElementById('search')?.addEventListener('input', (event) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        vscode.postMessage({ type: 'search', query: event.target.value });
      }, 300);
    });
    document.querySelectorAll('.cache-row').forEach((row) => {
      row.addEventListener('click', () => {
        vscode.postMessage({ type: 'select', cacheId: row.getAttribute('data-id') });
      });
    });
    document.getElementById('refresh')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });
    document.getElementById('openCache')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'openCache', cacheId: selectedCacheId });
    });
    document.querySelectorAll('.usage-row').forEach((row) => {
      row.addEventListener('click', () => {
        vscode.postMessage({
          type: 'openUsage',
          cacheId: selectedCacheId,
          usageIndex: Number(row.getAttribute('data-usage')),
        });
      });
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
