import * as fs from 'fs';
import * as path from 'path';
import { parseMappingYaml } from '../envValuesEditor/yamlMaps';
import { isPolicyStudioProject } from '../projectDetection/detectPolicyStudioProject';
import type { KpsColumnType, KpsScalar, KpsScalarColumnType, KpsValue } from './types';

const KEY_PROPERTY_STORES = path.join('Environment Configuration', 'Key Property Stores');

export interface KpsTypeSchemaLoad {
  columnTypesByTable: Record<string, Record<string, KpsColumnType>>;
  listElementTypesByTable: Record<string, Record<string, KpsScalarColumnType>>;
  schemaColumnsByTable: Record<string, string[]>;
  schemaFilesByTable: Record<string, { storeGroupPath: string; typeGroupPath: string }>;
  warnings: string[];
}

export function resolveSiblingPolicyProject(kpsRoot: string): string | undefined {
  const parent = path.dirname(path.resolve(kpsRoot));
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    return undefined;
  }

  for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = path.join(parent, entry.name);
    if (isPolicyStudioProject(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export function mapJavaScalarType(javaType: string): {
  type: KpsScalarColumnType;
  unknown: boolean;
} {
  const normalized = javaType.trim();
  const short = normalized.replace(/^java\.lang\./, '');

  if (short === 'String') {
    return { type: 'string', unknown: false };
  }
  if (short === 'Boolean') {
    return { type: 'boolean', unknown: false };
  }
  if (short === 'Integer' || short === 'Long' || short === 'Short' || short === 'Byte') {
    return { type: 'integer', unknown: false };
  }
  if (short === 'Double' || short === 'Float' || short === 'Number') {
    return { type: 'number', unknown: false };
  }

  return { type: 'string', unknown: true };
}

export function mapJavaTypeToColumnType(javaType: string): {
  type: KpsColumnType;
  unknown: boolean;
} {
  const normalized = javaType.trim();
  if (normalized === 'java.util.List' || normalized === 'List') {
    return { type: 'list', unknown: false };
  }
  return mapJavaScalarType(normalized);
}

export function defaultValueForColumnType(columnType: KpsColumnType | undefined): KpsValue {
  if (columnType === 'boolean') {
    return false;
  }
  if (columnType === 'integer' || columnType === 'number') {
    return 0;
  }
  if (columnType === 'list') {
    return [];
  }
  return '';
}

export function parseListInput(text: string): { ok: true; value: KpsScalar[] } | { ok: false } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (!Array.isArray(parsed) || !parsed.every(isListScalar)) {
    return { ok: false };
  }
  return { ok: true, value: parsed };
}

function isListScalar(value: unknown): value is KpsScalar {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  return typeof value === 'number' && Number.isFinite(value);
}

export function listElementMismatch(
  values: KpsScalar[],
  elementType: KpsScalarColumnType | undefined,
): string | undefined {
  if (!elementType) {
    return undefined;
  }
  const matches = values.every((value) => scalarMatchesElementType(value, elementType));
  if (matches) {
    return undefined;
  }
  return `List element is not a valid ${elementType}`;
}

function scalarMatchesElementType(value: KpsScalar, elementType: KpsScalarColumnType): boolean {
  if (value === null) {
    return false;
  }
  if (elementType === 'string') {
    return typeof value === 'string';
  }
  if (elementType === 'boolean') {
    return typeof value === 'boolean';
  }
  if (elementType === 'integer') {
    return typeof value === 'number' && Number.isInteger(value);
  }
  return typeof value === 'number' && Number.isFinite(value);
}

export function coerceByColumnType(
  text: string,
  columnType: KpsColumnType,
): { ok: true; value: KpsScalar } | { ok: false } {
  const trimmed = text.trim();

  if (columnType === 'list') {
    return { ok: false };
  }

  if (columnType === 'string') {
    return { ok: true, value: text };
  }

  if (columnType === 'boolean') {
    if (trimmed.toLowerCase() === 'true') {
      return { ok: true, value: true };
    }
    if (trimmed.toLowerCase() === 'false') {
      return { ok: true, value: false };
    }
    return { ok: false };
  }

  if (columnType === 'integer') {
    if (/^-?\d+$/.test(trimmed)) {
      return { ok: true, value: Number(trimmed) };
    }
    return { ok: false };
  }

  if (trimmed === '' || Number.isNaN(Number(trimmed)) || !Number.isFinite(Number(trimmed))) {
    return { ok: false };
  }
  return { ok: true, value: Number(trimmed) };
}

export function coerceLoadedScalar(
  value: KpsScalar,
  columnType: KpsColumnType,
): KpsScalar | undefined {
  if (columnType === 'list' || Array.isArray(value)) {
    return undefined;
  }

  if (columnType === 'string') {
    if (value === null) {
      return '';
    }
    return String(value);
  }

  if (columnType === 'boolean') {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const result = coerceByColumnType(value, 'boolean');
      return result.ok ? result.value : undefined;
    }
    return undefined;
  }

  if (columnType === 'integer') {
    if (typeof value === 'number' && Number.isInteger(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const result = coerceByColumnType(value, 'integer');
      return result.ok ? result.value : undefined;
    }
    return undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const result = coerceByColumnType(value, 'number');
    return result.ok ? result.value : undefined;
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectYamlFiles(dir: string, out: string[]): void {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectYamlFiles(full, out);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name === '_parent.yaml') {
      continue;
    }
    if (entry.name.toLowerCase().endsWith('.yaml') || entry.name.toLowerCase().endsWith('.yml')) {
      out.push(full);
    }
  }
}

function resolveTypeGroupPath(projectRoot: string, typeRef: string): string {
  const trimmed = typeRef.replace(/\\/g, '/').replace(/^\/+/, '');
  const withExt = trimmed.toLowerCase().endsWith('.yaml') || trimmed.toLowerCase().endsWith('.yml')
    ? trimmed
    : `${trimmed}.yaml`;
  return path.join(projectRoot, ...withExt.split('/'));
}

function parseTypeGroupProperties(
  typeGroupPath: string,
  warnings: string[],
): {
  columns: string[];
  columnTypes: Record<string, KpsColumnType>;
  listElementTypes: Record<string, KpsScalarColumnType>;
} {
  const columns: string[] = [];
  const columnTypes: Record<string, KpsColumnType> = {};
  const listElementTypes: Record<string, KpsScalarColumnType> = {};
  if (!fs.existsSync(typeGroupPath) || !fs.statSync(typeGroupPath).isFile()) {
    warnings.push(`Type Group not found: ${typeGroupPath}`);
    return { columns, columnTypes, listElementTypes };
  }

  const parsed = parseMappingYaml(fs.readFileSync(typeGroupPath, 'utf8'));
  if (parsed.error) {
    warnings.push(`Invalid Type Group YAML (${typeGroupPath}): ${parsed.error}`);
    return { columns, columnTypes, listElementTypes };
  }

  const children = parsed.data.children;
  if (!Array.isArray(children)) {
    warnings.push(`Type Group has no property list: ${typeGroupPath}`);
    return { columns, columnTypes, listElementTypes };
  }

  for (const child of children) {
    if (!isPlainObject(child) || child.type !== 'KPSTypeProperty') {
      continue;
    }
    const fields = child.fields;
    if (!isPlainObject(fields) || typeof fields.name !== 'string' || typeof fields.type !== 'string') {
      continue;
    }
    const mapped = mapJavaTypeToColumnType(fields.type);
    if (mapped.type === 'list') {
      const elementType = typeof fields.value === 'string' ? fields.value.trim() : '';
      if (!elementType) {
        warnings.push(
          `List property "${fields.name}" in ${path.basename(typeGroupPath)} has no element type; elements will not be checked`,
        );
      } else {
        const element = mapJavaScalarType(elementType);
        if (element.unknown) {
          warnings.push(
            `Unknown list element type "${elementType}" for "${fields.name}" in ${path.basename(typeGroupPath)}; elements will not be checked`,
          );
        } else {
          listElementTypes[fields.name] = element.type;
        }
      }
    } else if (mapped.unknown) {
      warnings.push(
        `Unknown Type Group type "${fields.type}" for "${fields.name}" in ${path.basename(typeGroupPath)}; treating as string`,
      );
    }
    if (!columnTypes[fields.name]) {
      columns.push(fields.name);
    }
    columnTypes[fields.name] = mapped.type;
  }

  return { columns, columnTypes, listElementTypes };
}

export function loadKpsTypeSchemas(projectRoot: string): KpsTypeSchemaLoad {
  const warnings: string[] = [];
  const columnTypesByTable: Record<string, Record<string, KpsColumnType>> = {};
  const listElementTypesByTable: Record<string, Record<string, KpsScalarColumnType>> = {};
  const schemaColumnsByTable: Record<string, string[]> = {};
  const schemaFilesByTable: Record<string, { storeGroupPath: string; typeGroupPath: string }> = {};
  const storesRoot = path.join(projectRoot, KEY_PROPERTY_STORES);
  const yamlFiles: string[] = [];
  collectYamlFiles(storesRoot, yamlFiles);

  for (const filePath of yamlFiles) {
    const parsed = parseMappingYaml(fs.readFileSync(filePath, 'utf8'));
    if (parsed.error || parsed.data.type !== 'KPSReadWriteStore') {
      continue;
    }
    const fields = parsed.data.fields;
    if (!isPlainObject(fields) || typeof fields.aliases !== 'string' || typeof fields.type !== 'string') {
      continue;
    }

    const tableName = `${fields.aliases}.json`;
    const typeGroupPath = resolveTypeGroupPath(projectRoot, fields.type);
    const parsedType = parseTypeGroupProperties(typeGroupPath, warnings);
    columnTypesByTable[tableName] = parsedType.columnTypes;
    listElementTypesByTable[tableName] = parsedType.listElementTypes;
    schemaColumnsByTable[tableName] = parsedType.columns;
    schemaFilesByTable[tableName] = { storeGroupPath: filePath, typeGroupPath };
  }

  return {
    columnTypesByTable,
    listElementTypesByTable,
    schemaColumnsByTable,
    schemaFilesByTable,
    warnings,
  };
}
