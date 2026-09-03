import type { PolicyStudioProject } from '../projectRegistry/types';
import { isWellFormedXml } from '../circuitSearch/xmlPolicyParser';
import { classifyCacheKind } from './cacheIdentity';
import type { ParsedCache } from './types';

export interface XmlEntityBlock {
  start: number;
  end: number;
  openTag: string;
  body: string;
  type?: string;
}

function readAttribute(tag: string, attributeName: string): string | undefined {
  const pattern = new RegExp(`${attributeName}\\s*=\\s*"([^"]*)"`, 'i');
  const singlePattern = new RegExp(`${attributeName}\\s*=\\s*'([^']*)'`, 'i');
  return pattern.exec(tag)?.[1] ?? singlePattern.exec(tag)?.[1];
}

export function readScalarFvals(content: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const pattern =
    /<fval\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*>\s*<value\b[^>]*>([^<]*)<\/value>\s*<\/fval>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    fields[match[1]] = match[2].trim();
  }
  return fields;
}

export function readEntityName(content: string): string | undefined {
  const idTagPattern = /<id\b[^>]*\/?>/gi;
  let idMatch: RegExpExecArray | null;
  while ((idMatch = idTagPattern.exec(content)) !== null) {
    if (readAttribute(idMatch[0], 'field')?.toLowerCase() === 'name') {
      const value = readAttribute(idMatch[0], 'value')?.trim();
      if (value) {
        return value;
      }
    }
  }
  return readScalarFvals(content).name || undefined;
}

function findEntityCloseIndex(content: string, openIndex: number): number {
  const entityOpen = /<entity\b[^>]*>/gi;
  const entityClose = /<\/entity>/gi;
  entityOpen.lastIndex = openIndex;
  const firstOpen = entityOpen.exec(content);
  if (!firstOpen || firstOpen.index !== openIndex) {
    return -1;
  }

  let depth = 1;
  let cursor = openIndex + firstOpen[0].length;
  while (depth > 0 && cursor < content.length) {
    entityOpen.lastIndex = cursor;
    entityClose.lastIndex = cursor;
    const nextOpen = entityOpen.exec(content);
    const nextClose = entityClose.exec(content);
    if (!nextClose) {
      return -1;
    }
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + nextOpen[0].length;
    } else {
      depth -= 1;
      if (depth === 0) {
        return nextClose.index;
      }
      cursor = nextClose.index + nextClose[0].length;
    }
  }
  return -1;
}

export function findAllEntityBlocks(content: string): XmlEntityBlock[] {
  const blocks: XmlEntityBlock[] = [];
  const opener = /<entity\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(content)) !== null) {
    const start = match.index;
    const openTag = match[0];
    const closeIndex = findEntityCloseIndex(content, start);
    if (closeIndex < 0) {
      continue;
    }
    const end = closeIndex + '</entity>'.length;
    blocks.push({
      start,
      end,
      openTag,
      body: content.slice(start + openTag.length, closeIndex),
      type: readAttribute(openTag, 'type'),
    });
    opener.lastIndex = end;
  }
  return blocks;
}

function withoutChildEntities(body: string): string {
  let ownBody = body;
  for (const child of findAllEntityBlocks(body).reverse()) {
    ownBody = ownBody.slice(0, child.start) + ownBody.slice(child.end);
  }
  return ownBody;
}

export function parseCacheXml(
  content: string,
  filePath: string,
  project: PolicyStudioProject,
): { caches: ParsedCache[]; warning?: string } {
  if (!isWellFormedXml(content)) {
    return { caches: [], warning: `Invalid XML in ${filePath}` };
  }

  const caches: ParsedCache[] = [];

  function visit(body: string, baseOffset: number): void {
    for (const entity of findAllEntityBlocks(body)) {
      const startOffset = baseOffset + entity.start;
      const entityType = entity.type?.trim();
      const normalizedType = entityType?.toLowerCase();
      if (entityType && (normalizedType === 'cache' || normalizedType === 'distributedcache')) {
        const ownBody = withoutChildEntities(entity.body);
        const fields = readScalarFvals(ownBody);
        const name = readEntityName(ownBody);
        if (name) {
          caches.push({
            name,
            kind: classifyCacheKind(entityType),
            entityType,
            fields,
            yamlPk: `/Libraries/Cache Manager/${name}`,
            filePath,
            startOffset,
            endOffset: baseOffset + entity.end,
            projectId: project.id,
            projectDisplayName: project.displayName,
          });
        }
      }

      visit(entity.body, startOffset + entity.openTag.length);
    }
  }

  visit(content, 0);
  return { caches };
}
