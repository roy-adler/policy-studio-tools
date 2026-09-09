import fs from 'fs';
import path from 'path';
import type { PolicyStudioProject } from '../projectRegistry/types';
import { parseServicePathYaml } from './parseServicePathYaml';
import type { ServicePathEntry } from './types';

export interface DiscoverServicePathsResult {
  entries: ServicePathEntry[];
  warnings: string[];
}

const SKIPPED_FILENAMES = new Set(['_parent.yaml', 'solpacks.yaml']);

export function discoverServicePaths(
  projects: PolicyStudioProject[],
): DiscoverServicePathsResult {
  const entries: ServicePathEntry[] = [];
  const warnings: string[] = [];

  for (const project of projects) {
    if (project.projectType !== 'yaml') {
      continue;
    }

    const serviceRoot = path.join(
      project.rootPath,
      'Environment Configuration',
      'Service',
    );
    if (!fs.existsSync(serviceRoot)) {
      continue;
    }

    for (const filePath of listYamlFiles(serviceRoot, warnings)) {
      const parentDirectory = path.dirname(filePath);
      const interfaceName =
        path.resolve(parentDirectory) === path.resolve(serviceRoot)
          ? 'Service'
          : path.basename(parentDirectory);

      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const result = parseServicePathYaml(content, filePath, project, interfaceName);
        if (result.entry) {
          entries.push(result.entry);
        }
        if (result.warning) {
          warnings.push(result.warning);
        }
      } catch (error) {
        warnings.push(`Unable to read ${filePath}: ${errorMessage(error)}`);
      }
    }
  }

  return { entries, warnings };
}

function listYamlFiles(rootPath: string, warnings: string[]): string[] {
  const files: string[] = [];
  let directoryEntries: fs.Dirent[];

  try {
    directoryEntries = fs.readdirSync(rootPath, { withFileTypes: true });
  } catch (error) {
    warnings.push(`Unable to read ${rootPath}: ${errorMessage(error)}`);
    return files;
  }

  for (const directoryEntry of directoryEntries) {
    const entryPath = path.join(rootPath, directoryEntry.name);
    if (directoryEntry.isDirectory()) {
      files.push(...listYamlFiles(entryPath, warnings));
      continue;
    }
    if (!directoryEntry.isFile()) {
      continue;
    }

    const lowerName = directoryEntry.name.toLowerCase();
    const extension = path.extname(lowerName);
    if (
      (extension === '.yaml' || extension === '.yml') &&
      !SKIPPED_FILENAMES.has(lowerName)
    ) {
      files.push(entryPath);
    }
  }

  return files;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
