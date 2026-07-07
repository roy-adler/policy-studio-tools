import type { PolicyDiffReport } from './types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderList(title: string, items: string[]): string {
  if (items.length === 0) {
    return '';
  }
  return `<section><h3>${escapeHtml(title)}</h3><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>`;
}

export function renderPolicyDiffReportHtml(report: PolicyDiffReport): string {
  const summaryItems = [
    `${report.summary.addedCircuits} added circuit(s)`,
    `${report.summary.removedCircuits} removed circuit(s)`,
    `${report.summary.modifiedCircuits} modified circuit(s)`,
    `${report.summary.scriptChanges} script change(s)`,
    `${report.summary.pathChanges} path change(s)`,
    `${report.summary.urlChanges} URL change(s)`,
    `${report.summary.referenceChanges} reference change(s)`,
    `${report.summary.leftOnlyFiles} file(s) only in left`,
    `${report.summary.rightOnlyFiles} file(s) only in right`,
  ];

  const added = report.addedCircuits.map(
    (entry) => `${entry.circuitName} (${entry.sourceFilePath})`,
  );
  const removed = report.removedCircuits.map(
    (entry) => `${entry.circuitName} (${entry.sourceFilePath})`,
  );

  const modifiedSections = report.modifiedCircuits.map((circuit) => {
    const lines: string[] = [`<strong>${escapeHtml(circuit.circuitName)}</strong> — ${escapeHtml(circuit.sourceFilePath)}`];

    for (const change of circuit.filterChanges) {
      lines.push(`Filter ${change.kind}: ${change.filterName}`);
    }
    for (const change of circuit.scriptChanges) {
      lines.push(
        `Script ${change.filterName}: <code>${escapeHtml(change.before)}</code> → <code>${escapeHtml(change.after)}</code>`,
      );
    }
    for (const change of circuit.pathChanges) {
      lines.push(
        `Path ${change.filterName}: <code>${escapeHtml(change.before)}</code> → <code>${escapeHtml(change.after)}</code>`,
      );
    }
    for (const change of circuit.urlChanges) {
      lines.push(
        `URL ${change.filterName}: <code>${escapeHtml(change.before)}</code> → <code>${escapeHtml(change.after)}</code>`,
      );
    }
    for (const change of circuit.referenceChanges) {
      lines.push(
        `References ${change.filterName}: ${escapeHtml(change.before.join(', ') || '(none)')} → ${escapeHtml(change.after.join(', ') || '(none)')}`,
      );
    }

    return `<li>${lines.join('<br/>')}</li>`;
  });

  const warnings = [
    ...report.unparseableLeft.map((file) => `Left unparseable: ${file}`),
    ...report.unparseableRight.map((file) => `Right unparseable: ${file}`),
    ...report.leftOnlyFiles.map((file) => `Left only: ${file}`),
    ...report.rightOnlyFiles.map((file) => `Right only: ${file}`),
  ];

  const identicalBanner = report.identical
    ? '<p class="identical">No semantic differences detected.</p>'
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 16px;
    }
    h1 { font-size: 18px; margin: 0 0 8px; }
    h2 { font-size: 14px; margin: 16px 0 8px; opacity: 0.85; }
    h3 { font-size: 13px; margin: 12px 0 6px; }
    .meta { opacity: 0.75; font-size: 12px; margin-bottom: 12px; }
    .note { font-size: 12px; opacity: 0.8; margin: 8px 0 16px; }
    .identical { color: var(--vscode-testing-iconPassed, #3fb950); font-weight: 600; }
    ul { margin: 0; padding-left: 20px; }
    li { margin-bottom: 8px; line-height: 1.4; }
    code {
      font-family: var(--vscode-editor-font-family);
      background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.15));
      padding: 1px 4px;
      border-radius: 3px;
      word-break: break-word;
    }
    section { margin-bottom: 16px; }
  </style>
</head>
<body>
  <h1>Policy diff</h1>
  <div class="meta">${escapeHtml(report.leftLabel)} → ${escapeHtml(report.rightLabel)}</div>
  <p class="note">${escapeHtml(report.formattingOnlyNote)}</p>
  ${identicalBanner}
  <h2>Summary</h2>
  <ul>${summaryItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
  ${renderList('Added circuits', added)}
  ${renderList('Removed circuits', removed)}
  ${modifiedSections.length > 0 ? `<section><h3>Modified circuits</h3><ul>${modifiedSections.join('')}</ul></section>` : ''}
  ${renderList('Warnings', warnings)}
</body>
</html>`;
}

export function getPolicyDiffPanelHtml(nonce: string): string {
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
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 16px;
    }
  </style>
</head>
<body>
  <p>Loading policy diff…</p>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
