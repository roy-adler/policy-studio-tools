import * as path from 'path';

const YAML_FOLDER_SUFFIX = '_yaml';

function toPosixRelative(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

/**
 * Axway YAML checkout: POLICYNAME/POLICYNAME_yaml (suffix case-insensitive).
 * Markers live in the inner folder; the parent is the user-facing policy name.
 */
export function isYamlPolicyBundleLayout(rootPath: string): boolean {
  const resolved = path.resolve(rootPath);
  const dirName = path.basename(resolved);
  const parentName = path.basename(path.dirname(resolved));
  if (!parentName || parentName === '.' || parentName === path.parse(resolved).root) {
    return false;
  }
  if (!dirName.toLowerCase().endsWith(YAML_FOLDER_SUFFIX)) {
    return false;
  }
  const stem = dirName.slice(0, -YAML_FOLDER_SUFFIX.length);
  return stem.length > 0 && stem.toLowerCase() === parentName.toLowerCase();
}

export function policyDisplayBasename(rootPath: string, relativePath: string): string {
  if (isYamlPolicyBundleLayout(rootPath)) {
    return path.basename(path.dirname(path.resolve(rootPath)));
  }
  return relativePath === '' ? path.basename(rootPath) : path.basename(relativePath);
}

/** Path used to place the project in the Projects tree (omits inner _yaml). */
export function policyTreeRelativePath(rootPath: string, relativePath: string): string {
  const posix = toPosixRelative(relativePath);
  if (!isYamlPolicyBundleLayout(rootPath)) {
    return posix;
  }
  const lastSlash = posix.lastIndexOf('/');
  return lastSlash === -1 ? '' : posix.slice(0, lastSlash);
}
