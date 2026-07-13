import path from 'path';
import { describe, expect, it } from 'vitest';
import { buildCircuitIndex } from '../../src/features/circuitSearch/circuitIndex';
import { buildDocumentationModel } from '../../src/features/exportDocumentation/buildDocumentationModel';
import {
  renderDocumentationMarkdown,
  slugForAnchor,
} from '../../src/features/exportDocumentation/markdownRenderer';
import { EXPORT_DOCUMENTATION_TOOL } from '../../src/features/exportDocumentation/toolDescriptor';
import type { PolicyStudioProject } from '../../src/features/projectRegistry/types';

const fixturesDir = path.join(__dirname, '..', 'fixtures', 'export-documentation');

function xmlProject(name: string, rootPath: string): PolicyStudioProject {
  return {
    id: `test-${name}`,
    rootPath,
    workspaceFolder: rootPath,
    relativePath: '',
    displayName: name,
    projectType: 'xml',
  };
}

function yamlProject(name: string, rootPath: string): PolicyStudioProject {
  return {
    id: `test-${name}`,
    rootPath,
    workspaceFolder: rootPath,
    relativePath: '',
    displayName: name,
    projectType: 'yaml',
  };
}

async function buildModel(fixture: string, projectType: 'xml' | 'yaml' = 'yaml') {
  const rootPath = path.join(fixturesDir, fixture);
  const project =
    projectType === 'yaml' ? yamlProject(fixture, rootPath) : xmlProject(fixture, rootPath);
  const index = await buildCircuitIndex(project);
  return buildDocumentationModel(index, {
    exportedAt: new Date('2026-07-07T12:00:00.000Z'),
    toolVersion: '0.0.1-test',
  });
}

describe('buildDocumentationModel', () => {
  it('builds minimal fixture with path and backend URL', async () => {
    const model = await buildModel('minimal');

    expect(model.metadata.circuitCount).toBe(1);
    expect(model.circuits[0].name).toBe('OrderAPI');
    expect(model.circuits[0].sourceFilePath).toContain('OrderAPI.yaml');
    expect(model.circuits[0].description).toContain('Minimal order API');

    const filter = model.circuits[0].filters[0];
    expect(filter.name).toBe('RouteToBackend');
    expect(filter.routingPaths).toEqual([
      expect.objectContaining({ path: '/orders/{orderId}', method: 'GET' }),
    ]);
    expect(filter.backendUrls).toEqual([
      expect.objectContaining({ url: 'https://api.example.com/orders' }),
    ]);

    expect(model.indices.pathTemplates).toHaveLength(1);
    expect(model.indices.backendUrls).toHaveLength(1);
  });

  it('builds multi-circuit fixture with cross references', async () => {
    const model = await buildModel('multi-circuit');

    expect(model.metadata.circuitCount).toBe(2);
    expect(model.metadata.referenceGraphSummary).toContain('CallerCircuit → AuthCircuit');

    const caller = model.circuits.find((circuit) => circuit.name === 'CallerCircuit');
    expect(caller?.startFilter).toBe('CallAuth');
    expect(caller?.filters.some((filter) => filter.referencedCircuits.includes('AuthCircuit'))).toBe(
      true,
    );
  });

  it('captures short and truncated long scripts', async () => {
    const model = await buildModel('scripts');
    const circuit = model.circuits[0];

    const shortScript = circuit.filters.find((filter) => filter.name === 'ShortScript')?.script;
    expect(shortScript?.truncated).toBe(false);
    expect(shortScript?.content).toContain('validateInput');
    expect(shortScript?.language).toBe('javascript');

    const longScript = circuit.filters.find((filter) => filter.name === 'LongScript')?.script;
    expect(longScript?.truncated).toBe(true);
    expect(longScript?.lineCount).toBeGreaterThan(20);
    expect(longScript?.language).toBe('groovy');
  });

  it('lists message attributes with operation hints', async () => {
    const model = await buildModel('attributes');
    const names = model.indices.attributes.map((entry) => entry.name);

    expect(names).toContain('customerId');
    expect(names).toContain('requestId');

    const customer = model.indices.attributes.find((entry) => entry.name === 'customerId');
    expect(customer?.occurrences.some((occurrence) => occurrence.operation === 'get')).toBe(true);
    expect(customer?.occurrences.some((occurrence) => occurrence.operation === 'set')).toBe(true);
  });

  it('records warnings for invalid files without aborting', async () => {
    const model = await buildModel('invalid');

    expect(model.warnings.some((warning) => warning.includes('BrokenPolicy.yaml'))).toBe(true);
    expect(model.circuits.some((circuit) => circuit.name === 'ValidCircuit')).toBe(true);
  });

  it('builds YAML primary project fixture', async () => {
    const model = await buildModel('yaml-project', 'yaml');

    expect(model.circuits).toHaveLength(1);
    expect(model.circuits[0].name).toBe('Order API');

    const routeFilter = model.circuits[0].filters.find((filter) => filter.name === 'Route Request');
    expect(routeFilter?.routingPaths[0]?.path).toBe('/api/v1/orders/{id}');
    expect(routeFilter?.backendUrls[0]?.url).toBe('https://backend.example.com/api/orders');
  });

  it('filters circuits by name when requested', async () => {
    const rootPath = path.join(fixturesDir, 'multi-circuit');
    const project = yamlProject('multi-circuit', rootPath);
    const index = await buildCircuitIndex(project);
    const model = buildDocumentationModel(index, { circuitNameFilter: ['AuthCircuit'] });

    expect(model.circuits).toHaveLength(1);
    expect(model.circuits[0].name).toBe('AuthCircuit');
  });
});

