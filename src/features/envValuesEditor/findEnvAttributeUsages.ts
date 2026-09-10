import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { discoverPolicyFiles } from '../circuitSearch/policyFileDiscovery';
import { offsetToRange } from '../circuitSearch/textUtils';
import { isPolicyStudioProject } from '../projectDetection/detectPolicyStudioProject';
import { createProjectId } from '../projectRegistry/projectId';
import type { PolicyStudioProject } from '../projectRegistry/types';
import type {
  EnvAttributePlaceholder,
  EnvAttributeUsage,
  EnvUsageScan,
} from './types';

export const NO_SIBLING_POLICY_PROJECT_WARNING =
  'No Policy Studio project found next to this ENV folder; policy usages were not scanned.';

const ATTRIBUTE_VALUE_PLACEHOLDER = /\{\{\s*([^{}]*?)\.attributeValue\s*\}\}/g;

export function extractEnvAttributePlaceholders(content: string): EnvAttributePlaceholder[] {
  const found: EnvAttributePlaceholder[] = [];
  const pattern = new RegExp(ATTRIBUTE_VALUE_PLACEHOLDER.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const envKey = match[1].trim();
    if (!envKey) {
      continue;
    }
    found.push({
      envKey,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    });
  }
  return found;
}

function detectProjectType(folderPath: string): 'xml' | 'yaml' | undefined {
  if (fs.existsSync(path.join(folderPath, 'PrimaryStore.xml'))) {
    return 'xml';
  }
  if (isPolicyStudioProject(folderPath)) {
    return 'yaml';
  }
  return undefined;
}

export function listSiblingPolicyProjects(envRoot: string): PolicyStudioProject[] {
  const parent = path.dirname(path.resolve(envRoot));
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch {
    return [];
  }

  const projects: PolicyStudioProject[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const rootPath = path.join(parent, entry.name);
    if (path.resolve(rootPath) === path.resolve(envRoot)) {
      continue;
    }
    const projectType = detectProjectType(rootPath);
    if (!projectType) {
      continue;
    }
    projects.push({
      id: createProjectId(rootPath),
      rootPath,
      workspaceFolder: parent,
      relativePath: entry.name,
      displayName: entry.name,
      projectType,
    });
  }
  projects.sort((a, b) => a.rootPath.localeCompare(b.rootPath));
  return projects;
}

export async function scanPolicyFileForUsages(file: {
  absolutePath: string;
  relativePath: string;
}): Promise<{ usages: EnvAttributeUsage[]; warning?: string }> {
  let content: string;
  try {
    content = await fsPromises.readFile(file.absolutePath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      usages: [],
      warning: `Could not read policy file "${file.relativePath}": ${message}`,
    };
  }

  const usages = extractEnvAttributePlaceholders(content).map((placeholder) => {
    const range = offsetToRange(content, placeholder.startOffset, placeholder.endOffset);
    return {
      envKey: placeholder.envKey,
      absolutePath: file.absolutePath,
      relativePath: file.relativePath.split(path.sep).join('/'),
      line: range.start.line + 1,
      range,
    };
  });
  return { usages };
}

export async function scanEnvAttributeUsages(envRoot: string): Promise<EnvUsageScan> {
  const projects = listSiblingPolicyProjects(envRoot);
  if (projects.length === 0) {
    return { byKey: {}, warnings: [NO_SIBLING_POLICY_PROJECT_WARNING], projectCount: 0 };
  }

  const byKey: Record<string, EnvAttributeUsage[]> = {};
  const warnings: string[] = [];

  for (const project of projects) {
    const files = await discoverPolicyFiles(project);
    for (const absolutePath of files) {
      const relativePath = path.relative(project.rootPath, absolutePath);
      const result = await scanPolicyFileForUsages({ absolutePath, relativePath });
      if (result.warning) {
        warnings.push(result.warning);
      }
      for (const usage of result.usages) {
        const list = byKey[usage.envKey] ?? [];
        list.push(usage);
        byKey[usage.envKey] = list;
      }
    }
  }

  return { byKey, warnings, projectCount: projects.length };
}
