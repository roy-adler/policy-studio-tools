import {
  circuitKey,
  circuitsSemanticallyEqual,
  filtersEqual,
  filtersFingerprint,
} from './semanticModel';
import type {
  BackendUrlChange,
  CircuitChange,
  CircuitRenameChange,
  DiffSummary,
  FilterChange,
  ModifiedCircuitChange,
  PathTemplateChange,
  PolicyDiffReport,
  PolicySnapshot,
  ReferenceChange,
  ScriptChange,
  SemanticCircuit,
  SemanticFilter,
} from './types';

const FORMATTING_ONLY_NOTE =
  'Formatting-only differences in YAML or XML serialization are ignored; only semantic changes appear below.';

function buildCircuitMap(snapshot: PolicySnapshot): Map<string, SemanticCircuit> {
  const map = new Map<string, SemanticCircuit>();
  for (const circuit of snapshot.circuits) {
    map.set(circuitKey(circuit), circuit);
  }
  return map;
}

function compareFilterOrder(
  leftFilters: SemanticFilter[],
  rightFilters: SemanticFilter[],
): FilterChange[] {
  const changes: FilterChange[] = [];
  const sharedNames = leftFilters
    .map((filter) => filter.name)
    .filter((name) => rightFilters.some((filter) => filter.name === name));

  if (sharedNames.length < 2) {
    return changes;
  }

  const leftOrder = sharedNames
    .slice()
    .sort(
      (a, b) =>
        leftFilters.findIndex((filter) => filter.name === a) -
        leftFilters.findIndex((filter) => filter.name === b),
    )
    .join('>');
  const rightOrder = sharedNames
    .slice()
    .sort(
      (a, b) =>
        rightFilters.findIndex((filter) => filter.name === a) -
        rightFilters.findIndex((filter) => filter.name === b),
    )
    .join('>');

  if (leftOrder === rightOrder) {
    return changes;
  }

  for (const name of sharedNames) {
    const leftIndex = leftFilters.findIndex((filter) => filter.name === name);
    const rightIndex = rightFilters.findIndex((filter) => filter.name === name);
    if (leftIndex !== rightIndex) {
      changes.push({
        kind: 'reordered',
        circuitName: '',
        filterName: name,
        sourceFilePath: '',
      });
    }
  }

  return changes;
}

function compareFilters(
  circuitName: string,
  sourceFilePath: string,
  leftFilters: SemanticFilter[],
  rightFilters: SemanticFilter[],
): {
  filterChanges: FilterChange[];
  scriptChanges: ScriptChange[];
  pathChanges: PathTemplateChange[];
  urlChanges: BackendUrlChange[];
  referenceChanges: ReferenceChange[];
} {
  const filterChanges: FilterChange[] = [];
  const scriptChanges: ScriptChange[] = [];
  const pathChanges: PathTemplateChange[] = [];
  const urlChanges: BackendUrlChange[] = [];
  const referenceChanges: ReferenceChange[] = [];

  const leftByName = new Map(leftFilters.map((filter) => [filter.name, filter]));
  const rightByName = new Map(rightFilters.map((filter) => [filter.name, filter]));

  for (const left of leftFilters) {
    const right = rightByName.get(left.name);
    if (!right) {
      filterChanges.push({
        kind: 'removed',
        circuitName,
        filterName: left.name,
        sourceFilePath,
      });
      continue;
    }

    if (!filtersEqual(left, right)) {
      filterChanges.push({
        kind: 'modified',
        circuitName,
        filterName: left.name,
        sourceFilePath,
      });

      if ((left.script ?? '') !== (right.script ?? '')) {
        scriptChanges.push({
          circuitName,
          filterName: left.name,
          sourceFilePath,
          before: left.script ?? '',
          after: right.script ?? '',
        });
      }

      const leftPaths = left.pathTemplates.join('\n');
      const rightPaths = right.pathTemplates.join('\n');
      if (leftPaths !== rightPaths) {
        pathChanges.push({
          circuitName,
          filterName: left.name,
          sourceFilePath,
          before: left.pathTemplates.join(', ') || '(none)',
          after: right.pathTemplates.join(', ') || '(none)',
        });
      }

      const leftUrls = left.backendUrls.join('\n');
      const rightUrls = right.backendUrls.join('\n');
      if (leftUrls !== rightUrls) {
        urlChanges.push({
          circuitName,
          filterName: left.name,
          sourceFilePath,
          before: left.backendUrls.join(', ') || '(none)',
          after: right.backendUrls.join(', ') || '(none)',
        });
      }

      const leftRefs = left.referencedCircuits.join(',');
      const rightRefs = right.referencedCircuits.join(',');
      if (leftRefs !== rightRefs) {
        referenceChanges.push({
          circuitName,
          filterName: left.name,
          sourceFilePath,
          before: [...left.referencedCircuits],
          after: [...right.referencedCircuits],
        });
      }
    }
  }

  for (const right of rightFilters) {
    if (!leftByName.has(right.name)) {
      filterChanges.push({
        kind: 'added',
        circuitName,
        filterName: right.name,
        sourceFilePath,
      });
    }
  }

  const reorderChanges = compareFilterOrder(leftFilters, rightFilters).map((change) => ({
    ...change,
    circuitName,
    sourceFilePath,
  }));

  for (const change of reorderChanges) {
    if (!filterChanges.some((entry) => entry.filterName === change.filterName && entry.kind === 'reordered')) {
      filterChanges.push(change);
    }
  }

  return { filterChanges, scriptChanges, pathChanges, urlChanges, referenceChanges };
}

