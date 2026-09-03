import * as fs from 'fs';
import * as path from 'path';
import { isWellFormedXml } from '../circuitSearch/xmlPolicyParser';
import { parseMappingYaml } from '../envValuesEditor/yamlMaps';
import type { PolicyStudioProject } from '../projectRegistry/types';
import { cacheId, isCacheFieldName, isKnownCachingFilterType } from './cacheIdentity';
import { listFiles } from './discoverCaches';
import { findAllEntityBlocks, readEntityName, readScalarFvals } from './parseCacheXml';
import { resolveCacheRef } from './resolveCacheRef';
import type { CacheUsage, ParsedCache } from './types';

interface StackEntry {
  indent: number;
  value: string;
}

interface XmlScalar {
  fieldName: string;
  value: string;
  start: number;
  preview: string;
}

export function offsetAtLine(content: string, lineIndex: number): number {
  let offset = 0;
  for (let index = 0; index < lineIndex; index += 1) {
    const newline = content.indexOf('\n', offset);
    if (newline < 0) {
      return content.length;
    }
    offset = newline + 1;
  }
  return offset;
}

function stripYamlInlineComment(value: string): string {
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"') {
      if (character === '\\') {
        index += 1;
      } else if (character === '"') {
        quote = undefined;
      }
      continue;
    }
    if (quote === "'") {
      if (character === "'" && value[index + 1] === "'") {
        index += 1;
      } else if (character === "'") {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '#' && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index).trimEnd();
    }
  }

  return value;
}

function unquote(value: string): string {
  const trimmed = stripYamlInlineComment(value).trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function usageFor(
  cache: ParsedCache,
  project: PolicyStudioProject,
  filePath: string,
  usageKind: CacheUsage['usageKind'],
  matchPreview: string,
  startOffset: number,
  details: Pick<CacheUsage, 'circuitName' | 'filterName' | 'filterType' | 'fieldName'>,
): CacheUsage {
  return {
    cacheId: cacheId(cache),
    cacheName: cache.name,
    usageKind,
    filePath,
    ...details,
    matchPreview,
    startOffset,
    projectId: project.id,
    projectDisplayName: project.displayName,
  };
}

function scanYamlUsages(
  content: string,
  filePath: string,
  project: PolicyStudioProject,
  caches: ParsedCache[],
): CacheUsage[] {
  const usages: CacheUsage[] = [];
  const typeStack: StackEntry[] = [];
  const nameStack: StackEntry[] = [];
  let circuitName: string | undefined;
  const lines = content.split(/\r\n|\r|\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const typeMatch = /^(\s*)(?:-\s*)?type\s*:\s*(.+?)\s*$/.exec(line);
    if (typeMatch) {
      const indent = typeMatch[1].length;
      while (typeStack.at(-1)?.indent !== undefined && typeStack.at(-1)!.indent >= indent) {
        typeStack.pop();
      }
      typeStack.push({ indent, value: unquote(typeMatch[2]) });
    }

    const nameMatch = /^(\s*)(?:-\s*)?name\s*:\s*(.+?)\s*$/.exec(line);
    if (nameMatch) {
      const indent = nameMatch[1].length;
      while (nameStack.at(-1)?.indent !== undefined && nameStack.at(-1)!.indent >= indent) {
        nameStack.pop();
      }
      const name = unquote(nameMatch[2]);
      nameStack.push({ indent, value: name });
      if (typeStack.at(-1)?.value.toLowerCase() === 'filtercircuit') {
        circuitName = name;
      }
    }

    const scalarMatch = /^(\s*)(?:-\s*)?([A-Za-z][\w]*)\s*:\s*(.+)$/.exec(line);
    if (!scalarMatch) {
      continue;
    }
    const rawValue = scalarMatch[3].trim();
    if (!rawValue || rawValue === '{}' || rawValue === '[]' || rawValue === '{' || rawValue === '[') {
      continue;
    }

    const fieldName = scalarMatch[2];
    const entityType = typeStack.at(-1)?.value;
    const knownFilter = Boolean(entityType && isKnownCachingFilterType(entityType));
    if (!isCacheFieldName(fieldName) && !knownFilter) {
      continue;
    }

    const resolvedCache = resolveCacheRef(unquote(rawValue), caches);
    if (!resolvedCache) {
      continue;
    }
    const currentName = nameStack.at(-1)?.value;
    usages.push(
      usageFor(
        resolvedCache,
        project,
        filePath,
        knownFilter ? 'caching-filter' : 'cache-field',
        line.trim(),
        offsetAtLine(content, lineIndex),
        {
          circuitName,
          filterName: currentName && currentName !== circuitName ? currentName : undefined,
          filterType: entityType,
          fieldName,
        },
      ),
    );
  }

  return usages;
}

function bodyWithoutChildEntities(body: string): string {
  let ownBody = body;
  for (const child of findAllEntityBlocks(body).reverse()) {
    ownBody =
      ownBody.slice(0, child.start) + ' '.repeat(child.end - child.start) + ownBody.slice(child.end);
  }
  return ownBody;
}

function xmlScalars(content: string): XmlScalar[] {
  // Use the shared parser as the source of supported scalar fval semantics.
  const fields = readScalarFvals(content);
  const scalars: XmlScalar[] = [];
  const pattern =
    /<fval\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*>\s*<value\b[^>]*>([^<]*)<\/value>\s*<\/fval>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    if (fields[match[1]] !== undefined) {
      scalars.push({
        fieldName: match[1],
        value: match[2].trim(),
        start: match.index,
        preview: match[0].trim(),
      });
    }
  }
  return scalars;
}

