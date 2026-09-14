import { describe, expect, it } from 'vitest';
import { buildProjectsTree, formatScopeSummary } from '../../src/features/toolsSidebar/projectsTreeModel';
import type { PolicyStudioProject, ProjectRegistry, ProjectScope } from '../../src/features/projectRegistry/types';
import {
  buildToolsTree,
  flattenToolCommands,
  sortRegisteredTools,
} from '../../src/features/toolsSidebar/toolsTreeModel';
import { ToolsHubService } from '../../src/features/toolsSidebar/toolsHubService';
import type { ToolsHubTool } from '../../src/features/toolsSidebar/types';

function sampleProject(overrides: Partial<PolicyStudioProject> = {}): PolicyStudioProject {
  return {
    id: 'proj-1',
    rootPath: '/repo/gateway',
    workspaceFolder: 'file:///repo',
    relativePath: 'gateway',
    displayName: 'gateway',
    projectType: 'xml',
    ...overrides,
  };
}

describe('formatScopeSummary', () => {
  it('describes active, all, and selected scopes', () => {
    const projects = [
      sampleProject(),
      sampleProject({ id: 'proj-2', displayName: 'legacy', relativePath: 'legacy' }),
    ];

    expect(formatScopeSummary(projects, { mode: 'allProjects' })).toBe('All projects (2)');
    expect(
      formatScopeSummary(projects, {
        mode: 'selectedProjects',
        selectedProjectIds: ['proj-1'],
      }),
    ).toBe('Selected: 1 project(s)');
    expect(
      formatScopeSummary(projects, { mode: 'activeProject', activeProjectId: 'proj-1' }),
    ).toBe('Active: gateway');
  });
});

describe('buildProjectsTree', () => {
  it('returns empty-state nodes when no projects are discovered', () => {
    const registry: ProjectRegistry = {
      projects: [],
      discoveredAt: new Date(),
      warnings: [],
    };
    const nodes = buildProjectsTree(registry, { mode: 'allProjects' });

    expect(nodes[0].kind).toBe('empty');
    expect(nodes.some((node) => node.kind === 'refresh')).toBe(true);
  });

  it('lists projects, scope summary, and warnings', () => {
    const registry: ProjectRegistry = {
      projects: [sampleProject()],
      discoveredAt: new Date(),
      warnings: ['Unable to read directory: /denied'],
    };
    const scope: ProjectScope = { mode: 'activeProject', activeProjectId: 'proj-1' };
    const nodes = buildProjectsTree(registry, scope, 'list');

    expect(nodes.some((node) => node.kind === 'scope')).toBe(true);
    expect(nodes.some((node) => node.kind === 'project' && node.projectId === 'proj-1')).toBe(true);
    expect(nodes.some((node) => node.kind === 'warning')).toBe(true);
  });
});

