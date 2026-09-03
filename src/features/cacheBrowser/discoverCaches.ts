import * as fs from 'fs';
import * as path from 'path';
import type { PolicyStudioProject } from '../projectRegistry/types';
import { parseCacheXml } from './parseCacheXml';
import { parseCacheYaml } from './parseCacheYaml';
import type { ParsedCache } from './types';

const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'out', 'dist', 'build']);
const PARENT_BASENAME = '_parent.yaml';

export function discoverCaches(project: PolicyStudioProject): {
  caches: ParsedCache[];
  warnings: string[];
  inventoryPaths: string[];
} {
  const yaml = discoverYamlCaches(project);
  const xml = discoverXmlCaches(project);
  return {
    caches: [...yaml.caches, ...xml.caches],
    warnings: [...yaml.warnings, ...xml.warnings],
    // YAML cache definition files only. XML definitions and usages share entity-store files.
    inventoryPaths: [...yaml.inventoryPaths, ...xml.inventoryPaths],
  };
}

function discoverYamlCaches(project: PolicyStudioProject): {
  caches: ParsedCache[];
  warnings: string[];
  inventoryPaths: string[];
} {
  const caches: ParsedCache[] = [];
  const warnings: string[] = [];
  const inventoryPaths: string[] = [];
  const root = path.join(project.rootPath, 'Libraries', 'Cache Manager');
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return { caches, warnings, inventoryPaths };
  }

  for (const filePath of listFiles(root, ['.yaml', '.yml'])) {
    if (path.basename(filePath).toLowerCase() === PARENT_BASENAME) {
      continue;
    }
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Unreadable cache file ${filePath}: ${message}`);
      continue;
    }
    const parsed = parseCacheYaml(content, filePath, project);
    if (parsed.warning) {
      warnings.push(parsed.warning);
    }
    if (parsed.cache) {
      caches.push(parsed.cache);
      inventoryPaths.push(path.resolve(filePath));
    }
  }

  return { caches, warnings, inventoryPaths };
}

export function discoverXmlCaches(project: PolicyStudioProject): {
  caches: ParsedCache[];
  warnings: string[];
  inventoryPaths: string[];
} {
  const caches: ParsedCache[] = [];
  const warnings: string[] = [];

  for (const filePath of listFiles(project.rootPath, ['.xml'])) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Unreadable cache file ${filePath}: ${message}`);
      continue;
    }
    const parsed = parseCacheXml(content, filePath, project);
    caches.push(...parsed.caches);
    if (parsed.warning) {
      warnings.push(parsed.warning);
    }
  }

  return { caches, warnings, inventoryPaths: [] };
}

export function listFiles(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }
      out.push(...listFiles(full, extensions));
      continue;
    }
    if (entry.isFile() && extensions.includes(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}
