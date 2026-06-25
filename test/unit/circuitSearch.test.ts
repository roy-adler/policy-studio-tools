import path from 'path';
import { describe, expect, it, beforeAll } from 'vitest';
import { buildCircuitIndex } from '../../src/features/circuitSearch/circuitIndex';
import { searchCircuits } from '../../src/features/circuitSearch/searchCircuits';
import type { PolicyStudioProject } from '../../src/features/projectRegistry/types';

const fixturesDir = path.join(__dirname, '..', 'fixtures', 'circuit-search');

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

describe('buildCircuitIndex', () => {
  it('indexes circuits from minimal fixture', async () => {
    const project = xmlProject(
      'minimal',
      path.join(fixturesDir, 'minimal'),
    );
    const index = await buildCircuitIndex(project);

    expect(index.filesScanned).toBeGreaterThanOrEqual(3);
    expect(index.circuitByName.has('PaymentService')).toBe(true);
    expect(index.circuitByName.has('AuthCircuit')).toBe(true);
    expect(index.circuitByName.has('OrderAPI')).toBe(true);
  });

  it('records invalid XML files without aborting', async () => {
    const project = xmlProject(
      'invalid-xml',
      path.join(fixturesDir, 'invalid-xml'),
    );
    const index = await buildCircuitIndex(project);

    expect(index.invalidFiles.length).toBeGreaterThanOrEqual(1);
    expect(index.circuitByName.has('ValidCircuit')).toBe(true);
  });
});

describe('searchCircuits', () => {
  const minimalProject = xmlProject('minimal', path.join(fixturesDir, 'minimal'));

  it('finds exact circuit name match', async () => {
    const result = await searchCircuits([minimalProject], 'PaymentService');

    expect(result.results.length).toBeGreaterThanOrEqual(1);
    const hit = result.results.find((r) => r.matchKind === 'circuitName');
    expect(hit).toBeDefined();
    expect(hit?.circuitName).toBe('PaymentService');
    expect(hit?.filePath).toContain('PaymentService.xml');
  });

  it('finds filter name match', async () => {
    const result = await searchCircuits([minimalProject], 'RunPaymentScript');

    const hit = result.results.find((r) => r.matchKind === 'filterName');
    expect(hit).toBeDefined();
    expect(hit?.filterName).toBe('RunPaymentScript');
    expect(hit?.circuitName).toBe('PaymentService');
  });

  it('finds attribute name match', async () => {
    const result = await searchCircuits([minimalProject], 'transactionId');

    const hit = result.results.find((r) => r.matchKind === 'attribute');
    expect(hit).toBeDefined();
    expect(hit?.filterName).toBe('SetTransactionId');
  });

  it('finds substring in policy XML content', async () => {
    const result = await searchCircuits([minimalProject], 'validateCard');

    const hit = result.results.find((r) => r.matchKind === 'xmlContent' || r.matchKind === 'script');
    expect(hit).toBeDefined();
    expect(hit?.matchPreview.toLowerCase()).toContain('validatecard');
  });

  it('finds substring in script content', async () => {
    const result = await searchCircuits([minimalProject], 'processPayment');

    const hit = result.results.find((r) => r.matchKind === 'script');
    expect(hit).toBeDefined();
    expect(hit?.matchPreview).toContain('processPayment');
  });

  it('finds referenced circuit name', async () => {
    const result = await searchCircuits([minimalProject], 'AuthCircuit');

    const refHit = result.results.find((r) => r.matchKind === 'referencedCircuit');
    expect(refHit).toBeDefined();
    expect(refHit?.referencedCircuit).toBe('AuthCircuit');
    expect(refHit?.filterName).toBe('CallAuth');
  });

  it('includes file path, circuit name, filter name, and preview on each result', async () => {
    const result = await searchCircuits([minimalProject], 'SetTransactionId');

    expect(result.results.length).toBeGreaterThan(0);
    for (const row of result.results) {
      expect(row.filePath).toBeTruthy();
      expect(row.circuitName).toBeTruthy();
      expect(row.matchPreview).toBeTruthy();
      expect(row.matchKind).toBeTruthy();
      expect(row.jumpTarget).toBeDefined();
    }
  });

  it('returns duplicate circuit names as separate rows', async () => {
    const project = xmlProject(
      'ambiguous',
      path.join(fixturesDir, 'ambiguous-names'),
    );
    const result = await searchCircuits([project], 'SharedAuth');

    const circuitHits = result.results.filter((r) => r.matchKind === 'circuitName');
    expect(circuitHits.length).toBe(2);
    expect(new Set(circuitHits.map((r) => r.filePath)).size).toBe(2);
  });

  it('reports invalid XML files in summary', async () => {
    const project = xmlProject(
      'invalid-xml',
      path.join(fixturesDir, 'invalid-xml'),
    );
    const result = await searchCircuits([project], 'requestId');

    expect(result.summary.filesSkipped).toBeGreaterThanOrEqual(1);
    expect(result.results.some((r) => r.circuitName === 'ValidCircuit')).toBe(true);
  });

  it('falls back to plain-text search in invalid XML files', async () => {
    const project = xmlProject(
      'invalid-xml',
      path.join(fixturesDir, 'invalid-xml'),
    );
    const result = await searchCircuits([project], 'BrokenFilter');

    const textHit = result.results.find(
      (r) => r.filePath.includes('BadPolicy.xml') && r.matchPreview.includes('BrokenFilter'),
    );
    expect(textHit).toBeDefined();
  });

  it('returns empty results for whitespace-only query', async () => {
    const result = await searchCircuits([minimalProject], '   ');
    expect(result.results).toHaveLength(0);
    expect(result.summary.emptyQuery).toBe(true);
  });

  it('searches YAML policy projects', async () => {
    const project = yamlProject(
      'yaml',
      path.join(fixturesDir, 'yaml-project'),
    );
    const result = await searchCircuits([project], 'YamlPaymentService');

    const hit = result.results.find((r) => r.matchKind === 'circuitName');
    expect(hit).toBeDefined();
    expect(hit?.circuitName).toBe('YamlPaymentService');
  });

  it('includes projectDisplayName when multiple projects in scope', async () => {
    const projectA = xmlProject('minimal', path.join(fixturesDir, 'minimal'));
    const projectB = yamlProject('yaml', path.join(fixturesDir, 'yaml-project'));
    projectA.displayName = 'XML Minimal';
    projectB.displayName = 'YAML Project';

    const result = await searchCircuits([projectA, projectB], 'Auth');

    expect(result.results.length).toBeGreaterThan(0);
    for (const row of result.results) {
      expect(row.projectDisplayName).toBeTruthy();
    }
  });
});