function detectRenames(
  leftMap: Map<string, SemanticCircuit>,
  rightMap: Map<string, SemanticCircuit>,
  matchedKeys: Set<string>,
): CircuitRenameChange[] {
  const renames: CircuitRenameChange[] = [];

  for (const [key, left] of leftMap.entries()) {
    if (matchedKeys.has(key)) {
      continue;
    }

    for (const [rightKey, right] of rightMap.entries()) {
      if (matchedKeys.has(rightKey)) {
        continue;
      }
      if (left.sourceFilePath !== right.sourceFilePath) {
        continue;
      }
      if (left.name === right.name) {
        continue;
      }
      if (filtersFingerprint(left.filters) !== filtersFingerprint(right.filters)) {
        continue;
      }
      if ((left.startFilter ?? '') !== (right.startFilter ?? '')) {
        continue;
      }

      renames.push({
        sourceFilePath: left.sourceFilePath,
        beforeName: left.name,
        afterName: right.name,
      });
      matchedKeys.add(key);
      matchedKeys.add(rightKey);
      break;
    }
  }

  return renames;
}

function buildSummary(report: Omit<PolicyDiffReport, 'summary' | 'identical'>): DiffSummary {
  let addedFilters = 0;
  let removedFilters = 0;
  let modifiedFilters = 0;
  let reorderedFilters = 0;
  let scriptChanges = 0;
  let pathChanges = 0;
  let urlChanges = 0;
  let referenceChanges = 0;

  for (const modified of report.modifiedCircuits) {
    for (const change of modified.filterChanges) {
      switch (change.kind) {
        case 'added':
          addedFilters += 1;
          break;
        case 'removed':
          removedFilters += 1;
          break;
        case 'modified':
          modifiedFilters += 1;
          break;
        case 'reordered':
          reorderedFilters += 1;
          break;
        default:
          break;
      }
    }
    scriptChanges += modified.scriptChanges.length;
    pathChanges += modified.pathChanges.length;
    urlChanges += modified.urlChanges.length;
    referenceChanges += modified.referenceChanges.length;
  }

  return {
    addedCircuits: report.addedCircuits.length,
    removedCircuits: report.removedCircuits.length,
    modifiedCircuits: report.modifiedCircuits.length,
    renamedCircuits: report.renamedCircuits.length,
    addedFilters,
    removedFilters,
    modifiedFilters,
    reorderedFilters,
    scriptChanges,
    pathChanges,
    urlChanges,
    referenceChanges,
    leftOnlyFiles: report.leftOnlyFiles.length,
    rightOnlyFiles: report.rightOnlyFiles.length,
    unparseableLeft: report.unparseableLeft.length,
    unparseableRight: report.unparseableRight.length,
  };
}

export function compareSnapshots(left: PolicySnapshot, right: PolicySnapshot): PolicyDiffReport {
  const leftMap = buildCircuitMap(left);
  const rightMap = buildCircuitMap(right);
  const matchedKeys = new Set<string>();

  const addedCircuits: CircuitChange[] = [];
  const removedCircuits: CircuitChange[] = [];
  const modifiedCircuits: ModifiedCircuitChange[] = [];

  for (const [key, leftCircuit] of leftMap.entries()) {
    const rightCircuit = rightMap.get(key);
    if (!rightCircuit) {
      continue;
    }

    matchedKeys.add(key);

    if (circuitsSemanticallyEqual(leftCircuit, rightCircuit)) {
      continue;
    }

    const {
      filterChanges,
      scriptChanges,
      pathChanges,
      urlChanges,
      referenceChanges,
    } = compareFilters(
      leftCircuit.name,
      leftCircuit.sourceFilePath,
      leftCircuit.filters,
      rightCircuit.filters,
    );

    const startFilterChange =
      (leftCircuit.startFilter ?? '') !== (rightCircuit.startFilter ?? '')
        ? { before: leftCircuit.startFilter, after: rightCircuit.startFilter }
        : undefined;

    modifiedCircuits.push({
      circuitName: leftCircuit.name,
      sourceFilePath: leftCircuit.sourceFilePath,
      filterChanges,
      scriptChanges,
      pathChanges,
      urlChanges,
      referenceChanges,
      startFilterChange,
    });
  }

  const renamedCircuits = detectRenames(leftMap, rightMap, matchedKeys);

  for (const [key, leftCircuit] of leftMap.entries()) {
    if (matchedKeys.has(key)) {
      continue;
    }
    removedCircuits.push({
      circuitName: leftCircuit.name,
      sourceFilePath: leftCircuit.sourceFilePath,
    });
  }

  for (const [key, rightCircuit] of rightMap.entries()) {
    if (matchedKeys.has(key)) {
      continue;
    }
    addedCircuits.push({
      circuitName: rightCircuit.name,
      sourceFilePath: rightCircuit.sourceFilePath,
    });
  }

  const leftOnlyFiles = left.policyFiles.filter((file) => !right.policyFiles.includes(file));
  const rightOnlyFiles = right.policyFiles.filter((file) => !left.policyFiles.includes(file));

  const partialReport = {
    leftLabel: left.label,
    rightLabel: right.label,
    addedCircuits,
    removedCircuits,
    renamedCircuits,
    modifiedCircuits,
    leftOnlyFiles,
    rightOnlyFiles,
    unparseableLeft: left.unparseableFiles,
    unparseableRight: right.unparseableFiles,
    formattingOnlyNote: FORMATTING_ONLY_NOTE,
  };

  const summary = buildSummary(partialReport);
  const identical =
    summary.addedCircuits === 0 &&
    summary.removedCircuits === 0 &&
    summary.modifiedCircuits === 0 &&
    summary.renamedCircuits === 0 &&
    summary.leftOnlyFiles === 0 &&
    summary.rightOnlyFiles === 0;

  return {
    ...partialReport,
    summary,
    identical,
  };
}
