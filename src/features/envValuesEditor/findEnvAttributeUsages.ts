import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { discoverPolicyFiles } from '../circuitSearch/policyFileDiscovery';
import { offsetToRange } from '../circuitSearch/textUtils';
import { isPolicyStudioProject } from '../projectDetection/detectPolicyStudioProject';
import { createProjectId } from '../projectRegistry/projectId';
import type { PolicyStudioProject } from '../projectRegistry/types';
import type { EnvAttributeUsage, EnvTreeNode, EnvUsageScan } from './types';

export const NO_SIBLING_POLICY_PROJECT_WARNING =
  'No Policy Studio project found next to this ENV folder; policy usages were not scanned.';

function isIdentifierContinue(char: string | undefined): boolean {
  if (!char) {
    return false;
  }
  return /[A-Za-z0-9_]/.test(char);
}

export function findEnvKeyOccurrences(
  content: string,
  envKey: string,
): { startOffset: number; endOffset: number }[] {
  if (!envKey) {
    return [];
  }

  const found: { startOffset: number; endOffset: number }[] = [];
  let from = 0;
  while (from <= content.length - envKey.length) {
    const start = content.indexOf(envKey, from);
    if (start === -1) {
      break;
    }
    const end = start + envKey.length;
    const before = start === 0 ? undefined : content[start - 1];
    const after = end >= content.length ? undefined : content[end];
    if (!isIdentifierContinue(before) && !isIdentifierContinue(after)) {
      found.push({ startOffset: start, endOffset: end });
    }
    from = start + 1;
  }
  return found;
}

export function collectEnvLeafPaths(nodes: EnvTreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.cells) {
      paths.push(node.path);
    }
    if (node.children) {
      paths.push(...collectEnvLeafPaths(node.children));
    }
  }
  return paths;
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

export async function scanPolicyFileForUsages(
  file: { absolutePath: string; relativePath: string },
  envKeys: string[] = [],
): Promise<{ usages: EnvAttributeUsage[]; warning?: string }> {
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

  const relativePath = file.relativePath.split(path.sep).join('/');
  const usages: EnvAttributeUsage[] = [];
  for (const envKey of envKeys) {
    for (const occurrence of findEnvKeyOccurrences(content, envKey)) {
      const range = offsetToRange(content, occurrence.startOffset, occurrence.endOffset);
      usages.push({
        envKey,
        absolutePath: file.absolutePath,
        relativePath,
        line: range.start.line + 1,
        range,
      });
    }
  }
  return { usages };
}

export async function scanEnvAttributeUsages(
  envRoot: string,
  envKeys: string[] = [],
): Promise<EnvUsageScan> {
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
      const result = await scanPolicyFileForUsages({ absolutePath, relativePath }, envKeys);
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
