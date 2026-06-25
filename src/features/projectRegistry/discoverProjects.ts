import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  isPolicyStudioProject,
  XML_PROJECT_MARKER,
} from '../projectDetection/detectPolicyStudioProject';
import { isPathExcluded, isPathIncluded } from './globMatch';
import { createProjectId } from './projectId';
import type { DiscoverySettings, PolicyStudioProject, ProjectRegistry } from './types';

function detectProjectType(folderPath: string): 'xml' | 'yaml' | undefined {
  if (fsSync.existsSync(path.join(folderPath, XML_PROJECT_MARKER))) {
    return 'xml';
  }
  if (isPolicyStudioProject(folderPath)) {
    return 'yaml';
  }
  return undefined;
}

function toPosix(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function assignDisplayNames(projects: PolicyStudioProject[]): void {
  const basenameCounts = new Map<string, number>();
  for (const project of projects) {
    const base =
      project.relativePath === ''
        ? path.basename(project.rootPath)
        : path.basename(project.relativePath);
    basenameCounts.set(base, (basenameCounts.get(base) ?? 0) + 1);
  }

  for (const project of projects) {
    const base =
      project.relativePath === ''
        ? path.basename(project.rootPath)
        : path.basename(project.relativePath);
    project.displayName =
      (basenameCounts.get(base) ?? 0) > 1
        ? project.relativePath || path.basename(project.rootPath)
        : base;
  }
}

async function walkForProjects(
  workspaceFolderPath: string,
  workspaceFolderUri: string,
  currentPath: string,
  relativePath: string,
  depth: number,
  settings: DiscoverySettings,
  projects: PolicyStudioProject[],
  warnings: string[],
): Promise<void> {
  if (depth > settings.scanDepth) {
    return;
  }

  const posixRelative = relativePath === '' ? '' : toPosix(relativePath);

  if (posixRelative !== '' && isPathExcluded(posixRelative, settings.excludePaths)) {
    return;
  }

  if (!isPathIncluded(posixRelative, settings.includePaths)) {
    return;
  }

  if (isPolicyStudioProject(currentPath)) {
    const projectType = detectProjectType(currentPath);
    if (projectType) {
      projects.push({
        id: createProjectId(currentPath),
        rootPath: currentPath,
        workspaceFolder: workspaceFolderUri,
        relativePath: posixRelative,
        displayName: '',
        projectType,
      });
    }
    return;
  }

  if (depth >= settings.scanDepth) {
    return;
  }

  let entries;
  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch {
    warnings.push(`Unable to read directory: ${currentPath}`);
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const childPath = path.join(currentPath, entry.name);
    const childRelative =
      relativePath === '' ? entry.name : path.join(relativePath, entry.name);
    const childPosix = toPosix(childRelative);

    if (isPathExcluded(childPosix, settings.excludePaths)) {
      continue;
    }

    await walkForProjects(
      workspaceFolderPath,
      workspaceFolderUri,
      childPath,
      childRelative,
      depth + 1,
      settings,
      projects,
      warnings,
    );
  }
}

export async function discoverProjects(
  workspaceFolderPath: string,
  workspaceFolderUri: string,
  settings: DiscoverySettings,
): Promise<ProjectRegistry> {
  const projects: PolicyStudioProject[] = [];
  const warnings: string[] = [];

  if (settings.scanDepth >= 0) {
    await walkForProjects(
      workspaceFolderPath,
      workspaceFolderUri,
      workspaceFolderPath,
      '',
      0,
      settings,
      projects,
      warnings,
    );
  }

  assignDisplayNames(projects);
  projects.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return {
    projects,
    discoveredAt: new Date(),
    warnings,
  };
}

export function getProjectForFile(
  filePath: string,
  projects: PolicyStudioProject[],
): PolicyStudioProject | undefined {
  const normalizedFile = path.resolve(filePath);
  let best: PolicyStudioProject | undefined;
  let bestLength = -1;

  for (const project of projects) {
    const root = path.resolve(project.rootPath);
    const relative = path.relative(root, normalizedFile);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      if (root.length > bestLength) {
        best = project;
        bestLength = root.length;
      }
    }
  }

  return best;
}
