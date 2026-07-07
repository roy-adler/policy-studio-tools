export function getFlowPanelHtml(nonce: string): string {
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
    }
    header .title { font-weight: 600; }
    header .project { opacity: 0.75; font-size: 12px; }
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
    .node.start rect { stroke: var(--vscode-focusBorder, #0969da); stroke-width: 2.5; }
    .node.unreachable { opacity: 0.5; }
    .node.missing rect { stroke-dasharray: 5 4; stroke: var(--failure-color); }
    .node text { fill: var(--vscode-foreground); font-size: 12px; pointer-events: none; }
    .node .type { font-size: 10px; opacity: 0.7; }
    .node .badge { font-size: 10px; font-weight: 700; }
    .node .ref-link { font-size: 10px; fill: var(--vscode-textLink-foreground); cursor: pointer; pointer-events: all; }
    .edge.success { stroke: var(--success-color); }
    .edge.failure { stroke: var(--failure-color); stroke-dasharray: 7 4; }
    .edge.dangling { opacity: 0.7; }
    .edge { stroke-width: 2; fill: none; }
    .terminal-bar { stroke: var(--vscode-foreground); stroke-width: 3; opacity: 0.6; }
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
    .legend-line.success { border-color: var(--success-color); }
    .legend-line.failure { border-color: var(--failure-color); border-top-style: dashed; }
    .legend-box { display: inline-block; width: 14px; height: 10px; border: 1.5px solid; border-radius: 2px; }
    .legend-box.start { border-color: var(--vscode-focusBorder, #0969da); border-width: 2px; }
    .legend-box.missing { border-color: var(--failure-color); border-style: dashed; }
    .legend-box.unreachable { border-color: var(--vscode-panel-border); opacity: 0.5; }
  </style>
</head>
<body>
  <header>
    <span class="title" id="title"></span>
    <span class="project" id="project"></span>
    <button id="fit">Fit to screen</button>
  </header>
  <div id="banner"></div>
  <div id="empty"></div>
  <div id="canvas">
    <svg id="svg">
      <defs>
        <marker id="arrow-success" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--success-color)"/>
        </marker>
        <marker id="arrow-failure" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 L 3 5 z" fill="var(--failure-color)"/>
        </marker>
      </defs>
      <g id="viewport"></g>
    </svg>
  </div>
  <footer>
    <span class="legend-item"><span class="legend-line success"></span>Success path</span>
    <span class="legend-item"><span class="legend-line failure"></span>Failure path</span>
    <span class="legend-item"><span class="legend-box start"></span>Start filter</span>
    <span class="legend-item"><span class="legend-box missing"></span>Missing target</span>
    <span class="legend-item"><span class="legend-box unreachable"></span>Unreachable</span>
  </footer>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const NODE_W = 180;
    const NODE_H = 56;
    const SVG_NS = 'http://www.w3.org/2000/svg';

    const viewport = document.getElementById('viewport');
    const canvas = document.getElementById('canvas');
    const banner = document.getElementById('banner');
    const emptyEl = document.getElementById('empty');

    let transform = { x: 0, y: 0, scale: 1 };
    let lastNodeKey = '';
    let contentSize = { width: 0, height: 0 };

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

    function el(tag, attrs, parent) {
      const node = document.createElementNS(SVG_NS, tag);
      for (const key in attrs) node.setAttribute(key, attrs[key]);
      if (parent) parent.appendChild(node);
      return node;
    }

    function render(data) {
      document.getElementById('title').textContent = data.circuitName;
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

      viewport.innerHTML = '';

      if (!data.nodes || data.nodes.length === 0) {
        emptyEl.style.display = 'block';
        emptyEl.textContent = 'This policy contains no filters.';
        return;
      }
      emptyEl.style.display = 'none';

      const positions = data.positions;
      contentSize = { width: data.width, height: data.height };

      // Edges below nodes.
      for (const edge of data.edges) {
        const from = positions[edge.from];
        const to = positions[edge.to];
        if (!from || !to) continue;

        // Offset parallel success/failure edges between the same pair.
        const hasSibling = data.edges.some(
          (other) => other !== edge && other.from === edge.from && other.to === edge.to
        );
        const dx = hasSibling ? (edge.kind === 'success' ? -10 : 10) : 0;

        const x1 = from.x + NODE_W / 2 + dx;
        const y1 = from.y + NODE_H;
        const x2 = to.x + NODE_W / 2 + dx;
        const y2 = to.y;
        const midY = (y1 + y2) / 2;

        const path = el('path', {
          d: 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + midY + ', ' + x2 + ' ' + midY + ', ' + x2 + ' ' + y2,
          class: 'edge ' + edge.kind + (edge.dangling ? ' dangling' : ''),
          'marker-end': 'url(#arrow-' + edge.kind + ')',
        }, viewport);
        const title = document.createElementNS(SVG_NS, 'title');
        title.textContent = edge.kind === 'success' ? 'Success path' : 'Failure path';
        path.appendChild(title);
      }

      for (const node of data.nodes) {
        const pos = positions[node.id];
        if (!pos) continue;

        const classes = ['node'];
        if (node.isStart) classes.push('start');
        if (!node.reachable) classes.push('unreachable');
        if (node.missing) classes.push('missing');

        const group = el('g', {
          class: classes.join(' '),
          transform: 'translate(' + pos.x + ',' + pos.y + ')',
        }, viewport);

        el('rect', { width: NODE_W, height: NODE_H, rx: 6 }, group);

        const name = el('text', { x: 10, y: 22 }, group);
        name.textContent = node.name.length > 24 ? node.name.slice(0, 23) + '…' : node.name;

        const typeText = el('text', { x: 10, y: 40, class: 'type' }, group);
        typeText.textContent = node.missing
          ? 'Missing filter'
          : (node.filterType || 'Filter') + (!node.reachable ? ' · unreachable' : '');

        if (node.isStart) {
          const badge = el('text', { x: NODE_W - 42, y: 16, class: 'badge' }, group);
          badge.textContent = 'START';
        }

        if (node.isTerminal && !node.missing) {
          el('line', {
            x1: 24, y1: NODE_H + 6, x2: NODE_W - 24, y2: NODE_H + 6,
            class: 'terminal-bar',
          }, group);
        }

        if (node.circuitRef) {
          const ref = el('text', { x: 10, y: 52, class: 'ref-link' }, group);
          ref.textContent = '↗ Open ' + node.circuitRef;
          ref.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'openCircuit', circuitName: node.circuitRef });
          });
        }

        const tooltip = document.createElementNS(SVG_NS, 'title');
        tooltip.textContent = node.missing
          ? "Link target '" + node.name + "' is not defined in this circuit"
          : node.name + (node.filterType ? ' (' + node.filterType + ')' : '');
        group.appendChild(tooltip);

        if (!node.missing) {
          group.addEventListener('click', () => {
            vscode.postMessage({ type: 'openFilter', nodeId: node.id });
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
      if (event.data.type === 'flowData') {
        render(event.data);
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
