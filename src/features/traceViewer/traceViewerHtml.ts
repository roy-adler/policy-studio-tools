export function getTraceViewerHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      --success-color: var(--vscode-charts-green, #2da44e);
      --failure-color: var(--vscode-charts-red, #d1242f);
      --skipped-color: var(--vscode-descriptionForeground, #8b949e);
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
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      flex: none;
    }
    header .title { font-weight: 600; }
    header .meta { opacity: 0.75; font-size: 12px; }
    header input[type="search"] {
      flex: 1;
      min-width: 180px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 3px;
      padding: 4px 8px;
    }
    header button {
      background: var(--vscode-button-secondaryBackground, transparent);
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
      padding: 2px 8px;
      cursor: pointer;
      font-size: 12px;
    }
    #banner, #error {
      display: none;
      padding: 6px 12px;
      font-size: 12px;
      flex: none;
    }
    #banner {
      background: var(--vscode-inputValidation-warningBackground, #fff3cd);
      border-bottom: 1px solid var(--vscode-inputValidation-warningBorder, #ffec99);
      color: var(--vscode-inputValidation-warningForeground, inherit);
    }
    #error {
      background: var(--vscode-inputValidation-errorBackground, #ffebe9);
      border-bottom: 1px solid var(--vscode-inputValidation-errorBorder, #ff8182);
      color: var(--vscode-inputValidation-errorForeground, inherit);
    }
    main {
      flex: 1;
      display: grid;
      grid-template-columns: minmax(240px, 36%) 1fr;
      min-height: 0;
    }
    #tree-panel, #detail-panel {
      overflow: auto;
      min-height: 0;
    }
    #tree-panel {
      border-right: 1px solid var(--vscode-panel-border);
      padding: 8px 0;
    }
    #detail-panel { padding: 12px 16px; }
    #empty {
      padding: 24px;
      opacity: 0.8;
    }
    .tree-node {
      user-select: none;
    }
    .tree-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px 3px calc(8px + var(--depth, 0) * 14px);
      cursor: pointer;
      border-left: 3px solid transparent;
    }
    .tree-row:hover { background: var(--vscode-list-hoverBackground); }
    .tree-row.selected {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }
    .tree-row.match { border-left-color: var(--vscode-focusBorder, #007acc); }
    .tree-row.failed .label { color: var(--failure-color); }
    .tree-row.skipped .label { color: var(--skipped-color); }
    .toggle {
      width: 14px;
      text-align: center;
      opacity: 0.7;
      flex: none;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex: none;
      background: var(--skipped-color);
    }
    .status-dot.success { background: var(--success-color); }
    .status-dot.failure { background: var(--failure-color); }
    .status-dot.skipped { background: var(--skipped-color); }
    .label { font-weight: 500; }
    .type, .duration {
      font-size: 11px;
      opacity: 0.7;
    }
    .badge {
      font-size: 10px;
      font-weight: 700;
      color: var(--failure-color);
      border: 1px solid var(--failure-color);
      border-radius: 3px;
      padding: 0 4px;
    }
    .section { margin-bottom: 16px; }
    .section h3 {
      margin: 0 0 8px;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      opacity: 0.8;
    }
    .field-list { margin: 0; padding: 0; list-style: none; }
    .field-list li {
      display: grid;
      grid-template-columns: 140px 1fr;
      gap: 8px;
      padding: 4px 0;
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 12px;
    }
    .field-list .name { opacity: 0.8; word-break: break-word; }
    .field-list .value {
      font-family: var(--vscode-editor-font-family, monospace);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .mono {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
      background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.1));
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 8px;
      margin: 0;
    }
    .error-box {
      color: var(--failure-color);
      border-color: var(--failure-color);
    }
    mark {
      background: var(--vscode-editor-findMatchHighlightBackground, #ea5c0055);
      color: inherit;
    }
    footer {
      padding: 4px 12px;
      font-size: 11px;
      opacity: 0.7;
      border-top: 1px solid var(--vscode-panel-border);
      flex: none;
    }
    @media (max-width: 720px) {
      main { grid-template-columns: 1fr; }
      #tree-panel { border-right: none; border-bottom: 1px solid var(--vscode-panel-border); max-height: 45vh; }
    }
  </style>
</head>
<body>
  <header>
    <span class="title" id="file-title">Trace Viewer</span>
    <span class="meta" id="file-meta"></span>
    <input type="search" id="search" placeholder="Search trace..." aria-label="Search trace" />
    <button type="button" id="prev-match" title="Previous match">Prev</button>
    <button type="button" id="next-match" title="Next match">Next</button>
    <button type="button" id="expand-all" title="Expand all">Expand</button>
    <button type="button" id="collapse-all" title="Collapse all">Collapse</button>
  </header>
  <div id="banner"></div>
  <div id="error"></div>
  <main>
    <div id="tree-panel">
      <div id="empty">No trace entries to display.</div>
      <div id="tree"></div>
    </div>
    <div id="detail-panel">
      <div id="detail-empty">Select an entry to inspect details.</div>
      <div id="detail" hidden></div>
    </div>
  </main>
  <footer id="status">Ready</footer>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const state = {
      document: null,
      filteredEntries: [],
      expanded: new Set(),
      selectedId: null,
      searchQuery: '',
      matches: [],
      matchIndex: -1,
    };

    const els = {
      fileTitle: document.getElementById('file-title'),
      fileMeta: document.getElementById('file-meta'),
      banner: document.getElementById('banner'),
      error: document.getElementById('error'),
      search: document.getElementById('search'),
      tree: document.getElementById('tree'),
      empty: document.getElementById('empty'),
      detail: document.getElementById('detail'),
      detailEmpty: document.getElementById('detail-empty'),
      status: document.getElementById('status'),
    };

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function highlight(text, query) {
      const safe = escapeHtml(text);
      if (!query) return safe;
      const pattern = new RegExp('(' + query.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + ')', 'gi');
      return safe.replace(pattern, '<mark>$1</mark>');
    }

    function flattenEntries(entries, path = []) {
      const flat = [];
      for (const entry of entries) {
        const nextPath = [...path, entry.name];
        flat.push({ entry, path: nextPath });
        flat.push(...flattenEntries(entry.children || [], nextPath));
      }
      return flat;
    }

    function findEntryById(entries, id) {
      for (const entry of entries) {
        if (entry.id === id) return entry;
        const nested = findEntryById(entry.children || [], id);
        if (nested) return nested;
      }
      return null;
    }

    function entryMatchesQuery(entry, query) {
      if (!query) return false;
      const haystack = [
        entry.name,
        entry.type || '',
        entry.status,
        entry.requestBody || '',
        entry.responseBody || '',
        entry.error && entry.error.message || '',
        ...(entry.requestHeaders || []).map((h) => h.name + ' ' + h.value),
        ...(entry.responseHeaders || []).map((h) => h.name + ' ' + h.value),
        ...(entry.attributes || []).map((a) => a.name + ' ' + a.value),
      ].join('\\n').toLowerCase();
      return haystack.includes(query.toLowerCase());
    }

    function filterEntries(entries, query) {
      const normalized = (query || '').trim().toLowerCase();
      if (!normalized) return entries;

      const visit = (entry) => {
        const children = (entry.children || []).map(visit).filter(Boolean);
        const selfMatch = entryMatchesQuery(entry, normalized);
        if (!selfMatch && children.length === 0) return null;
        return { ...entry, children };
      };

      return entries.map(visit).filter(Boolean);
    }

    function computeMatches(entries, query) {
      const normalized = (query || '').trim().toLowerCase();
      if (!normalized) return [];
      return flattenEntries(entries)
        .filter(({ entry }) => entryMatchesQuery(entry, normalized))
        .map(({ entry, path }) => ({ entryId: entry.id, path }));
    }

    function renderTree() {
      const entries = state.filteredEntries;
      els.empty.style.display = entries.length ? 'none' : 'block';
      els.tree.innerHTML = entries.map((entry) => renderNode(entry, 0)).join('');
      bindTreeEvents();
    }

    function renderNode(entry, depth) {
      const hasChildren = entry.children && entry.children.length > 0;
      const expanded = state.expanded.has(entry.id) || Boolean(state.searchQuery);
      const isSelected = state.selectedId === entry.id;
      const isMatch = state.matches.some((match) => match.entryId === entry.id);
      const statusClass = entry.failed ? 'failure' : entry.status;
      const rowClass = [
        'tree-row',
        entry.failed ? 'failed' : '',
        entry.status === 'skipped' ? 'skipped' : '',
        isSelected ? 'selected' : '',
        isMatch ? 'match' : '',
      ].filter(Boolean).join(' ');

      const childrenHtml = hasChildren && expanded
        ? '<div class="tree-children">' + entry.children.map((child) => renderNode(child, depth + 1)).join('') + '</div>'
        : '';

      return (
        '<div class="tree-node" data-id="' + escapeHtml(entry.id) + '">' +
          '<div class="' + rowClass + '" style="--depth:' + depth + '">' +
            '<span class="toggle">' + (hasChildren ? (expanded ? '▼' : '▶') : '·') + '</span>' +
            '<span class="status-dot ' + statusClass + '"></span>' +
            '<span class="label">' + highlight(entry.name, state.searchQuery) + '</span>' +
            (entry.type ? '<span class="type">' + highlight(entry.type, state.searchQuery) + '</span>' : '') +
            (entry.duration != null ? '<span class="duration">' + entry.duration + 'ms</span>' : '') +
            (entry.failed ? '<span class="badge">FAIL</span>' : '') +
          '</div>' +
          childrenHtml +
        '</div>'
      );
    }

    function bindTreeEvents() {
      els.tree.querySelectorAll('.tree-row').forEach((row) => {
        row.addEventListener('click', (event) => {
          const node = row.closest('.tree-node');
          const id = node && node.getAttribute('data-id');
          if (!id) return;
          const entry = findEntryById(state.document.entries, id);
          if (!entry) return;

          const toggle = row.querySelector('.toggle');
          const hasChildren = entry.children && entry.children.length > 0;
          if (hasChildren && event.target === toggle) {
            if (state.expanded.has(id)) state.expanded.delete(id);
            else state.expanded.add(id);
            renderTree();
            return;
          }

          state.selectedId = id;
          renderTree();
          renderDetail(entry);
        });
      });
    }

    function renderFieldList(title, items, query) {
      if (!items || items.length === 0) return '';
      return (
        '<div class="section"><h3>' + escapeHtml(title) + '</h3><ul class="field-list">' +
          items.map((item) =>
            '<li><span class="name">' + highlight(item.name, query) + '</span>' +
            '<span class="value">' + highlight(item.value, query) + '</span></li>'
          ).join('') +
        '</ul></div>'
      );
    }

    function renderBody(title, value, query) {
      if (!value) return '';
      return (
        '<div class="section"><h3>' + escapeHtml(title) + '</h3>' +
        '<pre class="mono">' + highlight(value, query) + '</pre></div>'
      );
    }

    function renderDetail(entry) {
      els.detailEmpty.hidden = true;
      els.detail.hidden = false;
      const query = state.searchQuery;
      const parts = [
        '<div class="section"><h3>Filter</h3><ul class="field-list">' +
          '<li><span class="name">Name</span><span class="value">' + highlight(entry.name, query) + '</span></li>' +
          '<li><span class="name">Type</span><span class="value">' + highlight(entry.type || '-', query) + '</span></li>' +
          '<li><span class="name">Status</span><span class="value">' + highlight(entry.status, query) + '</span></li>' +
          (entry.duration != null ? '<li><span class="name">Duration</span><span class="value">' + entry.duration + ' ms</span></li>' : '') +
        '</ul></div>',
        entry.error ? '<div class="section"><h3>Error</h3><pre class="mono error-box">' + highlight(entry.error.message, query) + '</pre></div>' : '',
        renderFieldList('Request headers', entry.requestHeaders, query),
        renderFieldList('Response headers', entry.responseHeaders, query),
        renderBody('Request body', entry.requestBody, query),
        renderBody('Response body', entry.responseBody, query),
        renderFieldList('Attributes', entry.attributes, query),
      ];
      els.detail.innerHTML = parts.filter(Boolean).join('');
    }

    function applySearch(query) {
      state.searchQuery = query;
      state.filteredEntries = filterEntries(state.document ? state.document.entries : [], query);
      state.matches = computeMatches(state.document ? state.document.entries : [], query);
      state.matchIndex = state.matches.length ? 0 : -1;
      if (state.matchIndex >= 0) {
        state.selectedId = state.matches[state.matchIndex].entryId;
        for (const match of state.matches) {
          for (let i = 1; i < match.path.length; i += 1) {
            const ancestor = findEntryByPath(state.document.entries, match.path.slice(0, i));
            if (ancestor) state.expanded.add(ancestor.id);
          }
        }
      }
      renderTree();
      const selected = state.selectedId ? findEntryById(state.document.entries, state.selectedId) : null;
      if (selected) renderDetail(selected);
      else {
        els.detail.hidden = true;
        els.detailEmpty.hidden = false;
      }
      els.status.textContent = state.matches.length
        ? state.matches.length + ' match(es)'
        : 'Ready';
    }

    function findEntryByPath(entries, path) {
      if (!path.length) return null;
      const [head, ...rest] = path;
      const entry = entries.find((item) => item.name === head);
      if (!entry) return null;
      if (!rest.length) return entry;
      return findEntryByPath(entry.children || [], rest);
    }

    function showMatch(step) {
      if (!state.matches.length) return;
      state.matchIndex = (state.matchIndex + step + state.matches.length) % state.matches.length;
      const match = state.matches[state.matchIndex];
      state.selectedId = match.entryId;
      for (let i = 1; i < match.path.length; i += 1) {
        const ancestor = findEntryByPath(state.document.entries, match.path.slice(0, i));
        if (ancestor) state.expanded.add(ancestor.id);
      }
      renderTree();
      const entry = findEntryById(state.document.entries, match.entryId);
      if (entry) renderDetail(entry);
      els.status.textContent = 'Match ' + (state.matchIndex + 1) + ' of ' + state.matches.length;
    }

    function renderDocument(payload) {
      state.document = payload;
      state.expanded = new Set();
      state.selectedId = null;
      state.searchQuery = els.search.value || '';

      els.fileTitle.textContent = payload.metadata.fileName || 'Trace Viewer';
      const metaParts = [];
      if (payload.metadata.service) metaParts.push(payload.metadata.service);
      if (payload.metadata.timestamp) metaParts.push(payload.metadata.timestamp);
      if (payload.metadata.fileSize != null) metaParts.push(formatBytes(payload.metadata.fileSize));
      els.fileMeta.textContent = metaParts.join(' · ');

      if (payload.banner) {
        els.banner.style.display = 'block';
        els.banner.textContent = payload.banner;
      } else {
        els.banner.style.display = 'none';
      }

      if (payload.parseError) {
        els.error.style.display = 'block';
        els.error.textContent = payload.parseError;
      } else {
        els.error.style.display = 'none';
      }

      applySearch(state.searchQuery);
    }

    function formatBytes(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    els.search.addEventListener('input', () => applySearch(els.search.value));
    document.getElementById('prev-match').addEventListener('click', () => showMatch(-1));
    document.getElementById('next-match').addEventListener('click', () => showMatch(1));
    document.getElementById('expand-all').addEventListener('click', () => {
      if (!state.document) return;
      for (const { entry } of flattenEntries(state.document.entries)) {
        if (entry.children && entry.children.length) state.expanded.add(entry.id);
      }
      renderTree();
    });
    document.getElementById('collapse-all').addEventListener('click', () => {
      state.expanded.clear();
      renderTree();
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'traceData') {
        renderDocument(message);
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
