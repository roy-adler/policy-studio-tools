import path from 'path';
import { offsetToRange } from '../circuitSearch/textUtils';
import { parseMappingYaml } from '../envValuesEditor/yamlMaps';
import type { PolicyStudioProject } from '../projectRegistry/types';
import {
  decodeFilenameTokens,
  parseFilenameKeyFields,
  stripCollisionSuffix,
} from './filenameTokens';
import type { ServicePathEntry } from './types';

export interface ParseServicePathYamlResult {
  entry?: ServicePathEntry;
  warning?: string;
  skipped?: boolean;
}

export function parseServicePathYaml(
  content: string,
  filePath: string,
  project: PolicyStudioProject,
  interfaceName: string,
): ParseServicePathYamlResult {
  if (!content.trim()) {
    return { warning: `Empty YAML file: ${filePath}` };
  }

  const parsed = parseMappingYaml(content);
  if (parsed.error) {
    return { warning: `Unable to parse ${filePath}: ${parsed.error}` };
  }

  const type = parsed.data.type;
  if (typeof type !== 'string' || type.toLowerCase() !== 'xmlfirewall') {
    return { skipped: true };
  }

  const fields = isRecord(parsed.data.fields) ? parsed.data.fields : {};
  const uriPrefix = typeof fields.uriprefix === 'string' ? fields.uriprefix.trim() : '';
  if (!uriPrefix) {
    return { skipped: true };
  }

  const uriPrefixMatch = /^[ \t]*uriprefix:\s*.*$/m.exec(content);
  if (!uriPrefixMatch) {
    return { warning: `Unable to locate uriprefix in ${filePath}` };
  }

  const absoluteFilePath = path.resolve(filePath);
  const filenameStem = path.basename(filePath, path.extname(filePath));
  const filenameFields = parseFilenameKeyFields(filenameStem);
  const filterCircuit =
    typeof fields.filterCircuit === 'string' && fields.filterCircuit.trim()
      ? fields.filterCircuit.trim()
      : undefined;

  return {
    entry: {
      uriPrefix,
      projectId: project.id,
      projectDisplayName: project.displayName,
      interfaceName,
      httpMethod: filenameFields.httpMethod,
      uriMatcher: filenameFields.uriMatcher,
      filterCircuit,
      filePath: absoluteFilePath,
      uriPrefixRange: offsetToRange(
        content,
        uriPrefixMatch.index,
        uriPrefixMatch.index + uriPrefixMatch[0].length,
      ),
      filenameStem: decodeFilenameTokens(stripCollisionSuffix(filenameStem)),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
