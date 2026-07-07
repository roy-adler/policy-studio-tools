import type { DocumentationModel } from './types';

export function slugForAnchor(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function circuitAnchor(circuitName: string, sourceFilePath?: string): string {
  if (!sourceFilePath) {
    return slugForAnchor(circuitName);
  }
  return `${slugForAnchor(circuitName)}--${slugForAnchor(sourceFilePath.replace(/[^\w./-]+/g, '-'))}`;
}

function formatCircuitLink(circuitName: string): string {
  return `[${circuitName}](#${slugForAnchor(circuitName)})`;
}

function renderMetadata(model: DocumentationModel): string {
  const { metadata } = model;
  return [
    '## Metadata',
    '',
    `- **Project:** ${metadata.projectName}`,
    `- **Exported:** ${metadata.exportedAt}`,
    `- **Tool version:** ${metadata.toolVersion}`,
    `- **Workspace:** \`${metadata.workspacePath}\``,
    '',
  ].join('\n');
}

function renderTableOfContents(model: DocumentationModel): string {
  const lines = ['## Table of Contents', ''];
  lines.push('- [Overview](#overview)');

  for (const circuit of model.circuits) {
    const anchor = circuitAnchor(circuit.name, circuit.sourceFilePath);
    lines.push(`- [${circuit.name}](#${anchor})`);
  }

  if (model.indices.pathTemplates.length > 0) {
    lines.push('- [Appendix: Path templates](#appendix-path-templates)');
  }
  if (model.indices.backendUrls.length > 0) {
    lines.push('- [Appendix: Backend URLs](#appendix-backend-urls)');
  }
  if (model.indices.attributes.length > 0) {
    lines.push('- [Appendix: Attributes](#appendix-attributes)');
  }
  if (model.warnings.length > 0) {
    lines.push('- [Documentation warnings](#documentation-warnings)');
  }

  lines.push('');
  return lines.join('\n');
}

function renderOverviewBody(model: DocumentationModel): string {
  const { metadata } = model;
  const lines = [
    `- **Circuits:** ${metadata.circuitCount}`,
    `- **Filters:** ${metadata.filterCount}`,
  ];

  if (metadata.entryPoints.length > 0) {
    lines.push(`- **Entry points:** ${metadata.entryPoints.join(', ')}`);
  } else {
    lines.push('- **Entry points:** none declared');
  }

  lines.push(`- **Reference graph:** ${metadata.referenceGraphSummary}`);

  if (model.circuits.length === 0) {
    lines.push('');
    lines.push('_No circuits found in the current project scope._');
  }

  lines.push('');
  return lines.join('\n');
}

function renderFilterPipeline(circuit: DocumentationModel['circuits'][number]): string {
  const lines = ['### Filter pipeline', ''];
  if (circuit.filters.length === 0) {
    lines.push('_No filters._');
    lines.push('');
    return lines.join('\n');
  }

  for (const filter of circuit.filters) {
    const typeSuffix = filter.type ? ` (${filter.type})` : '';
    lines.push(`${filter.order}. **${filter.name}**${typeSuffix}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderRoutingPaths(circuit: DocumentationModel['circuits'][number]): string {
  const routes = circuit.filters.flatMap((filter) => filter.routingPaths);
  if (routes.length === 0) {
    return '';
  }

  const lines = ['### Routing paths', ''];
  for (const route of routes) {
    const methodPrefix = route.method ? `${route.method} ` : '';
    lines.push(`- ${methodPrefix}\`${route.path}\` — ${route.filterName}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderBackendUrls(circuit: DocumentationModel['circuits'][number]): string {
  const urls = circuit.filters.flatMap((filter) => filter.backendUrls);
  if (urls.length === 0) {
    return '';
  }

  const lines = ['### Backend URLs', ''];
  for (const backend of urls) {
    lines.push(`- \`${backend.url}\` — ${backend.filterName}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderAttributes(circuit: DocumentationModel['circuits'][number]): string {
  const attributes = circuit.filters.flatMap((filter) => filter.attributes);
  if (attributes.length === 0) {
    return '';
  }

  const lines = ['### Message attributes', ''];
  for (const attribute of attributes) {
    lines.push(`- \`${attribute.name}\` — ${attribute.filterName} (${attribute.operation})`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderScripts(circuit: DocumentationModel['circuits'][number]): string {
  const scripts = circuit.filters.flatMap((filter) => (filter.script ? [filter.script] : []));
  if (scripts.length === 0) {
    return '';
  }

  const lines = ['### Embedded scripts', ''];
  for (const script of scripts) {
    const language = script.language ?? '';
    lines.push(`#### ${script.filterName}`);
    if (script.truncated) {
      lines.push(
        `_Truncated (${script.lineCount} lines) — see source file \`${script.sourceFilePath}\`._`,
      );
      lines.push('');
    }
    lines.push('```' + language);
    lines.push(script.content);
    lines.push('```');
    lines.push('');
  }
  return lines.join('\n');
}

function renderReferences(circuit: DocumentationModel['circuits'][number]): string {
  const references = [
    ...new Set(circuit.filters.flatMap((filter) => filter.referencedCircuits)),
  ];
  if (references.length === 0) {
    return '';
  }

  const lines = ['### Circuit references', ''];
  for (const referenced of references.sort()) {
    lines.push(`- ${formatCircuitLink(referenced)}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderCircuitSection(circuit: DocumentationModel['circuits'][number]): string {
  const anchor = circuitAnchor(circuit.name, circuit.sourceFilePath);
  const lines = [`## ${circuit.name}`, `<a id="${anchor}"></a>`, ''];
  lines.push(`- **Source file:** \`${circuit.sourceFilePath}\``);
  if (circuit.startFilter) {
    lines.push(`- **Start filter:** ${circuit.startFilter}`);
  }
  if (circuit.description) {
    lines.push(`- **Description:** ${circuit.description}`);
  }
  lines.push('');
  lines.push(renderFilterPipeline(circuit));
  lines.push(renderRoutingPaths(circuit));
  lines.push(renderBackendUrls(circuit));
  lines.push(renderAttributes(circuit));
  lines.push(renderScripts(circuit));
  lines.push(renderReferences(circuit));
  return lines.join('\n');
}

function renderAppendix(model: DocumentationModel): string {
  const sections: string[] = [];

  if (model.indices.pathTemplates.length > 0) {
    const lines = ['## Appendix: Path templates', '<a id="appendix-path-templates"></a>', ''];
    for (const entry of model.indices.pathTemplates) {
      lines.push(`- \`${entry.path}\` — ${entry.circuitName} / ${entry.filterName}`);
    }
    lines.push('');
    sections.push(lines.join('\n'));
  }

  if (model.indices.backendUrls.length > 0) {
    const lines = ['## Appendix: Backend URLs', '<a id="appendix-backend-urls"></a>', ''];
    for (const entry of model.indices.backendUrls) {
      lines.push(`- \`${entry.url}\` — ${entry.circuitName} / ${entry.filterName}`);
    }
    lines.push('');
    sections.push(lines.join('\n'));
  }

  if (model.indices.attributes.length > 0) {
    const lines = ['## Appendix: Attributes', '<a id="appendix-attributes"></a>', ''];
    for (const entry of model.indices.attributes) {
      const contexts = entry.occurrences
        .map((occurrence) => `${occurrence.circuitName}/${occurrence.filterName} (${occurrence.operation})`)
        .join(', ');
      lines.push(`- \`${entry.name}\` — ${contexts}`);
    }
    lines.push('');
    sections.push(lines.join('\n'));
  }

  return sections.join('\n');
}

function renderWarnings(model: DocumentationModel): string {
  if (model.warnings.length === 0) {
    return '';
  }

  const lines = ['## Documentation warnings', '<a id="documentation-warnings"></a>', ''];
  for (const warning of model.warnings) {
    lines.push(`- ${warning}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function renderDocumentationMarkdown(model: DocumentationModel): string {
  const title = `# ${model.metadata.projectName} — Policy Studio Documentation`;
  const overviewAnchor = '<a id="overview"></a>';

  return [
    title,
    '',
    renderMetadata(model),
    renderTableOfContents(model),
    '## Overview',
    overviewAnchor,
    '',
    renderOverviewBody(model),
    ...model.circuits.map((circuit) => renderCircuitSection(circuit)),
    renderAppendix(model),
    renderWarnings(model),
  ]
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
    .concat('\n');
}
