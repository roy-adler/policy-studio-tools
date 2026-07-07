export function getCircuitGraphPanelHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      --entry-color: var(--vscode-charts-blue, #0969da);
      --missing-color: var(--vscode-charts-red, #d1242f);
      --cycle-color: var(--vscode-charts-orange, #bf8700);
    }
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
      align-items: center;
      gap: 12px;
      flex: none;
      flex-wrap: wrap;
    }
    header .title { font-weight: 600; }
    header .project { opacity: 0.75; font-size: 12px; }
    header input {
      flex: 1;
      min-width: 160px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 3px;
      padding: 4px 8px;
      font-size: 12px;
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
    #banner {
      display: none;
      padding: 6px 12px;
      font-size: 12px;
      background: var(--vscode-inputValidation-warningBackground, #fff3cd);
      border-bottom: 1px solid var(--vscode-inputValidation-warningBorder, #ffec99);
      color: var(--vscode-inputValidation-warningForeground, inherit);
      flex: none;
    }
    #sidebar {
      flex: none;
      border-bottom: 1px solid var(--vscode-panel-border);
      padding: 6px 12px;
      font-size: 11px;
      max-height: 96px;
      overflow: auto;
    }
    #sidebar:empty { display: none; }
    #sidebar .section { margin-bottom: 4px; }
    #sidebar .label { font-weight: 600; margin-right: 6px; }
    #canvas { flex: 1; overflow: hidden; cursor: grab; }
    #canvas.panning { cursor: grabbing; }
    #empty {
      display: none;
      padding: 24px;
      opacity: 0.8;
    }
    svg { width: 100%; height: 100%; }
    .node rect {
      fill: var(--vscode-editorWidget-background, #f6f8fa);
      stroke: var(--vscode-panel-border, #d0d7de);
      stroke-width: 1.5;
      rx: 6;
    }
    .node { cursor: pointer; }
    .node:hover rect { stroke: var(--vscode-focusBorder, #0969da); }
    .node.entry rect { stroke: var(--entry-color); stroke-width: 2.5; }
    .node.missing rect { stroke-dasharray: 5 4; stroke: var(--missing-color); fill: transparent; }
    .node text { fill: var(--vscode-foreground); font-size: 12px; pointer-events: none; }
    .node .badge { font-size: 10px; font-weight: 700; fill: var(--entry-color); }
    .edge { stroke-width: 2; fill: none; stroke: var(--vscode-foreground); opacity: 0.55; }
    .edge.missing { stroke: var(--missing-color); stroke-dasharray: 7 4; opacity: 0.85; }
    .edge.cycle { stroke: var(--cycle-color); stroke-width: 2.5; opacity: 1; }
    footer {
      flex: none;
      border-top: 1px solid var(--vscode-panel-border);
      padding: 6px 12px;
      font-size: 11px;
      display: flex;
      gap: 16px;
      align-items: center;
      flex-wrap: wrap;
    }
    .legend-item { display: inline-flex; align-items: center; gap: 5px; }
    .legend-line { display: inline-block; width: 22px; height: 0; border-top: 2px solid; }
    .legend-line.normal { border-color: var(--vscode-foreground); opacity: 0.55; }
    .legend-line.missing { border-color: var(--missing-color); border-top-style: dashed; }
    .legend-line.cycle { border-color: var(--cycle-color); border-width: 2.5px; }
    .legend-box { display: inline-block; width: 14px; height: 10px; border: 1.5px solid; border-radius: 2px; }
    .legend-box.entry { border-color: var(--entry-color); border-width: 2px; }
    .legend-box.missing { border-color: var(--missing-color); border-style: dashed; }
  </style>
</head>
<body>
  <header>
    <span class="title">Circuit graph</span>
    <span class="project" id="project"></span>
    <input id="search" type="search" placeholder="Filter circuits…" />
    <button id="fit">Fit to screen</button>
  </header>
  <div id="banner"></div>
  <div id="sidebar"></div>
  <div id="empty"></div>
  <div id="canvas">
    <svg id="svg">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--vscode-foreground)" opacity="0.55"/>
        </marker>
        <marker id="arrow-missing" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 L 3 5 z" fill="var(--missing-color)"/>
        </marker>
        <marker id="arrow-cycle" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--cycle-color)"/>
        </marker>
      </defs>
      <g id="viewport"></g>
    </svg>
  </div>
  <footer>
    <span class="legend-item"><span class="legend-box entry"></span>Entry point</span>
    <span class="legend-item"><span class="legend-box missing"></span>Missing circuit</span>
    <span class="legend-item"><span class="legend-line normal"></span>Reference</span>
    <span class="legend-item"><span class="legend-line missing"></span>Missing ref</span>
    <span class="legend-item"><span class="legend-line cycle"></span>Cycle</span>
  </footer>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const NODE_W = 160;
    const NODE_H = 48;
    const SVG_NS = 'http://www.w3.org/2000/svg';

    const viewport = document.getElementById('viewport');
    const canvas = document.getElementById('canvas');
    const banner = document.getElementById('banner');
    const emptyEl = document.getElementById('empty');
    const sidebar = document.getElementById('sidebar');
    const searchInput = document.getElementById('search');

    let transform = { x: 0, y: 0, scale: 1 };
    let lastNodeKey = '';
    let contentSize = { width: 0, height: 0 };
    let searchTimer;

    function applyTransform() {
      viewport.setAttribute(
        'transform',
        'translate(' + transform.x + ',' + transform.y + ') scale(' + transform.scale + ')'
      );
    }

    function fitToScreen() {
      const rect = canvas.getBoundingClientRect();
      if (contentSize.width === 0 || contentSize.height === 0) return;
      const scale = Math.min(
        rect.width / contentSize.width,
        rect.height / contentSize.height,
        1.5
      );
      transform = {
        scale,
        x: (rect.width - contentSize.width * scale) / 2,
        y: (rect.height - contentSize.height * scale) / 2,
      };
      applyTransform();
    }

    document.getElementById('fit').addEventListener('click', fitToScreen);

    let panning = false;
    let panStart = { x: 0, y: 0 };
    canvas.addEventListener('mousedown', (e) => {
      if (e.target === searchInput) return;
      panning = true;
      canvas.classList.add('panning');
      panStart = { x: e.clientX - transform.x, y: e.clientY - transform.y };
    });
    window.addEventListener('mousemove', (e) => {
      if (!panning) return;
      transform.x = e.clientX - panStart.x;
      transform.y = e.clientY - panStart.y;
      applyTransform();
    });
    window.addEventListener('mouseup', () => {
      panning = false;
      canvas.classList.remove('panning');
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      transform.x = mx - (mx - transform.x) * factor;
      transform.y = my - (my - transform.y) * factor;
      transform.scale *= factor;
      applyTransform();
    }, { passive: false });

    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        vscode.postMessage({ type: 'search', query: searchInput.value });
      }, 200);
    });

    function el(tag, attrs, parent) {
      const node = document.createElementNS(SVG_NS, tag);
      for (const key in attrs) node.setAttribute(key, attrs[key]);
      if (parent) parent.appendChild(node);
      return node;
    }

    function renderSidebar(data) {
      sidebar.innerHTML = '';
      const parts = [];

      if (data.missingReferences && data.missingReferences.length > 0) {
        parts.push('<div class="section"><span class="label">Missing:</span>' +
          data.missingReferences.join(', ') + '</div>');
      }
      if (data.cycles && data.cycles.length > 0) {
        const cycleText = data.cycles.map((c) => c.nodeIds.join(' → ')).join(' · ');
        parts.push('<div class="section"><span class="label">Cycles:</span>' + cycleText + '</div>');
      }
      sidebar.innerHTML = parts.join('');
    }

    function render(data) {
      document.getElementById('project').textContent = data.projectDisplayName || '';

      if (data.banner) {
        banner.style.display = 'block';
        banner.textContent = data.banner;
      } else if (data.warnings && data.warnings.length > 0) {
        banner.style.display = 'block';
        banner.textContent = data.warnings.join(' ');
      } else {
        banner.style.display = 'none';
      }

      renderSidebar(data);
      viewport.innerHTML = '';

      if (!data.nodes || data.nodes.length === 0) {
        emptyEl.style.display = 'block';
        emptyEl.textContent = data.searchQuery
          ? 'No circuits match the current filter.'
          : 'No circuits found in this project.';
        return;
      }
      emptyEl.style.display = 'none';

      const positions = data.positions;
      contentSize = { width: data.width, height: data.height };

      for (const edge of data.edges) {
        const from = positions[edge.from];
        const to = positions[edge.to];
        if (!from || !to) continue;

        const x1 = from.x + NODE_W / 2;
        const y1 = from.y + NODE_H;
        const x2 = to.x + NODE_W / 2;
        const y2 = to.y;
        const midY = (y1 + y2) / 2;

        const classes = ['edge'];
        if (edge.isMissing) classes.push('missing');
        if (edge.inCycle) classes.push('cycle');

        const marker = edge.inCycle ? 'arrow-cycle' : (edge.isMissing ? 'arrow-missing' : 'arrow');

        el('path', {
          d: 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + midY + ', ' + x2 + ' ' + midY + ', ' + x2 + ' ' + y2,
          class: classes.join(' '),
          'marker-end': 'url(#' + marker + ')',
        }, viewport);
      }

      for (const node of data.nodes) {
        const pos = positions[node.id];
        if (!pos) continue;

        const classes = ['node'];
        if (node.isEntryPoint) classes.push('entry');
        if (node.isMissing) classes.push('missing');

        const group = el('g', {
          class: classes.join(' '),
          transform: 'translate(' + pos.x + ',' + pos.y + ')',
        }, viewport);

        el('rect', { width: NODE_W, height: NODE_H, rx: 6 }, group);

        const name = el('text', { x: 10, y: 28 }, group);
        name.textContent = node.name.length > 20 ? node.name.slice(0, 19) + '…' : node.name;

        if (node.isEntryPoint) {
          const badge = el('text', { x: NODE_W - 36, y: 16, class: 'badge' }, group);
          badge.textContent = 'IN';
        }

        const tooltip = document.createElementNS(SVG_NS, 'title');
        const paths = (node.definitionPaths || []).map((p) => p.filePath).join('\\n');
        tooltip.textContent = node.isMissing
          ? "Missing circuit '" + node.name + "'"
          : node.name + (paths ? '\\n' + paths : '');
        group.appendChild(tooltip);

        if (!node.isMissing) {
          group.addEventListener('click', () => {
            vscode.postMessage({ type: 'openCircuit', circuitName: node.name });
          });
        }
      }

      const nodeKey = data.nodes.map((n) => n.id).sort().join('|');
      if (nodeKey !== lastNodeKey) {
        lastNodeKey = nodeKey;
        fitToScreen();
      }
    }

    window.addEventListener('message', (event) => {
      if (event.data.type === 'graphData') {
        if (typeof event.data.searchQuery === 'string' && searchInput.value !== event.data.searchQuery) {
          searchInput.value = event.data.searchQuery;
        }
        render(event.data);
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
