import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { discoverServicePaths } from '../../src/features/pathSearch/discoverServicePaths';
import { PathInventoryCache } from '../../src/features/pathSearch/pathInventoryCache';
import { loadPathInventory } from '../../src/features/pathSearch/loadPathInventory';
import { resolveServicePathCircuitName } from '../../src/features/pathSearch/resolveServicePathCircuitName';
import { searchPaths } from '../../src/features/pathSearch/searchPaths';
import {
  decodeFilenameTokens,
  parseFilenameKeyFields,
  stripCollisionSuffix,
} from '../../src/features/pathSearch/filenameTokens';
import { parseServicePathYaml } from '../../src/features/pathSearch/parseServicePathYaml';
import { PATH_SEARCH_TOOL } from '../../src/features/pathSearch/toolDescriptor';
import type { PolicyStudioProject } from '../../src/features/projectRegistry/types';

const yamlRoot = path.join(__dirname, '..', 'fixtures', 'path-search', 'yaml-project');

function project(id: string, rootPath: string, displayName: string): PolicyStudioProject {
  return {
    id,
    rootPath,
    workspaceFolder: rootPath,
    relativePath: displayName,
    displayName,
    projectType: 'yaml',
  };
}

describe('filenameTokens', () => {
  it('decodes Axway filesystem tokens', () => {
    expect(decodeFilenameTokens('(slash)api(slash)orders')).toBe('/api/orders');
    expect(decodeFilenameTokens('(asterisk)')).toBe('*');
    expect(decodeFilenameTokens('http(colon)(slash)(slash)x')).toBe('http://x');
  });

  it('strips trailing collision suffix before key split', () => {
    expect(stripCollisionSuffix('(slash)api(slash)orders,GET 1')).toBe(
      '(slash)api(slash)orders,GET',
    );
    expect(stripCollisionSuffix('(slash),(asterisk)')).toBe('(slash),(asterisk)');
  });

  it('parses method and matcher from comma key fields', () => {
    expect(parseFilenameKeyFields('(slash),(asterisk)')).toEqual({
      keys: ['/', '*'],
      uriMatcher: '*',
    });
    expect(parseFilenameKeyFields('(slash)api(slash)orders,GET')).toEqual({
      keys: ['/api/orders', 'GET'],
      httpMethod: 'GET',
    });
    expect(parseFilenameKeyFields('(slash)api(slash)orders,GET 1')).toEqual({
      keys: ['/api/orders', 'GET'],
      httpMethod: 'GET',
    });
  });
});

describe('parseServicePathYaml', () => {
  it('parses uriprefix, filterCircuit, and filename method/matcher', () => {
    const filePath = path.join(
      yamlRoot,
      'Environment Configuration',
      'Service',
      'Name_One Interface',
      '(slash),(asterisk).yaml',
    );
    const content = fs.readFileSync(filePath, 'utf8');
    const { entry, warning } = parseServicePathYaml(
      content,
      filePath,
      project('p1', yamlRoot, 'yaml-project'),
      'Name_One Interface',
    );
    expect(warning).toBeUndefined();
    expect(entry?.uriPrefix).toBe('/');
    expect(entry?.filterCircuit).toBe('/Policies/Commons/JWT/JWT verify');
    expect(entry?.uriMatcher).toBe('*');
    expect(entry?.uriPrefixRange.start.line).toBeGreaterThanOrEqual(0);
    expect(content.split(/\r?\n/)[entry!.uriPrefixRange.start.line]).toMatch(/uriprefix:/);
  });

  it('skips non-XMLFirewall scaffolding', () => {
    const filePath = path.join(yamlRoot, 'Environment Configuration', 'Service', '_parent.yaml');
    const content = fs.readFileSync(filePath, 'utf8');
    const result = parseServicePathYaml(
      content,
      filePath,
      project('p1', yamlRoot, 'yaml-project'),
      'Service',
    );
    expect(result.entry).toBeUndefined();
    expect(result.skipped).toBe(true);
  });
});

