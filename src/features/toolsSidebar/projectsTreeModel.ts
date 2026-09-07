import type { PolicyStudioProject, ProjectRegistry, ProjectScope } from '../projectRegistry/types';

export type ProjectsViewMode = 'tree' | 'list';

export type ProjectsTreeNodeKind =
  | 'scope'
  | 'refresh'
  | 'project'
  | 'warning'
  | 'empty'
  | 'workspaceFolder'
  | 'folder';

export interface ProjectsTreeNode {
  id: string;
  label: string;
  description?: string;
  kind: ProjectsTreeNodeKind;
  projectId?: string;
  iconId?: string;
  tooltip?: string;
  command?: string;
  children?: ProjectsTreeNode[];
}

export function formatScopeSummary(projects: PolicyStudioProject[], scope: ProjectScope): string {
  if (projects.length === 0) {
    return 'No projects';
  }

  switch (scope.mode) {
    case 'allProjects':
      return `All projects (${projects.length})`;
    case 'selectedProjects': {
      const count = scope.selectedProjectIds?.length ?? 0;
      return `Selected: ${count} project(s)`;
    }
    case 'activeProject': {
      const active = projects.find((p) => p.id === scope.activeProjectId);
      return active ? `Active: ${active.displayName}` : 'Active project';
    }
  }
}

export function scopeIconId(scope: ProjectScope): string {
  switch (scope.mode) {
    case 'allProjects':
      return 'folder-library';
    case 'selectedProjects':
      return 'list-selection';
    case 'activeProject':
      return 'target';
  }
}

function duplicateDisplayNames(projects: PolicyStudioProject[]): Set<string> {
  const duplicateNames = new Set<string>();
  const nameCounts = new Map<string, number>();
  for (const project of projects) {
    nameCounts.set(project.displayName, (nameCounts.get(project.displayName) ?? 0) + 1);
  }
  for (const [name, count] of nameCounts) {
    if (count > 1) {
      duplicateNames.add(name);
    }
  }
  return duplicateNames;
}

function createProjectNode(
  project: PolicyStudioProject,
  scope: ProjectScope,
  duplicateNames: Set<string>,
  options?: { omitRelativePath?: boolean; label?: string },
): ProjectsTreeNode {
  const isActive = scope.mode === 'activeProject' && scope.activeProjectId === project.id;
  const descriptionParts = [
    project.projectType.toUpperCase(),
    options?.omitRelativePath ? undefined : project.relativePath || undefined,
    duplicateNames.has(project.displayName) ? project.workspaceFolder : undefined,
    isActive ? '(active)' : undefined,
  ].filter(Boolean);

  return {
    id: `project-${project.id}`,
    label: options?.label ?? project.displayName,
    description: descriptionParts.join(' · '),
    kind: 'project',
    projectId: project.id,
    iconId: isActive ? 'check' : project.projectType === 'yaml' ? 'symbol-key' : 'file-code',
    tooltip: project.rootPath,
  };
}

function basenameFromWorkspaceFolder(uriOrPath: string): string {
  const cleaned = uriOrPath.replace(/\\/g, '/').replace(/\/$/, '');
  const parts = cleaned.split('/');
  return parts[parts.length - 1] || cleaned;
}

