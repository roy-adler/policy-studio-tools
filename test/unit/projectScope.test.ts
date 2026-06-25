import path from 'path';
import { describe, expect, it } from 'vitest';
import { discoverProjects } from '../../src/features/projectRegistry/discoverProjects';
import { DEFAULT_DISCOVERY_SETTINGS } from '../../src/features/projectRegistry/discoverySettings';
import {
  getProjectsInScope,
  resolveDefaultScope,
} from '../../src/features/projectRegistry/projectScope';
import type { PolicyStudioProject, ProjectScope } from '../../src/features/projectRegistry/types';

const fixturesDir = path.join(__dirname, '..', 'fixtures');

async function loadTwoProjects(): Promise<PolicyStudioProject[]> {
  const workspace = path.join(fixturesDir, 'monorepo', 'two-projects');
  const result = await discoverProjects(workspace, workspace, DEFAULT_DISCOVERY_SETTINGS);
  return result.projects;
}

describe('getProjectsInScope', () => {
  it('returns all projects for allProjects scope', async () => {
    const projects = await loadTwoProjects();
    const scope: ProjectScope = { mode: 'allProjects' };

    expect(getProjectsInScope(projects, scope)).toHaveLength(2);
  });

  it('returns active project for activeProject scope', async () => {
    const projects = await loadTwoProjects();
    const activeId = projects[0].id;
    const scope: ProjectScope = { mode: 'activeProject', activeProjectId: activeId };

    const inScope = getProjectsInScope(projects, scope);
    expect(inScope).toHaveLength(1);
    expect(inScope[0].id).toBe(activeId);
  });

  it('returns selected subset for selectedProjects scope', async () => {
    const projects = await loadTwoProjects();
    const scope: ProjectScope = {
      mode: 'selectedProjects',
      selectedProjectIds: [projects[1].id],
    };

    const inScope = getProjectsInScope(projects, scope);
    expect(inScope).toHaveLength(1);
    expect(inScope[0].id).toBe(projects[1].id);
  });
});

describe('resolveDefaultScope', () => {
  it('defaults to activeProject when file belongs to a project', async () => {
    const projects = await loadTwoProjects();
    const workspace = path.join(fixturesDir, 'monorepo', 'two-projects');
    const filePath = path.join(workspace, 'services', 'a', 'PrimaryStore.xml');
    const project = projects.find((p) => p.relativePath === 'services/a');

    const scope = resolveDefaultScope(projects, filePath);
    expect(scope.mode).toBe('activeProject');
    expect(scope.activeProjectId).toBe(project?.id);
  });

  it('defaults to allProjects when file is outside any project', async () => {
    const projects = await loadTwoProjects();
    const workspace = path.join(fixturesDir, 'monorepo', 'two-projects');
    const filePath = path.join(workspace, 'README.md');

    const scope = resolveDefaultScope(projects, filePath);
    expect(scope.mode).toBe('allProjects');
  });

  it('defaults to allProjects when no active file is provided', async () => {
    const projects = await loadTwoProjects();
    const scope = resolveDefaultScope(projects, undefined);
    expect(scope.mode).toBe('allProjects');
  });
});