describe('searchCircuits performance', () => {
  const largeDir = path.join(fixturesDir, 'large');

  beforeAll(async () => {
    const fs = await import('fs/promises');
    await fs.mkdir(path.join(largeDir, 'policies'), { recursive: true });
    await fs.writeFile(
      path.join(largeDir, 'PrimaryStore.xml'),
      '<?xml version="1.0"?><EntityStore></EntityStore>',
    );

    for (let i = 0; i < 500; i++) {
      const filePath = path.join(largeDir, 'policies', `Circuit${i}.xml`);
      try {
        await fs.access(filePath);
      } catch {
        await fs.writeFile(
          filePath,
          `<?xml version="1.0"?><Circuit name="PerfCircuit${i}"><Filter name="Filter${i}" type="SetAttribute"><attribute attributeName="attr${i}"/></Filter></Circuit>`,
        );
      }
    }
  });

  it('completes re-search on large fixture within 5 seconds', async () => {
    const project = xmlProject('large', largeDir);
    const index = await buildCircuitIndex(project);

    const start = Date.now();
    const result = await searchCircuits([project], 'PerfCircuit250', { cachedIndex: index });
    const duration = Date.now() - start;

    expect(result.results.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(5000);
  });
});

/**
 * Integration test (VS Code host): manual test plan
 * 1. Open test/fixtures/circuit-search/minimal in VS Code
 * 2. Run "Policy Studio: Search Circuits"
 * 3. Enter "PaymentService" and confirm result opens PaymentService.xml with highlight
 */
