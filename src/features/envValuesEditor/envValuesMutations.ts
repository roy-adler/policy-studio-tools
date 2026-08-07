import {
  buildEnvValuesModel,
  canSetValueAtPath,
  deleteValueAtPath,
  hasForbiddenPathSegment,
  pathExists,
  setValueAtPath,
} from './envValuesModel';
import type { EnvCellState, EnvScalar, EnvStageDocument, EnvValuesModel } from './types';

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

  const documents = cloneDocuments(model.documents);
  if (!setValueAtPath(documents[stageId].data, path, '')) {
    return model;
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
