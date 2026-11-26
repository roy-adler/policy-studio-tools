import * as path from 'path';
import type { CircuitIndex } from '../circuitSearch/types';

/** One policy (circuit) leaf in the policy tree. */
export interface PolicyTreeLeaf {
  kind: 'policy';
  label: string;
  projectId: string;
  circuitName: string;
  absolutePath: string;
  /** Project-relative file path, shown as a tooltip. */
  filePath: string;
}

/** A folder (Policy Studio container), or a project when several are in scope. */
export interface PolicyTreeFolder {
  kind: 'folder' | 'project';
  label: string;
  /** Stable id so the webview can remember which folders are expanded. */
  id: string;
  children: PolicyTreeNode[];
}

export type PolicyTreeNode = PolicyTreeFolder | PolicyTreeLeaf;

/**
 * Builds the folder → policy tree Policy Studio shows in its Policies view,
 * from the circuits the project actually contains.
 *
 * Folders come from the directories a circuit file lives in, relative to the
 * project root (YAML entity store: one directory per container, e.g.
 * `Policies/Auth/Check Token.yaml` → Policies › Auth › Check Token). XML
 * projects keep all circuits in one store file, so their circuits are listed
 * under that file. Folders are sorted before policies, both alphabetically.
 */
export function buildPolicyTree(indexes: CircuitIndex[]): PolicyTreeNode[] {
  const perProject = indexes.map((index) => {
    const root: PolicyTreeFolder = {
      kind: 'project',
      label: index.project.displayName,
      id: index.projectId,
      children: [],
    };

    for (const file of index.files) {
      if (file.circuits.length === 0) {
        continue;
      }
      const relative = file.relativePath.split(path.sep).join('/');
      const isXmlStore = /\.xml$/i.test(relative);
      const segments = isXmlStore ? [relative] : relative.split('/').slice(0, -1);
      const folder = ensureFolder(root, segments, index.projectId);

      for (const circuit of file.circuits) {
        folder.children.push({
          kind: 'policy',
          label: circuit.name,
          projectId: index.projectId,
          circuitName: circuit.name,
          absolutePath: file.absolutePath,
          filePath: relative,
        });
      }
    }

    sortTree(root);
    return root;
  });

  if (perProject.length === 1) {
    return perProject[0].children;
  }
  return perProject.filter((project) => project.children.length > 0);
}

function ensureFolder(root: PolicyTreeFolder, segments: string[], projectId: string): PolicyTreeFolder {
  let current = root;
  const idParts = [projectId];
  for (const segment of segments) {
    idParts.push(segment);
    let next = current.children.find(
      (child): child is PolicyTreeFolder => child.kind === 'folder' && child.label === segment,
    );
    if (!next) {
      next = { kind: 'folder', label: segment, id: idParts.join('/'), children: [] };
      current.children.push(next);
    }
    current = next;
  }
  return current;
}

function sortTree(folder: PolicyTreeFolder): void {
  folder.children.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'policy' ? 1 : -1;
    }
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  });
  for (const child of folder.children) {
    if (child.kind !== 'policy') {
      sortTree(child);
    }
  }
}
