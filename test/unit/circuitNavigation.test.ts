import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  jumpToCircuit,
  looksLikeCircuitReference,
  normalizeCircuitName,
  resolveCircuitDefinitions,
} from '../../src/features/circuitNavigation/circuitNavigation';
import type {
  CircuitDefinitionCandidate,
  CircuitNavigationDeps,
  NavigationHost,
} from '../../src/features/circuitNavigation/types';
import { buildCircuitIndex } from '../../src/features/circuitSearch/circuitIndex';
import { getProjectForFile } from '../../src/features/projectRegistry/discoverProjects';
import type { PolicyStudioProject } from '../../src/features/projectRegistry/types';

const fixturesDir = path.join(__dirname, '..', 'fixtures', 'jump-to-circuit');
const searchFixturesDir = path.join(__dirname, '..', 'fixtures', 'circuit-search');

function xmlProject(name: string, rootPath?: string): PolicyStudioProject {
  const root = rootPath ?? path.join(fixturesDir, name);
  return {
    id: `jump-${name}`,
    rootPath: root,
    workspaceFolder: root,
    relativePath: '',
    displayName: name,
    projectType: 'xml',
  };
}

function yamlProject(name: string, rootPath: string): PolicyStudioProject {
  return {
    id: `jump-${name}`,
    rootPath,
    workspaceFolder: rootPath,
    relativePath: '',
    displayName: name,
    projectType: 'yaml',
  };
}

interface HostCalls {
  opened: CircuitDefinitionCandidate[];
  pickedFrom: CircuitDefinitionCandidate[][];
  notFound: Array<{ circuitName: string; offerSearchAllProjects: boolean }>;
  validationErrors: string[];
  errors: string[];
}

function createHost(options?: {
  pick?: (candidates: CircuitDefinitionCandidate[]) => CircuitDefinitionCandidate | undefined;
  notFoundAction?: 'searchAllProjects';
  openError?: Error;
}): { host: NavigationHost; calls: HostCalls } {
  const calls: HostCalls = {
    opened: [],
    pickedFrom: [],
    notFound: [],
    validationErrors: [],
    errors: [],
  };

  const host: NavigationHost = {
    async openDefinition(candidate) {
      if (options?.openError) {
        throw options.openError;
      }
      calls.opened.push(candidate);
    },
    async pickDefinition(candidates) {
      calls.pickedFrom.push(candidates);
      return options?.pick ? options.pick(candidates) : undefined;
    },
    async showNotFound(circuitName, offerSearchAllProjects) {
      calls.notFound.push({ circuitName, offerSearchAllProjects });
      return offerSearchAllProjects ? options?.notFoundAction : undefined;
    },
    showValidationError(message) {
      calls.validationErrors.push(message);
    },
    showError(message) {
      calls.errors.push(message);
    },
  };

  return { host, calls };
}

function createDeps(projects: PolicyStudioProject[], host: NavigationHost): CircuitNavigationDeps {
  return {
    getProjects: () => projects,
    getProjectForFile: (filePath) => getProjectForFile(filePath, projects),
    getIndex: (project) => buildCircuitIndex(project),
    host,
  };
}

describe('normalizeCircuitName', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeCircuitName('  PaymentService  ')).toBe('PaymentService');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeCircuitName('   ')).toBe('');
  });
});

describe('looksLikeCircuitReference', () => {
  it('accepts plain circuit names', () => {
    expect(looksLikeCircuitReference('PaymentService')).toBe(true);
    expect(looksLikeCircuitReference('Health Check')).toBe(true);
  });

  it('rejects empty or whitespace-only text', () => {
    expect(looksLikeCircuitReference('')).toBe(false);
    expect(looksLikeCircuitReference('   ')).toBe(false);
  });

  it('rejects markup-like text', () => {
    expect(looksLikeCircuitReference('<Circuit name="X">')).toBe(false);
    expect(looksLikeCircuitReference('"quoted"')).toBe(false);
  });

  it('rejects unreasonably long text', () => {
    expect(looksLikeCircuitReference('x'.repeat(500))).toBe(false);
  });
});