describe('discoverServicePaths', () => {
  it('finds nested and root-level listeners and skips _parent and solpacks', () => {
    const { entries, warnings } = discoverServicePaths([project('p1', yamlRoot, 'yaml-project')]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(entries).toHaveLength(4);
    expect(entries.map((e) => e.uriPrefix).sort()).toEqual([
      '/',
      '/api/orders',
      '/api/orders',
      '/root-health',
    ]);
    expect(entries.find((e) => e.uriPrefix === '/root-health')?.interfaceName).toBe('Service');
    const methods = entries.filter((e) => e.httpMethod === 'GET');
    expect(methods).toHaveLength(2);
  });

  it('warns for malformed YAML and continues discovering valid listeners', () => {
    const { entries, warnings } = discoverServicePaths([project('p1', yamlRoot, 'yaml-project')]);
    expect(warnings.some((warning) => warning.includes('invalid-listener.yaml'))).toBe(true);
    expect(entries.some((entry) => entry.uriPrefix === '/api/orders')).toBe(true);
  });

  it('attributes the same uriPrefix to each owning project', () => {
    const two = path.join(__dirname, '..', 'fixtures', 'path-search', 'two-projects');
    const { entries } = discoverServicePaths([
      project('a', path.join(two, 'gateway-a'), 'gateway-a'),
      project('b', path.join(two, 'gateway-b'), 'gateway-b'),
    ]);
    const shared = entries.filter((e) => e.uriPrefix === '/shared');
    expect(shared).toHaveLength(2);
    expect(shared.map((e) => e.projectDisplayName).sort()).toEqual(['gateway-a', 'gateway-b']);
  });
});

describe('searchPaths', () => {
  const inventory = () => discoverServicePaths([project('p1', yamlRoot, 'yaml-project')]).entries;

  it('returns full catalog for empty query', () => {
    expect(searchPaths(inventory(), '   ')).toHaveLength(4);
  });

  it('filters by uriPrefix substring', () => {
    const hits = searchPaths(inventory(), 'api/orders');
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.uriPrefix.includes('/api/orders'))).toBe(true);
  });

  it('filters by project display name and circuit', () => {
    expect(searchPaths(inventory(), 'yaml-project').length).toBe(4);
    expect(searchPaths(inventory(), 'JWT verify')).toHaveLength(1);
    expect(searchPaths(inventory(), 'GET').length).toBeGreaterThanOrEqual(2);
  });

  it('sorts by uriPrefix then project then filePath', () => {
    const sorted = searchPaths(inventory(), '');
    const keys = sorted.map((e) => `${e.uriPrefix}|${e.projectDisplayName}|${e.filePath}`);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
  });
});

describe('PathInventoryCache', () => {
  it('reuses discovery until explicitly rebuilt or invalidated', () => {
    let discoveries = 0;
    const cache = new PathInventoryCache((projects) => {
      discoveries += 1;
      return { entries: [], warnings: [`scan ${discoveries}: ${projects.length}`] };
    });
    const projects = [project('p1', yamlRoot, 'yaml-project')];

    expect(cache.get(projects).warnings).toEqual(['scan 1: 1']);
    expect(cache.get(projects).warnings).toEqual(['scan 1: 1']);
    expect(discoveries).toBe(1);

    expect(cache.rebuild(projects).warnings).toEqual(['scan 2: 1']);
    cache.invalidate();
    expect(cache.get(projects).warnings).toEqual(['scan 3: 1']);
    expect(discoveries).toBe(3);
  });
});

describe('path search navigation', () => {
  it('normalizes a fully qualified filterCircuit to its circuit name', () => {
    expect(resolveServicePathCircuitName('/Policies/Commons/JWT/JWT verify')).toBe('JWT verify');
    expect(resolveServicePathCircuitName('  ./Local circuit  ')).toBe('Local circuit');
    expect(resolveServicePathCircuitName()).toBeUndefined();
  });
});

describe('loadPathInventory', () => {
  it('scans all provided projects', () => {
    const two = path.join(__dirname, '..', 'fixtures', 'path-search', 'two-projects');
    const response = loadPathInventory([
      project('a', path.join(two, 'gateway-a'), 'gateway-a'),
      project('b', path.join(two, 'gateway-b'), 'gateway-b'),
    ]);
    expect(response.projectsScanned).toBe(2);
    expect(response.results.filter((r) => r.uriPrefix === '/shared')).toHaveLength(2);
  });
});

describe('path search tool', () => {
  it('registers Search paths in Navigate order 3', () => {
    expect(PATH_SEARCH_TOOL.command).toBe('policyStudioTools.searchPaths');
    expect(PATH_SEARCH_TOOL.label).toBe('Search paths');
    expect(PATH_SEARCH_TOOL.iconId).toBe('list-filter');
    expect(PATH_SEARCH_TOOL.group).toBe('navigate');
    expect(PATH_SEARCH_TOOL.order).toBe(3);
    expect(PATH_SEARCH_TOOL.available).toBe(true);
  });
});
