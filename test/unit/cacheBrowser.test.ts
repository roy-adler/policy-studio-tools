import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  cacheId,
  cacheListHint,
  classifyCacheKind,
  isCacheFieldName,
  isKnownCachingFilterType,
  toYamlPk,
} from '../../src/features/cacheBrowser/cacheIdentity';
import { discoverCaches } from '../../src/features/cacheBrowser/discoverCaches';
import { searchCaches } from '../../src/features/cacheBrowser/searchCaches';
import { parseCacheXml } from '../../src/features/cacheBrowser/parseCacheXml';
import { parseCacheYaml } from '../../src/features/cacheBrowser/parseCacheYaml';
import type { PolicyStudioProject } from '../../src/features/projectRegistry/types';
import type { ParsedCache } from '../../src/features/cacheBrowser/types';

const yamlRoot = path.join(__dirname, '..', 'fixtures', 'cache-browser', 'yaml-project');
const xmlRoot = path.join(__dirname, '..', 'fixtures', 'cache-browser', 'xml-project');

function yamlProject(root = yamlRoot): PolicyStudioProject {
  return {
    id: 'yaml-1',
    rootPath: root,
    workspaceFolder: root,
    relativePath: 'yaml-project',
    displayName: 'yaml-project',
    projectType: 'yaml',
  };
}

function xmlProject(root = xmlRoot): PolicyStudioProject {
  return {
    id: 'xml-1',
    rootPath: root,
    workspaceFolder: root,
    relativePath: 'xml-project',
    displayName: 'xml-project',
    projectType: 'xml',
  };
}

describe('cache identity', () => {
  it('classifies Cache, DistributedCache, and other case-insensitively', () => {
    expect(classifyCacheKind('Cache')).toBe('local');
    expect(classifyCacheKind('cache')).toBe('local');
    expect(classifyCacheKind('DistributedCache')).toBe('distributed');
    expect(classifyCacheKind('WidgetCache')).toBe('other');
  });

  it('recognizes known caching filters with optional Filter suffix', () => {
    expect(isKnownCachingFilterType('CacheAttribute')).toBe(true);
    expect(isKnownCachingFilterType('IsCachedFilter')).toBe(true);
    expect(isKnownCachingFilterType('RemoveCachedAttribute')).toBe(true);
    expect(isKnownCachingFilterType('CompareAttributeFilter')).toBe(false);
  });

  it('treats cache and cacheToUse as cache field names', () => {
    expect(isCacheFieldName('cache')).toBe(true);
    expect(isCacheFieldName('cacheToUse')).toBe(true);
    expect(isCacheFieldName('other')).toBe(false);
  });

  it('builds YamlPK with forward slashes and no extension', () => {
    const filePath = path.join(yamlRoot, 'Libraries', 'Cache Manager', 'CORS Profiles.yaml');
    expect(toYamlPk(yamlRoot, filePath)).toBe('/Libraries/Cache Manager/CORS Profiles');
  });
});

describe('parseCacheYaml', () => {
  const project = yamlProject();

  it('parses a local cache and uses fields.name', () => {
    const content = `---\ntype: Cache\nfields:\n  name: CORS Profiles\n  eternal: true\n`;
    const filePath = path.join(yamlRoot, 'Libraries', 'Cache Manager', 'CORS Profiles.yaml');
    const { cache, warning } = parseCacheYaml(content, filePath, project);
    expect(warning).toBeUndefined();
    expect(cache?.kind).toBe('local');
    expect(cache?.entityType).toBe('Cache');
    expect(cache?.name).toBe('CORS Profiles');
    expect(cache?.fields.eternal).toBe('true');
    expect(cache?.yamlPk).toBe('/Libraries/Cache Manager/CORS Profiles');
    expect(cacheListHint(cache as ParsedCache)).toBe('eternal');
    expect(cacheId(cache as ParsedCache)).toContain(filePath);
  });

  it('parses a distributed cache and TTL hint', () => {
    const content = `---\ntype: DistributedCache\nfields:\n  name: Cron Expression Library\n  timeToLiveSeconds: 600\n`;
    const filePath = path.join(yamlRoot, 'Libraries', 'Cache Manager', 'Cron Expression Library.yaml');
    const { cache } = parseCacheYaml(content, filePath, project);
    expect(cache?.kind).toBe('distributed');
    expect(cacheListHint(cache as ParsedCache)).toBe('TTL 600s');
  });

  it('classifies unknown types as other and omits nested fields', () => {
    const content = `---\ntype: WidgetCache\nfields:\n  name: Custom Store\n  nested:\n    a: 1\n`;
    const filePath = path.join(yamlRoot, 'Libraries', 'Cache Manager', 'Custom Store.yaml');
    const { cache } = parseCacheYaml(content, filePath, project);
    expect(cache?.kind).toBe('other');
    expect(cache?.fields.nested).toBeUndefined();
    expect(cache?.fields.name).toBe('Custom Store');
  });

  it('falls back to basename when fields.name is missing', () => {
    const content = `---\ntype: Cache\nfields:\n  eternal: true\n`;
    const filePath = path.join(yamlRoot, 'Libraries', 'Cache Manager', 'CORS Profiles.yaml');
    const { cache } = parseCacheYaml(content, filePath, project);
    expect(cache?.name).toBe('CORS Profiles');
  });

  it('warns on empty content and invalid YAML', () => {
    const filePath = path.join(yamlRoot, 'Libraries', 'Cache Manager', 'Empty.yaml');
    expect(parseCacheYaml('   \n', filePath, project).warning).toMatch(/empty/i);
    expect(parseCacheYaml('::::', filePath, project).warning).toMatch(/invalid/i);
    expect(parseCacheYaml('::::', filePath, project).cache).toBeUndefined();
  });
});