describe('renderDocumentationMarkdown', () => {
  it('renders table of contents and per-circuit sections without filesystem access', async () => {
    const model = await buildModel('multi-circuit');
    const markdown = renderDocumentationMarkdown(model);

    expect(markdown).toContain('# multi-circuit — Policy Studio Documentation');
    expect(markdown).toContain('## Table of Contents');
    expect(markdown).toContain('[CallerCircuit](#');
    expect(markdown).toContain('## CallerCircuit');
    expect(markdown).toContain('### Filter pipeline');
    expect(markdown).toContain('`Policies/CallerCircuit.yaml`');
    expect(markdown).toContain('### Circuit references');
    expect(markdown).toContain('[AuthCircuit](#authcircuit)');
  });

  it('includes routing, backends, scripts, attributes, and warnings in markdown', async () => {
    const minimal = renderDocumentationMarkdown(await buildModel('minimal'));
    expect(minimal).toContain('### Routing paths');
    expect(minimal).toContain('/orders/{orderId}');
    expect(minimal).toContain('### Backend URLs');
    expect(minimal).toContain('https://api.example.com/orders');
    expect(minimal).toContain('## Appendix: Path templates');

    const scripts = renderDocumentationMarkdown(await buildModel('scripts'));
    expect(scripts).toContain('### Embedded scripts');
    expect(scripts).toContain('```javascript');
    expect(scripts).toContain('Truncated');

    const attributes = renderDocumentationMarkdown(await buildModel('attributes'));
    expect(attributes).toContain('### Message attributes');
    expect(attributes).toContain('`customerId`');

    const invalid = renderDocumentationMarkdown(await buildModel('invalid'));
    expect(invalid).toContain('## Documentation warnings');
    expect(invalid).toContain('BrokenPolicy.yaml');
  });

  it('produces stable heading anchors', () => {
    expect(slugForAnchor('AuthCircuit')).toBe('authcircuit');
    expect(slugForAnchor('Order API')).toBe('order-api');
  });
});

describe('export documentation tool descriptor', () => {
  it('registers export command in Export group', () => {
    expect(EXPORT_DOCUMENTATION_TOOL.group).toBe('export');
    expect(EXPORT_DOCUMENTATION_TOOL.command).toBe('policyStudioTools.exportDocumentation');
    expect(EXPORT_DOCUMENTATION_TOOL.available).toBe(true);
  });
});
