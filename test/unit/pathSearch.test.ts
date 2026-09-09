import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { discoverServicePaths } from '../../src/features/pathSearch/discoverServicePaths';
import {
  decodeFilenameTokens,
  parseFilenameKeyFields,
  stripCollisionSuffix,
} from '../../src/features/pathSearch/filenameTokens';
import { parseServicePathYaml } from '../../src/features/pathSearch/parseServicePathYaml';
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
  it('finds listeners and skips _parent and solpacks', () => {
    const { entries, warnings } = discoverServicePaths([project('p1', yamlRoot, 'yaml-project')]);
    expect(warnings).toEqual([]);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.uriPrefix).sort()).toEqual(['/', '/api/orders', '/api/orders']);
    expect(entries.every((e) => e.interfaceName === 'Name_One Interface')).toBe(true);
    const methods = entries.filter((e) => e.httpMethod === 'GET');
    expect(methods).toHaveLength(2);
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