function toPosixRelative(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

interface MutableFolder {
  kind: 'folder';
  segment: string;
  folders: Map<string, MutableFolder>;
  projects: PolicyStudioProject[];
}

function createMutableFolder(segment: string): MutableFolder {
  return { kind: 'folder', segment, folders: new Map(), projects: [] };
}

function insertProject(root: MutableFolder, project: PolicyStudioProject): void {
  const posix = toPosixRelative(project.relativePath);
  if (!posix) {
    root.projects.push(project);
    return;
  }

  const segments = posix.split('/').filter(Boolean);
  // All but last segment are folders; last segment is the project directory leaf parent.
  const folderSegments = segments.slice(0, -1);
  let current = root;
  for (const segment of folderSegments) {
    let next = current.folders.get(segment);
    if (!next) {
      next = createMutableFolder(segment);
      current.folders.set(segment, next);
    }
    current = next;
  }
  current.projects.push(project);
}

function compactAndBuild(
  folder: MutableFolder,
  scope: ProjectScope,
  duplicateNames: Set<string>,
  idPrefix: string,
  isVirtualRoot: boolean,
): ProjectsTreeNode[] {
  const childFolders = [...folder.folders.values()].map((child) =>
    buildCompactFolderNode(child, scope, duplicateNames, `${idPrefix}/${child.segment}`),
  );

  const projectNodes = folder.projects.map((project) =>
    createProjectNode(project, scope, duplicateNames, {
      omitRelativePath: !isVirtualRoot && folder.segment !== '',
    }),
  );

  return [...childFolders, ...projectNodes].sort((a, b) => a.label.localeCompare(b.label));
}

function buildCompactFolderNode(
  folder: MutableFolder,
  scope: ProjectScope,
  duplicateNames: Set<string>,
  id: string,
): ProjectsTreeNode {
  // Recursively compact children first by building through merge loops on a working copy.
  let label = folder.segment;
  let working: MutableFolder = {
    kind: 'folder',
    segment: folder.segment,
    folders: new Map(folder.folders),
    projects: [...folder.projects],
  };

  // Collapse single-child folder chains.
  while (working.projects.length === 0 && working.folders.size === 1) {
    const only = [...working.folders.values()][0];
    label = `${label}/${only.segment}`;
    working = {
      kind: 'folder',
      segment: only.segment,
      folders: new Map(only.folders),
      projects: [...only.projects],
    };
    id = `${id}/${only.segment}`;
  }

  // Sole project under this folder → project leaf with combined label.
  if (working.projects.length === 1 && working.folders.size === 0) {
    const project = working.projects[0];
    return createProjectNode(project, scope, duplicateNames, {
      omitRelativePath: true,
      label: `${label}/${project.displayName}`,
    });
  }

  const children = compactAndBuild(working, scope, duplicateNames, id, false);
  return {
    id: `folder-${id}`,
    label,
    kind: 'folder',
    iconId: 'folder',
    children,
  };
}

function buildPathForest(
  projects: PolicyStudioProject[],
  scope: ProjectScope,
  duplicateNames: Set<string>,
  idPrefix: string,
): ProjectsTreeNode[] {
  const root = createMutableFolder('');
  for (const project of projects) {
    insertProject(root, project);
  }
  return compactAndBuild(root, scope, duplicateNames, idPrefix, true);
}

function buildTreeProjectNodes(
  projects: PolicyStudioProject[],
  scope: ProjectScope,
  duplicateNames: Set<string>,
): ProjectsTreeNode[] {
  const byWorkspace = new Map<string, PolicyStudioProject[]>();
  for (const project of projects) {
    const key = project.workspaceFolder;
    const list = byWorkspace.get(key) ?? [];
    list.push(project);
    byWorkspace.set(key, list);
  }

  const workspaceKeys = [...byWorkspace.keys()].sort();
  if (workspaceKeys.length <= 1) {
    return buildPathForest(projects, scope, duplicateNames, 'root');
  }

  return workspaceKeys.map((workspaceFolder) => {
    const group = byWorkspace.get(workspaceFolder) ?? [];
    const label = basenameFromWorkspaceFolder(workspaceFolder);
    return {
      id: `workspace-${workspaceFolder}`,
      label,
      kind: 'workspaceFolder' as const,
      iconId: 'root-folder',
      tooltip: workspaceFolder,
      children: buildPathForest(group, scope, duplicateNames, workspaceFolder),
    };
  });
}

function appendWarnings(nodes: ProjectsTreeNode[], warnings: string[]): void {
  for (const [index, warning] of warnings.entries()) {
    nodes.push({
      id: `warning-${index}`,
      label: warning,
      kind: 'warning',
      iconId: 'warning',
      tooltip: warning,
    });
  }
}

export function buildProjectsTree(
  registry: ProjectRegistry,
  scope: ProjectScope,
  viewMode: ProjectsViewMode = 'tree',
): ProjectsTreeNode[] {
  const { projects, warnings } = registry;

  if (projects.length === 0) {
    return [
      {
        id: 'empty',
        label: 'No Policy Studio projects found',
        kind: 'empty',
        description: 'Run Refresh or check workspace markers (PrimaryStore.xml / values.yaml)',
        iconId: 'info',
      },
      {
        id: 'refresh',
        label: 'Refresh projects',
        kind: 'refresh',
        command: 'policyStudioTools.refreshProjects',
        iconId: 'refresh',
      },
    ];
  }

  const nodes: ProjectsTreeNode[] = [
    {
      id: 'scope',
      label: formatScopeSummary(projects, scope),
      kind: 'scope',
      command: 'policyStudioTools.selectProjectScope',
      iconId: scopeIconId(scope),
      tooltip: 'Change project scope',
    },
    {
      id: 'refresh',
      label: 'Refresh projects',
      kind: 'refresh',
      command: 'policyStudioTools.refreshProjects',
      iconId: 'refresh',
    },
  ];

  const duplicateNames = duplicateDisplayNames(projects);

  if (viewMode === 'list') {
    for (const project of projects) {
      nodes.push(createProjectNode(project, scope, duplicateNames));
    }
  } else {
    nodes.push(...buildTreeProjectNodes(projects, scope, duplicateNames));
  }

  appendWarnings(nodes, warnings);
  return nodes;
}