describe('discoverCaches YAML', () => {
  it('finds local, distributed, and other caches and skips _parent.yaml', () => {
    const { caches, warnings, inventoryPaths } = discoverCaches(yamlProject());
    const names = caches.map((c) => c.name).sort();
    expect(names).toEqual(['CORS Profiles', 'Cron Expression Library', 'Custom Store']);
    expect(caches.find((c) => c.name === 'CORS Profiles')?.kind).toBe('local');
    expect(caches.find((c) => c.name === 'Cron Expression Library')?.kind).toBe('distributed');
    expect(caches.find((c) => c.name === 'Custom Store')?.kind).toBe('other');
    expect(caches.some((c) => c.filePath.endsWith('_parent.yaml'))).toBe(false);
    expect(warnings.some((w) => /empty/i.test(w))).toBe(true);
    expect(inventoryPaths).toHaveLength(3);
  });

  it('returns empty caches when Cache Manager is missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-none-'));
    fs.writeFileSync(path.join(tmp, 'values.yaml'), 'Policies: {}\n');
    fs.mkdirSync(path.join(tmp, 'Policies'));
    const result = discoverCaches(yamlProject(tmp));
    expect(result.caches).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe('parseCacheXml', () => {
  it('parses nested Cache and DistributedCache into the same model and ignores other types', () => {
    const filePath = path.join(xmlRoot, 'PrimaryStore.xml');
    const content = fs.readFileSync(filePath, 'utf8');
    const { caches, warning } = parseCacheXml(content, filePath, xmlProject());
    expect(warning).toBeUndefined();
    expect(caches.map((c) => c.name).sort()).toEqual(['HTTP Sessions', 'OAuth Tokens']);
    expect(caches.find((c) => c.name === 'HTTP Sessions')?.kind).toBe('local');
    expect(caches.find((c) => c.name === 'OAuth Tokens')?.kind).toBe('distributed');
    expect(caches.find((c) => c.name === 'HTTP Sessions')?.yamlPk).toBe(
      '/Libraries/Cache Manager/HTTP Sessions',
    );
    expect(caches.some((c) => c.name === 'Not A Cache' || c.name === 'Lookup')).toBe(false);
  });

  it('warns on invalid XML and returns no caches', () => {
    const { caches, warning } = parseCacheXml(
      '<entity>',
      path.join(xmlRoot, 'broken.xml'),
      xmlProject(),
    );
    expect(caches).toEqual([]);
    expect(warning).toMatch(/invalid xml/i);
  });
});

describe('discoverCaches XML', () => {
  it('finds XML cache entities from PrimaryStore.xml', () => {
    const { caches, inventoryPaths } = discoverCaches(xmlProject());
    expect(caches.map((c) => c.name).sort()).toEqual(['HTTP Sessions', 'OAuth Tokens']);
    expect(inventoryPaths).toEqual([]);
  });

  it('returns an empty inventory for XML with no Cache entities', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-xml-none-'));
    fs.writeFileSync(path.join(tmp, 'PrimaryStore.xml'), '<entityStore></entityStore>\n');
    expect(discoverCaches(xmlProject(tmp)).caches).toEqual([]);
  });
});

describe('searchCaches', () => {
  const caches = discoverCaches(yamlProject()).caches;

  it('returns all caches for empty query', () => {
    expect(searchCaches(caches, '  ').map((c) => c.name)).toEqual(caches.map((c) => c.name));
  });

  it('matches name, kind, type, and field values', () => {
    expect(searchCaches(caches, 'cors').map((c) => c.name)).toEqual(['CORS Profiles']);
    expect(searchCaches(caches, 'local').map((c) => c.name)).toEqual(['CORS Profiles']);
    expect(searchCaches(caches, 'WidgetCache').map((c) => c.name)).toEqual(['Custom Store']);
    expect(searchCaches(caches, '600').map((c) => c.name)).toEqual(['Cron Expression Library']);
  });

  it('does not match usage circuit text', () => {
    expect(searchCaches(caches, 'Uses CORS')).toEqual([]);
    expect(searchCaches(caches, 'Authz Code Store')).toEqual([]);
  });
});