describe('resolveCircuitDefinitions', () => {
  it('resolves a uniquely named circuit to one definition', async () => {
    const project = xmlProject('unique');
    const { host } = createHost();
    const deps = createDeps([project], host);

    const definitions = await resolveCircuitDefinitions(deps, project.id, 'PaymentService');

    expect(definitions).toHaveLength(1);
    expect(definitions[0].filePath).toContain('PaymentService.xml');
    expect(definitions[0].circuitName).toBe('PaymentService');
  });

  it('matches names case-insensitively with whitespace trimmed', async () => {
    const project = xmlProject('unique');
    const { host } = createHost();
    const deps = createDeps([project], host);

    const definitions = await resolveCircuitDefinitions(deps, project.id, '  paymentservice ');

    expect(definitions).toHaveLength(1);
    expect(definitions[0].circuitName).toBe('PaymentService');
  });

  it('returns all definitions for duplicate circuit names', async () => {
    const project = xmlProject('duplicates');
    const { host } = createHost();
    const deps = createDeps([project], host);

    const definitions = await resolveCircuitDefinitions(deps, project.id, 'SharedAuth');

    expect(definitions).toHaveLength(2);
    expect(new Set(definitions.map((d) => d.filePath)).size).toBe(2);
  });

  it('returns empty array when the circuit does not exist', async () => {
    const project = xmlProject('missing');
    const { host } = createHost();
    const deps = createDeps([project], host);

    const definitions = await resolveCircuitDefinitions(deps, project.id, 'NonExistentCircuit');

    expect(definitions).toHaveLength(0);
  });

  it('returns empty array for unknown project id', async () => {
    const project = xmlProject('unique');
    const { host } = createHost();
    const deps = createDeps([project], host);

    const definitions = await resolveCircuitDefinitions(deps, 'no-such-project', 'PaymentService');

    expect(definitions).toHaveLength(0);
  });

  it('returns empty array for empty circuit name', async () => {
    const project = xmlProject('unique');
    const { host } = createHost();
    const deps = createDeps([project], host);

    const definitions = await resolveCircuitDefinitions(deps, project.id, '   ');

    expect(definitions).toHaveLength(0);
  });

  it('resolves circuits in YAML projects', async () => {
    const project = yamlProject('yaml', path.join(searchFixturesDir, 'yaml-project'));
    const { host } = createHost();
    const deps = createDeps([project], host);

    const definitions = await resolveCircuitDefinitions(deps, project.id, 'YamlPaymentService');

    expect(definitions).toHaveLength(1);
    expect(definitions[0].filePath).toContain('YamlPaymentService.yaml');
  });
});

