import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { discoverPolicyFiles, readAndParsePolicyFile } from '../circuitSearch/policyFileDiscovery';
import type { PolicyStudioProject } from '../projectRegistry/types';
import { buildSemanticModelFromIndexedFiles } from './semanticModel';
import type { DiffSource, PolicySnapshot } from './types';

function projectFromDirectory(dirPath: string): PolicyStudioProject {
  const normalized = path.resolve(dirPath);
  const projectType = fs.existsSync(path.join(normalized, 'values.yaml')) ? 'yaml' : 'xml';

  return {
    id: normalized,
    rootPath: normalized,
    workspaceFolder: normalized,
    relativePath: '',
    displayName: path.basename(normalized),
    projectType,
  };
}

async function indexDirectoryProject(project: PolicyStudioProject): Promise<{
  files: Awaited<ReturnType<typeof readAndParsePolicyFile>>[];
  policyFiles: string[];
  unparseableFiles: string[];
}> {
  const policyPaths = await discoverPolicyFiles(project);
  const files: Awaited<ReturnType<typeof readAndParsePolicyFile>>[] = [];
  const unparseableFiles: string[] = [];

  for (const absolutePath of policyPaths) {
    const indexed = await readAndParsePolicyFile(project, absolutePath);
    files.push(indexed);
    if (indexed.parseError) {
      unparseableFiles.push(indexed.relativePath);
    }
  }

  return {
    files,
    policyFiles: policyPaths.map((absolutePath) =>
      path.relative(project.rootPath, absolutePath).split(path.sep).join('/'),
    ),
    unparseableFiles,
  };
}

export async function loadPolicySnapshotFromDirectory(dirPath: string): Promise<PolicySnapshot> {
  const project = projectFromDirectory(dirPath);
  const indexed = await indexDirectoryProject(project);

  return buildSemanticModelFromIndexedFiles(indexed.files, {
    label: project.displayName,
    rootPath: project.rootPath,
    projectType: project.projectType,
    policyFiles: indexed.policyFiles,
    unparseableFiles: indexed.unparseableFiles,
  });
}

export async function loadPolicySnapshotFromFileSet(
  files: string[],
  rootPath: string,
): Promise<PolicySnapshot> {
  const project = projectFromDirectory(rootPath);
  const indexedFiles: Awaited<ReturnType<typeof readAndParsePolicyFile>>[] = [];
  const policyFiles: string[] = [];
  const unparseableFiles: string[] = [];

  for (const absolutePath of files) {
    const indexed = await readAndParsePolicyFile(project, absolutePath);
    indexedFiles.push(indexed);
    policyFiles.push(indexed.relativePath);
    if (indexed.parseError) {
      unparseableFiles.push(indexed.relativePath);
    }
  }

  return buildSemanticModelFromIndexedFiles(indexedFiles, {
    label: path.basename(rootPath),
    rootPath: project.rootPath,
    projectType: project.projectType,
    policyFiles,
    unparseableFiles,
  });
}

export async function loadPolicySnapshot(source: DiffSource): Promise<PolicySnapshot> {
  switch (source.kind) {
    case 'directory':
      return loadPolicySnapshotFromDirectory(source.path);
    case 'fileSet':
      return loadPolicySnapshotFromFileSet(source.files, source.rootPath);
    case 'git':
      throw new Error('Git diff source is not implemented yet.');
    default: {
      const exhaustive: never = source;
      throw new Error(`Unsupported diff source: ${(exhaustive as DiffSource).kind}`);
    }
  }
}

export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fsp.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}
