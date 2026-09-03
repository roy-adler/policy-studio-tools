import * as path from 'path';
import { parseMappingYaml } from '../envValuesEditor/yamlMaps';
import type { PolicyStudioProject } from '../projectRegistry/types';
import { classifyCacheKind, scalarFieldMap, toYamlPk } from './cacheIdentity';
import type { ParsedCache } from './types';

export function parseCacheYaml(
  content: string,
  filePath: string,
  project: PolicyStudioProject,
): { cache?: ParsedCache; warning?: string } {
  if (content.trim() === '') {
    return { warning: `Empty cache file: ${filePath}` };
  }

  const parsed = parseMappingYaml(content);
  if (parsed.error) {
    return { warning: `Invalid YAML in ${filePath}: ${parsed.error}` };
  }

  const entityType = typeof parsed.data.type === 'string' ? parsed.data.type.trim() : '';
  if (!entityType) {
    if (!parsed.data.fields && !('meta' in parsed.data) && !('children' in parsed.data)) {
      return { warning: `Invalid YAML in ${filePath}: unrecognizable document` };
    }
    return { warning: `No type in ${filePath}` };
  }

  const fields = scalarFieldMap(parsed.data.fields);
  const basename = path.basename(filePath, path.extname(filePath));
  const typeIndex = content.search(/^type:\s*/m);
  const startOffset = typeIndex >= 0 ? typeIndex : 0;

  return {
    cache: {
      name: fields.name?.trim() || basename,
      kind: classifyCacheKind(entityType),
      entityType,
      fields,
      yamlPk: toYamlPk(project.rootPath, filePath),
      filePath,
      startOffset,
      endOffset: content.length,
      projectId: project.id,
      projectDisplayName: project.displayName,
    },
  };
}
