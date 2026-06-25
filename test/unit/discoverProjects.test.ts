import path from 'path';
import { describe, expect, it } from 'vitest';
import { discoverProjects } from '../../src/features/projectRegistry/discoverProjects';
import { DEFAULT_DISCOVERY_SETTINGS } from '../../src/features/projectRegistry/discoverySettings';
import { isPolicyStudioProject } from '../../src/features/projectDetection/detectPolicyStudioProject';
import { getProjectForFile } from '../../src/features/projectRegistry/discoverProjects';

const fixturesDir = path.join(__dirname, '..', 'fixtures');

const defaultSettings = DEFAULT_DISCOVERY_SETTINGS;

describe('discoverProjects', () => {
  it('discovers two nested projects in monorepo/two-projects', async () => {
    const workspace = path.join(fixturesDir, 'monorepo', 'two-projects');
    const result = await discoverProjects(workspace, workspace, defaultSettings);

    expect(result.projects).toHaveLength(2);
    const relativePaths = result.projects.map((p) => p.relativePath).sort();
    expect(relativePaths).toEqual(['services/a', 'services/legacy/a']);
  });

  it('discovers project at nested depth', async () => {
    const workspace = path.join(fixturesDir, 'monorepo', 'nested-depth');
    const result = await discoverProjects(workspace, workspace, defaultSettings);

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].relativePath).toBe('packages/team/service/policy');
  });

  it('does not treat excluded node_modules as projects', async () => {
    const workspace = path.join(fixturesDir, 'monorepo', 'with-node-modules');
    const result = await discoverProjects(workspace, workspace, defaultSettings);

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].relativePath).toBe('apps/real-gateway');
  });

  it('does not register nested project inside another project tree', async () => {
    const workspace = path.join(fixturesDir, 'monorepo', 'nested-inside-project');
    const result = await discoverProjects(workspace, workspace, defaultSettings);

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].relativePath).toBe('');
  });

  it('discovers single project at workspace root (regression)', async () => {
    const workspace = path.join(fixturesDir, 'sample-policy-project');
    const result = await discoverProjects(workspace, workspace, defaultSettings);

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].relativePath).toBe('');
    expect(result.projects[0].projectType).toBe('xml');
  });

  it('uses relativePath for displayName when basenames collide', async () => {
    const workspace = path.join(fixturesDir, 'monorepo', 'two-projects');
    const result = await discoverProjects(workspace, workspace, defaultSettings);

    const names = result.projects.map((p) => p.displayName).sort();
    expect(names).toEqual(['services/a', 'services/legacy/a']);
  });

  it('assigns stable ids from root path', async () => {
    const workspace = path.join(fixturesDir, 'sample-policy-project');
    const first = await discoverProjects(workspace, workspace, defaultSettings);
    const second = await discoverProjects(workspace, workspace, defaultSettings);

    expect(first.projects[0].id).toBe(second.projects[0].id);
    expect(first.projects[0].id.length).toBeGreaterThan(0);
  });

  it('respects scanDepth 0 (workspace roots only)', async () => {
    const workspace = path.join(fixturesDir, 'monorepo', 'two-projects');
    const result = await discoverProjects(workspace, workspace, {
      ...defaultSettings,
      scanDepth: 0,
    });

    expect(result.projects).toHaveLength(0);
  });

  it('discovers independently per workspace folder (multi-root)', async () => {
    const folderA = path.join(fixturesDir, 'monorepo', 'multi-root', 'folder-a');
    const folderB = path.join(fixturesDir, 'monorepo', 'multi-root', 'folder-b');

    const resultA = await discoverProjects(folderA, folderA, defaultSettings);
    const resultB = await discoverProjects(folderB, folderB, defaultSettings);

    expect(resultA.projects).toHaveLength(1);
    expect(resultA.projects[0].relativePath).toBe('project-a');
    expect(resultB.projects).toHaveLength(1);
    expect(resultB.projects[0].relativePath).toBe('project-b');
  });
});

describe('isPolicyStudioProject (primitive)', () => {
  it('remains usable independently of registry scan', () => {
    const projectA = path.join(fixturesDir, 'monorepo', 'two-projects', 'services', 'a');
    expect(isPolicyStudioProject(projectA)).toBe(true);
    expect(isPolicyStudioProject(path.join(fixturesDir, 'normal-folder'))).toBe(false);
  });
});

describe('getProjectForFile', () => {
  it('returns the correct project for files in nested projects', async () => {
    const workspace = path.join(fixturesDir, 'monorepo', 'two-projects');
    const result = await discoverProjects(workspace, workspace, defaultSettings);

    const fileA = path.join(workspace, 'services', 'a', 'PrimaryStore.xml');
    const fileB = path.join(workspace, 'services', 'legacy', 'a', 'PrimaryStore.xml');

    const projectA = getProjectForFile(fileA, result.projects);
    const projectB = getProjectForFile(fileB, result.projects);

    expect(projectA?.relativePath).toBe('services/a');
    expect(projectB?.relativePath).toBe('services/legacy/a');
    expect(projectA?.id).not.toBe(projectB?.id);
  });

  it('returns undefined for files outside any project', async () => {
    const workspace = path.join(fixturesDir, 'monorepo', 'two-projects');
    const result = await discoverProjects(workspace, workspace, defaultSettings);

    const readme = path.join(workspace, 'README.md');
    expect(getProjectForFile(readme, result.projects)).toBeUndefined();
  });
});