function scanXmlUsages(
  content: string,
  filePath: string,
  project: PolicyStudioProject,
  caches: ParsedCache[],
): CacheUsage[] {
  const usages: CacheUsage[] = [];

  function visit(body: string, baseOffset: number, ancestorCircuitName?: string): void {
    for (const entity of findAllEntityBlocks(body)) {
      const entityStart = baseOffset + entity.start;
      const entityBodyStart = entityStart + entity.openTag.length;
      const entityType = entity.type?.trim();
      const ownBody = bodyWithoutChildEntities(entity.body);
      const entityName = readEntityName(ownBody);
      const circuitName =
        entityType?.toLowerCase() === 'filtercircuit' ? entityName : ancestorCircuitName;
      const knownFilter = Boolean(entityType && isKnownCachingFilterType(entityType));

      for (const scalar of xmlScalars(ownBody)) {
        if (!isCacheFieldName(scalar.fieldName) && !knownFilter) {
          continue;
        }
        const resolvedCache = resolveCacheRef(scalar.value, caches);
        if (!resolvedCache) {
          continue;
        }
        usages.push(
          usageFor(
            resolvedCache,
            project,
            filePath,
            knownFilter ? 'caching-filter' : 'cache-field',
            scalar.preview,
            entityBodyStart + scalar.start,
            {
              circuitName,
              filterName:
                entityName && entityName !== circuitName ? entityName : undefined,
              filterType: entityType,
              fieldName: scalar.fieldName,
            },
          ),
        );
      }

      visit(entity.body, entityBodyStart, circuitName);
    }
  }

  visit(content, 0);
  return usages;
}

function isCacheManagerParentYaml(projectRootPath: string, filePath: string): boolean {
  const relativePath = path.relative(projectRootPath, filePath);
  if (relativePath.startsWith('..')) {
    return false;
  }
  const segments = relativePath.split(/[/\\]/);
  const basename = segments[segments.length - 1];
  return (
    segments.length >= 3 &&
    segments[0].toLowerCase() === 'libraries' &&
    segments[1].toLowerCase() === 'cache manager' &&
    basename.toLowerCase() === '_parent.yaml'
  );
}

export function findCacheUsages(
  project: PolicyStudioProject,
  caches: ParsedCache[],
  skipPaths: Set<string>,
): { usages: CacheUsage[]; warnings: string[] } {
  const usages: CacheUsage[] = [];
  const warnings: string[] = [];
  const resolvedSkipPaths = new Set([...skipPaths].map((filePath) => path.resolve(filePath)));

  for (const filePath of listFiles(project.rootPath, ['.yaml', '.yml', '.xml'])) {
    if (
      resolvedSkipPaths.has(path.resolve(filePath)) ||
      isCacheManagerParentYaml(project.rootPath, filePath)
    ) {
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Unreadable usage file ${filePath}: ${message}`);
      continue;
    }

    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.xml') {
      if (!isWellFormedXml(content)) {
        warnings.push(`Invalid XML in ${filePath}`);
        continue;
      }
      usages.push(...scanXmlUsages(content, filePath, project, caches));
      continue;
    }

    // Empty cache-definition files are already reported during discovery and
    // contain no usage candidates, so do not duplicate that warning here.
    if (!content.trim()) {
      continue;
    }
    const parsed = parseMappingYaml(content);
    if (parsed.error) {
      warnings.push(`Invalid YAML in ${filePath}: ${parsed.error}`);
      continue;
    }
    usages.push(...scanYamlUsages(content, filePath, project, caches));
  }

  return { usages, warnings };
}
