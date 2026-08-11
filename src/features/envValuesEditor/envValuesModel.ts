import type {
  EnvCellState,
  EnvScalar,
  EnvStage,
  EnvStageDocument,
  EnvTreeNode,
  EnvValuesModel,
  EnvYamlStyle,
} from './types';
import { parseMappingYaml } from './yamlMaps';

export function parseEnvValuesYaml(text: string): {
  data: Record<string, unknown>;
  error?: string;
  style?: EnvYamlStyle;
} {
  return parseMappingYaml(text);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isScalar(value: unknown): value is EnvScalar {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/** True when value is an array and every item is a scalar (including empty []). */
export function isScalarArray(value: unknown): value is EnvScalar[] {
  return Array.isArray(value) && value.every((item) => isScalar(item));
}

export function getLeafPaths(
  data: Record<string, unknown>,
  prefix = '',
  warnings?: string[],
): string[] {
  const paths: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isScalar(value) || isScalarArray(value)) {
      paths.push(path);
    } else if (isPlainObject(value)) {
      paths.push(...getLeafPaths(value, path, warnings));
    } else if (Array.isArray(value) && warnings) {
      warnings.push(`Array at ${path} is not editable (non-scalar items) and was skipped`);
    }
  }

  return paths;
}

export function getValueAtPath(data: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = data;
  for (const part of parts) {
    if (!isPlainObject(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

/** True when any dotted segment of `path` could be used for prototype pollution. */
export function hasForbiddenPathSegment(path: string): boolean {
  return path.split('.').some((segment) => FORBIDDEN_PATH_SEGMENTS.has(segment));
}

function assertSafePathSegments(path: string): void {
  if (hasForbiddenPathSegment(path)) {
    throw new Error(
      `Invalid key path "${path}": segments "__proto__", "prototype", and "constructor" are not allowed.`,
    );
  }
}

export function pathExists(data: Record<string, unknown>, path: string): boolean {
  const parts = path.split('.');
  let current: unknown = data;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (!isPlainObject(current) || !(part in current)) {
      return false;
    }
    if (index === parts.length - 1) {
      return true;
    }
    current = current[part];
  }
  return parts.length === 0;
}

/** True when `path` can be written without turning a scalar intermediate into a map. */
export function canSetValueAtPath(data: Record<string, unknown>, path: string): boolean {
  if (hasForbiddenPathSegment(path)) {
    return false;
  }

  const parts = path.split('.');
  let current: unknown = data;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index];
    if (!isPlainObject(current)) {
      return false;
    }
    const next = current[part];
    if (next !== undefined && !isPlainObject(next)) {
      return false;
    }
    current = next ?? {};
  }
  return true;
}

export function setValueAtPath(
  data: Record<string, unknown>,
  path: string,
  value: EnvScalar | EnvScalar[],
): boolean {
  assertSafePathSegments(path);
  if (!canSetValueAtPath(data, path)) {
    return false;
  }

  const parts = path.split('.');
  let current: Record<string, unknown> = data;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (index === parts.length - 1) {
      current[part] = value;
      return true;
    }
    const next = current[part];
    if (!isPlainObject(next)) {
      const created: Record<string, unknown> = {};
      current[part] = created;
      current = created;
    } else {
      current = next;
    }
  }
  return true;
}

export function deleteValueAtPath(data: Record<string, unknown>, path: string): void {
  assertSafePathSegments(path);
  const parts = path.split('.');
  const stack: Array<{ parent: Record<string, unknown>; key: string }> = [];
  let current: Record<string, unknown> = data;

  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (index === parts.length - 1) {
      delete current[part];
      break;
    }
    const next = current[part];
    if (!isPlainObject(next)) {
      return;
    }
    stack.push({ parent: current, key: part });
    current = next;
  }

  // Prune empty ancestor maps so removals do not leave `Key: {}` stubs.
  for (let index = stack.length - 1; index >= 0; index--) {
    const { parent, key } = stack[index];
    const child = parent[key];
    if (isPlainObject(child) && Object.keys(child).length === 0) {
      delete parent[key];
    } else {
      break;
    }
  }
}