describe('buildProjectsTree path tree', () => {
  it('shows YAML POLICYNAME/POLICYNAME_yaml bundles as project leaves under the shared parent', () => {
    const registry: ProjectRegistry = {
      projects: [
        sampleProject({
          id: 'a',
          displayName: 'AUTH_GATEWAY',
          relativePath: 'policies/AUTH_GATEWAY/AUTH_GATEWAY_YAML',
          workspaceFolder: 'file:///repo',
          rootPath: '/repo/policies/AUTH_GATEWAY/AUTH_GATEWAY_YAML',
        }),
        sampleProject({
          id: 'b',
          displayName: 'PAYMENT_API',
          relativePath: 'policies/PAYMENT_API/PAYMENT_API_YAML',
          workspaceFolder: 'file:///repo',
          rootPath: '/repo/policies/PAYMENT_API/PAYMENT_API_YAML',
        }),
      ],
      discoveredAt: new Date(),
      warnings: [],
    };
    const roots = buildProjectsTree(registry, { mode: 'allProjects' }, 'tree');
    const folders = roots.filter((n) => n.kind === 'folder');
    expect(folders).toHaveLength(1);
    expect(folders[0].label).toBe('policies');
    const children = folders[0].children ?? [];
    expect(children.every((n) => n.kind === 'project')).toBe(true);
    expect(children.map((n) => n.label).sort()).toEqual(['AUTH_GATEWAY', 'PAYMENT_API']);
  });

  it('keeps a folder for a sole non-bundle project and shows the project as its child', () => {
    const roots = buildProjectsTree(
      {
        projects: [sampleProject({ relativePath: 'apps/gateway', displayName: 'gateway', rootPath: '/repo/apps/gateway' })],
        discoveredAt: new Date(),
        warnings: [],
      },
      { mode: 'allProjects' },
      'tree',
    );
    const folders = roots.filter((n) => n.kind === 'folder');
    expect(folders).toHaveLength(1);
    expect(folders[0].label).toBe('apps');
    expect(folders[0].children).toEqual([
      expect.objectContaining({ kind: 'project', label: 'gateway' }),
    ]);
  });

  it('does not wrap workspaceFolder when only one workspace root', () => {
    const roots = buildProjectsTree(
      {
        projects: [sampleProject({ relativePath: 'gateway', displayName: 'gateway' })],
        discoveredAt: new Date(),
        warnings: [],
      },
      { mode: 'allProjects' },
      'tree',
    );
    expect(roots.some((n) => n.kind === 'workspaceFolder')).toBe(false);
  });

  it('wraps under workspaceFolder when multiple workspace roots', () => {
    const roots = buildProjectsTree(
      {
        projects: [
          sampleProject({
            id: '1',
            workspaceFolder: 'file:///repo-a',
            relativePath: 'gw',
            displayName: 'gw',
            rootPath: '/repo-a/gw',
          }),
          sampleProject({
            id: '2',
            workspaceFolder: 'file:///repo-b',
            relativePath: 'gw',
            displayName: 'gw',
            rootPath: '/repo-b/gw',
          }),
        ],
        discoveredAt: new Date(),
        warnings: [],
      },
      { mode: 'allProjects' },
      'tree',
    );
    const ws = roots.filter((n) => n.kind === 'workspaceFolder');
    expect(ws).toHaveLength(2);
  });

  it('list mode stays flat with project kind nodes and no children', () => {
    const roots = buildProjectsTree(
      {
        projects: [
          sampleProject({
            relativePath: 'policies/AUTH_GATEWAY/AUTH_GATEWAY_YAML',
            displayName: 'AUTH_GATEWAY',
            rootPath: '/repo/policies/AUTH_GATEWAY/AUTH_GATEWAY_YAML',
          }),
        ],
        discoveredAt: new Date(),
        warnings: [],
      },
      { mode: 'allProjects' },
      'list',
    );
    const projects = roots.filter((n) => n.kind === 'project');
    expect(projects).toHaveLength(1);
    expect(projects[0].children).toBeUndefined();
    expect(projects[0].label).toBe('AUTH_GATEWAY');
  });

  it('places root-level project as leaf without empty folder', () => {
    const roots = buildProjectsTree(
      {
        projects: [sampleProject({ relativePath: '', displayName: 'root-proj' })],
        discoveredAt: new Date(),
        warnings: [],
      },
      { mode: 'allProjects' },
      'tree',
    );
    expect(roots.some((n) => n.kind === 'project' && n.label === 'root-proj')).toBe(true);
    expect(roots.some((n) => n.kind === 'folder')).toBe(false);
  });
});

describe('buildToolsTree', () => {
  const implementedTool: ToolsHubTool = {
    id: 'search-circuits',
    label: 'Search circuits',
    iconId: 'search',
    command: 'policyStudioTools.searchCircuits',
    group: 'navigate',
    order: 1,
    available: true,
  };

  const futureTool: ToolsHubTool = {
    id: 'jump-to-circuit',
    label: 'Jump to circuit',
    iconId: 'link',
    command: 'policyStudioTools.jumpToCircuit',
    group: 'navigate',
    order: 2,
    available: false,
  };

  it('shows only refresh when no project is detected', () => {
    const nodes = buildToolsTree([implementedTool, futureTool], false);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe('refresh');
  });

  it('shows available tools in groups and hides unavailable ones', () => {
    const nodes = buildToolsTree([implementedTool, futureTool], true);
    expect(nodes.some((node) => node.id === 'refresh')).toBe(true);
    expect(nodes.some((node) => node.id === 'group-navigate')).toBe(true);
    const navigateGroup = nodes.find((node) => node.id === 'group-navigate');
    expect(navigateGroup?.children?.map((child) => child.id)).toEqual(['search-circuits']);
  });
});

describe('ToolsHubService', () => {
  it('registers tools and preserves group ordering', () => {
    const hub = new ToolsHubService();
    hub.registerTool({
      id: 'export-docs',
      label: 'Export documentation',
      iconId: 'export',
      command: 'policyStudioTools.exportDocumentation',
      group: 'export',
      order: 1,
      available: false,
    });
    hub.registerTool({
      id: 'search-circuits',
      label: 'Search circuits',
      iconId: 'search',
      command: 'policyStudioTools.searchCircuits',
      group: 'navigate',
      order: 1,
      available: true,
    });

    const sorted = sortRegisteredTools(hub.getTools());
    expect(sorted[0].group).toBe('navigate');
    expect(flattenToolCommands(sorted)).toEqual(['policyStudioTools.searchCircuits']);
  });
});
