import * as fs from 'fs/promises';
import * as path from 'path';
import type { PolicyStudioProject } from '../projectRegistry/types';
import { parsePolicyXml } from './xmlPolicyParser';
import { parsePolicyYaml } from './yamlPolicyParser';
import type { IndexedPolicyFile } from './types';

const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'out', 'dist', 'build']);
const POLICY_EXTENSIONS = new Set(['.xml', '.yaml', '.yml']);

export async function discoverPolicyFiles(project: PolicyStudioProject): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) {
          continue;
        }
        await walk(path.join(currentDir, entry.name));
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!POLICY_EXTENSIONS.has(ext)) {
        continue;
      }

      if (project.projectType === 'yaml') {
        const relative = path.relative(project.rootPath, path.join(currentDir, entry.name));
        const top = relative.split(path.sep)[0];
        if (!['Policies', 'APIs', 'META-INF'].includes(top) && ext !== '.yaml' && ext !== '.yml') {
          continue;
        }
      }

      files.push(path.join(currentDir, entry.name));
    }
  }

  if (project.projectType === 'yaml') {
    for (const dirName of ['Policies', 'APIs', 'META-INF']) {
      const dirPath = path.join(project.rootPath, dirName);
      try {
        await fs.access(dirPath);
        await walk(dirPath);
      } catch {
        // directory may not exist
      }
    }
    return files;
  }

  await walk(project.rootPath);
  return files;
}

export async function readAndParsePolicyFile(
  project: PolicyStudioProject,
  absolutePath: string,
): Promise<IndexedPolicyFile> {
  const content = await fs.readFile(absolutePath, 'utf8');
  const relativePath = path.relative(project.rootPath, absolutePath).split(path.sep).join('/');
  const ext = path.extname(absolutePath).toLowerCase();

  const parsed =
    ext === '.yaml' || ext === '.yml'
      ? parsePolicyYaml(content)
      : parsePolicyXml(content);

  return {
    absolutePath,
    relativePath,
    content,
    circuits: parsed.circuits,
    parseError: parsed.error,
  };
}
