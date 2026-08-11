import type { EnvTreeNode } from './types';

/** True when this leaf (or any descendant leaf) has a missing stage cell. */
export function nodeOrDescendantHasMissing(node: EnvTreeNode): boolean {
  if (node.cells) {
    return Object.values(node.cells).some((cell) => cell.kind === 'missing');
  }
  return (node.children ?? []).some((child) => nodeOrDescendantHasMissing(child));
}

function cellMatchesQuery(node: EnvTreeNode, needle: string): boolean {
  if (!node.cells) {
    return false;
  }
  for (const cell of Object.values(node.cells)) {
    if (cell.kind === 'value') {
      if (String(cell.value ?? '').toLowerCase().includes(needle)) {
        return true;
      }
    } else if (cell.kind === 'list') {
      if (cell.values.some((entry) => String(entry ?? '').toLowerCase().includes(needle))) {
        return true;
      }
    }
  }
  return false;
}

function leafMatchesQuery(node: EnvTreeNode, needle: string): boolean {
  if (node.path.toLowerCase().includes(needle) || node.name.toLowerCase().includes(needle)) {
    return true;
  }
  return cellMatchesQuery(node, needle);
}

/**
 * Filter the tree to leaves matching the query (key path / name or value content)
 * plus their ancestors. Empty query returns the original tree.
 */
export function filterEnvTree(nodes: EnvTreeNode[], query: string): EnvTreeNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return nodes;
  }

  const filtered: EnvTreeNode[] = [];
  for (const node of nodes) {
    if (!node.children) {
      if (leafMatchesQuery(node, needle)) {
        filtered.push(node);
      }
      continue;
    }
    const children = filterEnvTree(node.children, query);
    if (children.length > 0) {
      filtered.push({ ...node, children });
    }
  }
  return filtered;
}

/**
 * Paths that should be expanded to walk singleton chains starting at `fromPath`
 * (undefined = from each root). Stops at a leaf or a node with 2+ children.
 */
export function collectSingletonExpandPaths(
  nodes: EnvTreeNode[],
  fromPath?: string,
): string[] {
  const paths: string[] = [];

  function walk(list: EnvTreeNode[], started: boolean): void {
    if (!started) {
      if (fromPath === undefined) {
        // From roots: auto-expand only when there is exactly one root.
        if (list.length === 1) {
          const only = list[0];
          if (only.children) {
            paths.push(only.path);
            walk(only.children, true);
          }
        }
        return;
      }
      for (const node of list) {
        if (node.path === fromPath) {
          if (node.children) {
            paths.push(node.path);
            walk(node.children, true);
          }
          return;
        }
        if (node.children && fromPath.startsWith(`${node.path}.`)) {
          paths.push(node.path);
          walk(node.children, false);
          return;
        }
      }
      return;
    }

    if (list.length !== 1) {
      return;
    }
    const only = list[0];
    if (!only.children) {
      return;
    }
    paths.push(only.path);
    walk(only.children, true);
  }

  walk(nodes, false);
  return paths;
}

/** Merge user-expanded paths with singleton auto-expand under each opened path. */
export function resolveExpandedPaths(
  nodes: EnvTreeNode[],
  userExpanded: Iterable<string>,
): Set<string> {
  const result = new Set<string>();
  const user = [...userExpanded];

  // Always apply root-level singleton chain.
  for (const path of collectSingletonExpandPaths(nodes)) {
    result.add(path);
  }

  for (const path of user) {
    result.add(path);
    for (const auto of collectSingletonExpandPaths(nodes, path)) {
      result.add(auto);
    }
  }

  return result;
}
