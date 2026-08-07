import {
  buildEnvValuesModel,
  canSetValueAtPath,
  deleteValueAtPath,
  getValueAtPath,
  hasForbiddenPathSegment,
  pathExists,
  setValueAtPath,
} from './envValuesModel';
import type {
  EnvCellState,
  EnvScalar,
  EnvScalarQuoteStyle,
  EnvStageDocument,
  EnvValuesModel,
  EnvYamlStyle,
} from './types';
import { emptyYamlStyle } from './yamlMaps';

function cloneDocuments(
  documents: Record<string, EnvStageDocument>,
): Record<string, EnvStageDocument> {
  return JSON.parse(JSON.stringify(documents));
}

function rebuildModel(
  envRoot: string,
  documents: Record<string, EnvStageDocument>,
): EnvValuesModel {
  return buildEnvValuesModel(envRoot, Object.values(documents));
}

function getCellState(model: EnvValuesModel, path: string, stageId: string): EnvCellState | undefined {
  const parts = path.split('.');
  let current = model.tree;
  let node = undefined;
  for (const part of parts) {
    node = current.find((entry) => entry.name === part);
    if (!node) {
      return undefined;
    }
    current = node.children ?? [];
  }
  return node?.cells?.[stageId];
}

export function setLeafValue(
  model: EnvValuesModel,
  path: string,
  stageId: string,
  value: EnvScalar,
): EnvValuesModel {
  if (hasForbiddenPathSegment(path)) {
    return model;
  }

  const document = model.documents[stageId];
  if (!document || document.parseError) {
    return model;
  }

  const cell = getCellState(model, path, stageId);
  if (!cell || (cell.kind !== 'value' && cell.kind !== 'missing')) {
    return model;
  }

  const documents = cloneDocuments(model.documents);
  if (!setValueAtPath(documents[stageId].data, path, value)) {
    return model;
  }
  documents[stageId].dirty = true;
  return rebuildModel(model.envRoot, documents);
}

/** Set a scalar-list leaf (one stage). Accepts missing or existing list cells. */
export function setListValue(
  model: EnvValuesModel,
  path: string,
  stageId: string,
  values: EnvScalar[],
): EnvValuesModel {
  if (hasForbiddenPathSegment(path)) {
    return model;
  }

  const document = model.documents[stageId];
  if (!document || document.parseError) {
    return model;
  }

  const cell = getCellState(model, path, stageId);
  if (!cell || (cell.kind !== 'list' && cell.kind !== 'missing')) {
    return model;
  }

  const previous = getValueAtPath(document.data, path);
  const oldValues = Array.isArray(previous) ? (previous as EnvScalar[]) : [];

  const documents = cloneDocuments(model.documents);
  if (!setValueAtPath(documents[stageId].data, path, values)) {
    return model;
  }
  documents[stageId].style = syncListStyle(documents[stageId].style, path, oldValues, values);
  documents[stageId].dirty = true;
  return rebuildModel(model.envRoot, documents);
}

function syncListStyle(
  style: EnvYamlStyle | undefined,
  path: string,
  oldValues: EnvScalar[],
  newValues: EnvScalar[],
): EnvYamlStyle {
  const next = style ? { ...style } : emptyYamlStyle();
  next.quotes = { ...next.quotes };
  next.lists = { ...next.lists, [path]: next.lists[path] ?? 'compact' };
  next.listItemQuotes = { ...next.listItemQuotes };

  const oldStyles: Array<EnvScalarQuoteStyle | undefined> = oldValues.map(
    (_, index) => next.listItemQuotes[`${path}[${index}]`],
  );
  for (const key of Object.keys(next.listItemQuotes)) {
    if (key.startsWith(`${path}[`)) {
      delete next.listItemQuotes[key];
    }
  }

  let oldIndex = 0;
  for (let newIndex = 0; newIndex < newValues.length; newIndex++) {
    let found = -1;
    for (let candidate = oldIndex; candidate < oldValues.length; candidate++) {
      if (oldValues[candidate] === newValues[newIndex]) {
        found = candidate;
        break;
      }
    }
    if (found !== -1) {
      const quote = oldStyles[found];
      if (quote) {
        next.listItemQuotes[`${path}[${newIndex}]`] = quote;
      }
      oldIndex = found + 1;
    }
  }

  return next;
}

export function createMissing(
  model: EnvValuesModel,
  path: string,
  stageId: string,
): EnvValuesModel {
  if (hasForbiddenPathSegment(path)) {
    return model;
  }

  const document = model.documents[stageId];
  if (!document || document.parseError) {
    return model;
  }

  const cell = getCellState(model, path, stageId);
  if (!cell || cell.kind !== 'missing') {
    return model;
  }

  const otherHasList = Object.keys(model.documents).some((otherId) => {
    if (otherId === stageId) {
      return false;
    }
    return getCellState(model, path, otherId)?.kind === 'list';
  });
  const initial: EnvScalar | EnvScalar[] = otherHasList ? [] : '';

  const documents = cloneDocuments(model.documents);
  if (!setValueAtPath(documents[stageId].data, path, initial)) {
    return model;
  }
  if (Array.isArray(initial)) {
    const style = documents[stageId].style
      ? { ...documents[stageId].style! }
      : emptyYamlStyle();
    style.lists = { ...style.lists, [path]: style.lists[path] ?? 'compact' };
    style.quotes = { ...style.quotes };
    style.listItemQuotes = { ...style.listItemQuotes };
    documents[stageId].style = style;
  }
  documents[stageId].dirty = true;
  return rebuildModel(model.envRoot, documents);
}

export function addKey(model: EnvValuesModel, path: string): EnvValuesModel {
  if (hasForbiddenPathSegment(path)) {
    return model;
  }

  for (const document of Object.values(model.documents)) {
    if (document.parseError) {
      continue;
    }
    if (pathExists(document.data, path)) {
      return model;
    }
  }

  for (const stage of model.stages) {
    const cell = getCellState(model, path, stage.id);
    if (cell?.kind === 'conflict') {
      return model;
    }
  }

  for (const document of Object.values(model.documents)) {
    if (document.parseError) {
      continue;
    }
    if (!canSetValueAtPath(document.data, path)) {
      return model;
    }
  }

  const documents = cloneDocuments(model.documents);
  let changed = false;

  for (const document of Object.values(documents)) {
    if (document.parseError) {
      continue;
    }
    if (!setValueAtPath(document.data, path, '')) {
      return model;
    }
    document.dirty = true;
    changed = true;
  }

  if (!changed) {
    return model;
  }

  return rebuildModel(model.envRoot, documents);
}

export function removeKey(model: EnvValuesModel, path: string): EnvValuesModel {
  if (hasForbiddenPathSegment(path)) {
    return model;
  }

  const documents = cloneDocuments(model.documents);
  let changed = false;

  for (const document of Object.values(documents)) {
    if (document.parseError) {
      continue;
    }
    if (pathExists(document.data, path)) {
      deleteValueAtPath(document.data, path);
      document.dirty = true;
      changed = true;
    }
  }

  if (!changed) {
    return model;
  }

  return rebuildModel(model.envRoot, documents);
}