describe('jumpToCircuit', () => {
  it('opens the definition directly for a unique match', async () => {
    const project = xmlProject('unique');
    const { host, calls } = createHost();
    const deps = createDeps([project], host);

    const result = await jumpToCircuit(deps, 'PaymentService', { projectId: project.id });

    expect(result.kind).toBe('opened');
    expect(calls.opened).toHaveLength(1);
    expect(calls.opened[0].filePath).toContain('PaymentService.xml');
    expect(calls.pickedFrom).toHaveLength(0);
  });

  it('shows a picker for duplicate definitions and opens the selection', async () => {
    const project = xmlProject('duplicates');
    const { host, calls } = createHost({ pick: (candidates) => candidates[1] });
    const deps = createDeps([project], host);

    const result = await jumpToCircuit(deps, 'SharedAuth', { projectId: project.id });

    expect(result.kind).toBe('picked');
    expect(calls.pickedFrom).toHaveLength(1);
    expect(calls.pickedFrom[0]).toHaveLength(2);
    expect(calls.opened).toHaveLength(1);
    expect(calls.opened[0]).toBe(calls.pickedFrom[0][1]);
  });

  it('returns cancelled when the user dismisses the picker', async () => {
    const project = xmlProject('duplicates');
    const { host, calls } = createHost({ pick: () => undefined });
    const deps = createDeps([project], host);

    const result = await jumpToCircuit(deps, 'SharedAuth', { projectId: project.id });

    expect(result.kind).toBe('cancelled');
    expect(calls.opened).toHaveLength(0);
  });

  it('returns notFound and warns when the circuit does not exist', async () => {
    const project = xmlProject('missing');
    const { host, calls } = createHost();
    const deps = createDeps([project], host);

    const result = await jumpToCircuit(deps, 'NonExistentCircuit', { projectId: project.id });

    expect(result.kind).toBe('notFound');
    expect(calls.notFound.length).toBeGreaterThanOrEqual(1);
    expect(calls.notFound[0].circuitName).toBe('NonExistentCircuit');
    expect(calls.opened).toHaveLength(0);
  });

  it('returns error for empty circuit name without navigating', async () => {
    const project = xmlProject('unique');
    const { host, calls } = createHost();
    const deps = createDeps([project], host);

    const result = await jumpToCircuit(deps, '   ');

    expect(result.kind).toBe('error');
    expect(calls.validationErrors).toHaveLength(1);
    expect(calls.opened).toHaveLength(0);
    expect(calls.notFound).toHaveLength(0);
  });

  it('searches remaining projects when searchAllProjects option is set', async () => {
    const missing = xmlProject('missing');
    const unique = xmlProject('unique');
    const { host, calls } = createHost();
    const deps = createDeps([missing, unique], host);

    const result = await jumpToCircuit(deps, 'PaymentService', {
      projectId: missing.id,
      searchAllProjects: true,
    });

    expect(result.kind).toBe('opened');
    expect(calls.opened).toHaveLength(1);
    expect(calls.opened[0].projectId).toBe(unique.id);
  });

  it('offers to search all projects on miss and honours acceptance', async () => {
    const missing = xmlProject('missing');
    const unique = xmlProject('unique');
    const { host, calls } = createHost({ notFoundAction: 'searchAllProjects' });
    const deps = createDeps([missing, unique], host);

    const result = await jumpToCircuit(deps, 'PaymentService', { projectId: missing.id });

    expect(calls.notFound[0]).toEqual({
      circuitName: 'PaymentService',
      offerSearchAllProjects: true,
    });
    expect(result.kind).toBe('opened');
    expect(calls.opened[0].projectId).toBe(unique.id);
  });

  it('returns notFound when user declines searching all projects', async () => {
    const missing = xmlProject('missing');
    const unique = xmlProject('unique');
    const { host, calls } = createHost();
    const deps = createDeps([missing, unique], host);

    const result = await jumpToCircuit(deps, 'PaymentService', { projectId: missing.id });

    expect(result.kind).toBe('notFound');
    expect(calls.opened).toHaveLength(0);
  });

  it('infers the owning project from the source file path', async () => {
    const unique = xmlProject('unique');
    const duplicates = xmlProject('duplicates');
    const { host, calls } = createHost();
    const deps = createDeps([duplicates, unique], host);

    const result = await jumpToCircuit(deps, 'PaymentService', {
      sourceFilePath: path.join(unique.rootPath, 'policies', 'PaymentService.xml'),
    });

    expect(result.kind).toBe('opened');
    expect(calls.opened[0].projectId).toBe(unique.id);
  });

  it('searches all projects when no owning project can be resolved', async () => {
    const missing = xmlProject('missing');
    const unique = xmlProject('unique');
    const { host, calls } = createHost();
    const deps = createDeps([missing, unique], host);

    const result = await jumpToCircuit(deps, 'PaymentService');

    expect(result.kind).toBe('opened');
    expect(calls.opened[0].projectId).toBe(unique.id);
  });

  it('includes project metadata on candidates from multiple projects', async () => {
    const teamA = xmlProject('duplicates');
    const { host, calls } = createHost({ pick: (candidates) => candidates[0] });
    const deps = createDeps([teamA], host);

    await jumpToCircuit(deps, 'SharedAuth', { projectId: teamA.id });

    for (const candidate of calls.pickedFrom[0]) {
      expect(candidate.projectId).toBe(teamA.id);
      expect(candidate.projectDisplayName).toBe(teamA.displayName);
    }
  });

  it('returns error when the target file cannot be opened', async () => {
    const project = xmlProject('unique');
    const { host, calls } = createHost({ openError: new Error('file deleted') });
    const deps = createDeps([project], host);

    const result = await jumpToCircuit(deps, 'PaymentService', { projectId: project.id });

    expect(result.kind).toBe('error');
    expect(calls.errors).toHaveLength(1);
    expect(calls.errors[0]).toContain('PaymentService.xml');
  });

  it('returns notFound when there are no projects', async () => {
    const { host, calls } = createHost();
    const deps = createDeps([], host);

    const result = await jumpToCircuit(deps, 'PaymentService');

    expect(result.kind).toBe('notFound');
    expect(calls.opened).toHaveLength(0);
  });
});

/**
 * Integration test (VS Code host): manual test plan
 * 1. Open test/fixtures/jump-to-circuit/duplicates in VS Code.
 * 2. Run "Policy Studio: Jump to Circuit" and enter/select "SharedAuth" (e.g. place the
 *    cursor on the word SharedAuth in team-a/SharedAuth.xml first).
 * 3. Confirm a quick pick lists both team-a/SharedAuth.xml and team-b/SharedAuth.xml.
 * 4. Select an entry and confirm the file opens with the circuit element revealed
 *    and selected (editor scrolls the range into view).
 * 5. Open test/fixtures/jump-to-circuit/missing, place the cursor on
 *    "NonExistentCircuit" in policies/Caller.xml, run the command, and confirm a
 *    warning notification appears with a "Search Circuits" action and no editor opens.
 * 6. Open test/fixtures/jump-to-circuit/references and follow the CircuitA → CircuitB
 *    → CircuitC chain via circuit search "Go to circuit" actions.
 */