export function buildEnvValuesModel(
  envRoot: string,
  documents: EnvStageDocument[],
): EnvValuesModel {
  const stages: EnvStage[] = documents.map((document) => ({
    id: document.stageId,
    valuesFilePath: document.filePath,
  }));
  const warnings: string[] = [];
  const validDocuments = documents.filter((document) => !document.parseError);
  const allPaths = new Set<string>();

  for (const document of validDocuments) {
    for (const path of getLeafPaths(document.data, '', warnings)) {
      allPaths.add(path);
    }
  }

  const cellData = new Map<string, Record<string, EnvCellState>>();

  for (const leafPath of [...allPaths].sort()) {
    const cells: Record<string, EnvCellState> = {};

    for (const document of validDocuments) {
      const value = getValueAtPath(document.data, leafPath);
      const exists = pathExists(document.data, leafPath);

      if (!exists) {
        cells[document.stageId] = { kind: 'missing' };
        warnings.push(`Missing value for ${leafPath} in ${document.stageId}`);
        continue;
      }

      if (isScalar(value)) {
        cells[document.stageId] = { kind: 'value', value };
        continue;
      }

      if (isScalarArray(value)) {
        cells[document.stageId] = { kind: 'list', values: value };
        continue;
      }

      const detail = `Structural conflict at ${leafPath} in ${document.stageId}`;
      cells[document.stageId] = { kind: 'conflict', detail };
      warnings.push(`Conflict: ${detail}`);
    }

    for (const document of validDocuments) {
      const value = getValueAtPath(document.data, leafPath);
      if (!pathExists(document.data, leafPath)) {
        continue;
      }
      const documentIsScalar = isScalar(value);
      const documentIsList = isScalarArray(value);
      if (!documentIsScalar && !documentIsList) {
        continue;
      }
      for (const other of validDocuments) {
        if (other.stageId === document.stageId) {
          continue;
        }
        const otherValue = getValueAtPath(other.data, leafPath);
        if (!pathExists(other.data, leafPath)) {
          continue;
        }
        const otherIsMap = isPlainObject(otherValue);
        const otherIsScalar = isScalar(otherValue);
        const otherIsList = isScalarArray(otherValue);
        const incompatible =
          otherIsMap ||
          (documentIsScalar && otherIsList) ||
          (documentIsList && otherIsScalar);
        if (!incompatible) {
          continue;
        }
        const detail = `Type conflict at ${leafPath} between ${document.stageId} and ${other.stageId}`;
        cells[document.stageId] = { kind: 'conflict', detail };
        cells[other.stageId] = { kind: 'conflict', detail };
        if (!warnings.some((warning) => warning.includes(detail))) {
          warnings.push(`Conflict: ${detail}`);
        }
      }
    }

    cellData.set(leafPath, cells);
  }

  const documentsByStage: Record<string, EnvStageDocument> = {};
  for (const document of documents) {
    documentsByStage[document.stageId] = document;
  }

  return {
    envRoot,
    stages,
    documents: documentsByStage,
    tree: buildTree([...allPaths].sort(), cellData),
    warnings,
  };
}

function buildTree(
  paths: string[],
  cellData: Map<string, Record<string, EnvCellState>>,
): EnvTreeNode[] {
  const root: EnvTreeNode[] = [];

  for (const path of paths) {
    const parts = path.split('.');
    let current = root;
    let builtPath = '';

    for (let index = 0; index < parts.length; index++) {
      const name = parts[index];
      builtPath = builtPath ? `${builtPath}.${name}` : name;
      const isLeaf = index === parts.length - 1;

      let node = current.find((entry) => entry.name === name);
      if (!node) {
        node = { name, path: builtPath };
        if (!isLeaf) {
          node.children = [];
        }
        current.push(node);
      }

      if (node.cells) {
        break;
      }

      if (isLeaf) {
        node.cells = cellData.get(path);
      } else {
        node.children ??= [];
        current = node.children;
      }
    }
  }

  sortTree(root);
  return root;
}

function sortTree(nodes: EnvTreeNode[]): void {
  nodes.sort((left, right) => left.name.localeCompare(right.name));
  for (const node of nodes) {
    if (node.children) {
      sortTree(node.children);
    }
  }
}
