import * as vscode from 'vscode';
import { discoverProjects, getProjectForFile } from './discoverProjects';
import {
  CONFIG_AUTO_DISCOVER,
  CONFIG_EXCLUDE_PATHS,
  CONFIG_INCLUDE_PATHS,
  CONFIG_SCAN_DEPTH,
  readDiscoverySettings,
} from './discoverySettings';
import { ProjectRegistryStore } from './projectRegistry';
import { resolveDefaultScope, statusBarLabel } from './projectScope';
import type { PolicyStudioProject, ProjectScope } from './types';

export const PROJECT_DETECTED_CONTEXT = 'policyStudio.projectDetected';
export const PROJECT_COUNT_CONTEXT = 'policyStudio.projectCount';
export const MULTI_PROJECT_CONTEXT = 'policyStudio.multiProject';
export const ACTIVE_PROJECT_ID_CONTEXT = 'policyStudio.activeProjectId';

const SCOPE_STORAGE_KEY = 'policyStudio.projectScope';
const DEBOUNCE_MS = 500;
const PROGRESS_THRESHOLD_MS = 1000;

const MARKER_GLOB = '**/{PrimaryStore.xml,values.yaml}';

let sharedStore: ProjectRegistryStore | undefined;

export function getSharedProjectRegistryStore(): ProjectRegistryStore {
  if (!sharedStore) {
    sharedStore = new ProjectRegistryStore();
  }
  return sharedStore;
}

export class ProjectRegistryService {
  private readonly store = getSharedProjectRegistryStore();
  private readonly statusBarItem: vscode.StatusBarItem;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshGeneration = 0;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.statusBarItem.command = 'policyStudioTools.selectProjectScope';
    context.subscriptions.push(this.statusBarItem);
  }

  activate(): void {
    void this.refreshProjects();

    const markerWatcher = vscode.workspace.createFileSystemWatcher(MARKER_GLOB);

    this.context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleRefresh()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration(CONFIG_SCAN_DEPTH) ||
          event.affectsConfiguration(CONFIG_INCLUDE_PATHS) ||
          event.affectsConfiguration(CONFIG_EXCLUDE_PATHS) ||
          event.affectsConfiguration(CONFIG_AUTO_DISCOVER)
        ) {
          this.scheduleRefresh();
        }
      }),
      markerWatcher,
      markerWatcher.onDidCreate(() => this.scheduleRefresh()),
      markerWatcher.onDidDelete(() => this.scheduleRefresh()),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateScopeFromActiveEditor()),
      this.store.onProjectsChanged(() => this.updateContextAndStatusBar()),
      this.store.onScopeChanged(() => this.updateContextAndStatusBar()),
      vscode.commands.registerCommand('policyStudioTools.refreshProjects', () =>
        this.refreshProjects(),
      ),
      vscode.commands.registerCommand('policyStudioTools.selectProjectScope', () =>
        this.showScopePicker(),
      ),
    );
  }

  activateProject(projectId: string): void {
    this.persistScope({ mode: 'activeProject', activeProjectId: projectId });
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refreshProjects();
    }, DEBOUNCE_MS);
  }

  async refreshProjects(): Promise<void> {
    const generation = ++this.refreshGeneration;
    const settings = readDiscoverySettings((key, defaultValue) =>
      vscode.workspace.getConfiguration().get(key, defaultValue),
    );

    if (!settings.autoDiscover) {
      const folders = vscode.workspace.workspaceFolders ?? [];
      const projects: PolicyStudioProject[] = [];
      const warnings: string[] = [];

      for (const folder of folders) {
        const { isPolicyStudioProject } = await import(
          '../projectDetection/detectPolicyStudioProject'
        );
        if (isPolicyStudioProject(folder.uri.fsPath)) {
          const registry = await discoverProjects(
            folder.uri.fsPath,
            folder.uri.toString(),
            { ...settings, scanDepth: 0 },
          );
          projects.push(...registry.projects);
          warnings.push(...registry.warnings);
        }
      }

      if (generation !== this.refreshGeneration) {
        return;
      }

      this.store.setRegistry({
        projects,
        discoveredAt: new Date(),
        warnings,
      });
      this.restoreOrDefaultScope();
      return;
    }

    let progress: vscode.Progress<{ message?: string }> | undefined;
    const progressTimer = setTimeout(() => {
      void vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Discovering Policy Studio projects',
          cancellable: false,
        },
        async (report) => {
          progress = report;
        },
      );
    }, PROGRESS_THRESHOLD_MS);

    const folders = vscode.workspace.workspaceFolders ?? [];
    const allProjects: PolicyStudioProject[] = [];
    const allWarnings: string[] = [];

    for (const folder of folders) {
      progress?.report({ message: folder.name });
      const result = await discoverProjects(
        folder.uri.fsPath,
        folder.uri.toString(),
        settings,
      );
      allProjects.push(...result.projects);
      allWarnings.push(...result.warnings);
    }

    clearTimeout(progressTimer);

    if (generation !== this.refreshGeneration) {
      return;
    }

    allProjects.sort((a, b) => a.rootPath.localeCompare(b.rootPath));
    this.store.setRegistry({
      projects: allProjects,
      discoveredAt: new Date(),
      warnings: allWarnings,
    });
    this.restoreOrDefaultScope();
  }

  private restoreOrDefaultScope(): void {
    const saved = this.context.workspaceState.get<ProjectScope>(SCOPE_STORAGE_KEY);
    const registry = this.store.getProjectRegistry();

    if (saved && this.isScopeValid(saved, registry.projects)) {
      this.store.setScope(saved);
      this.updateScopeFromActiveEditor();
      return;
    }

    const activePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    const scope = resolveDefaultScope(registry.projects, activePath);
    this.persistScope(scope);
  }

  private isScopeValid(scope: ProjectScope, projects: PolicyStudioProject[]): boolean {
    const ids = new Set(projects.map((p) => p.id));
    if (scope.mode === 'activeProject') {
      return scope.activeProjectId !== undefined && ids.has(scope.activeProjectId);
    }
    if (scope.mode === 'selectedProjects') {
      return (scope.selectedProjectIds ?? []).every((id) => ids.has(id));
    }
    return true;
  }

  private updateScopeFromActiveEditor(): void {
    const registry = this.store.getProjectRegistry();
    if (registry.projects.length === 0) {
      return;
    }

    const activePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!activePath) {
      return;
    }

    const project = getProjectForFile(activePath, registry.projects);
    if (!project) {
      return;
    }

    const current = this.store.getScope();
    if (current.mode === 'activeProject') {
      if (current.activeProjectId !== project.id) {
        this.persistScope({ mode: 'activeProject', activeProjectId: project.id });
      }
    }
  }

  private persistScope(scope: ProjectScope): void {
    this.store.setScope(scope);
    void this.context.workspaceState.update(SCOPE_STORAGE_KEY, scope);
  }

  private updateContextAndStatusBar(): void {
    const registry = this.store.getProjectRegistry();
    const scope = this.store.getScope();
    const count = registry.projects.length;
    const detected = count > 0;

    void vscode.commands.executeCommand('setContext', PROJECT_DETECTED_CONTEXT, detected);
    void vscode.commands.executeCommand('setContext', PROJECT_COUNT_CONTEXT, count);
    void vscode.commands.executeCommand('setContext', MULTI_PROJECT_CONTEXT, count > 1);
    void vscode.commands.executeCommand(
      'setContext',
      ACTIVE_PROJECT_ID_CONTEXT,
      scope.mode === 'activeProject' ? (scope.activeProjectId ?? '') : '',
    );

    const label = statusBarLabel(registry.projects, scope);
    if (label) {
      this.statusBarItem.text = label;
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  private async showScopePicker(): Promise<void> {
    const registry = this.store.getProjectRegistry();
    if (registry.projects.length === 0) {
      void vscode.window.showInformationMessage('No Policy Studio projects found in this workspace.');
      return;
    }

    type QuickPickScopeItem = vscode.QuickPickItem & {
      scope?: ProjectScope;
      project?: PolicyStudioProject;
    };

    const items: QuickPickScopeItem[] = [
      {
        label: 'All projects',
        description: `${registry.projects.length} project(s)`,
        scope: { mode: 'allProjects' },
      },
      {
        label: 'Choose projects…',
        description: 'Multi-select subset',
      },
      ...registry.projects.map((project) => ({
        label: project.displayName,
        description: project.relativePath || project.rootPath,
        project,
      })),
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select project scope',
    });

    if (!picked) {
      return;
    }

    if (picked.scope) {
      this.persistScope(picked.scope);
      return;
    }

    if (picked.label === 'Choose projects…') {
      const selected = await vscode.window.showQuickPick(
        registry.projects.map((project) => ({
          label: project.displayName,
          description: project.relativePath || project.rootPath,
          project,
          picked: false,
        })),
        {
          placeHolder: 'Select one or more projects',
          canPickMany: true,
        },
      );

      if (!selected || selected.length === 0) {
        return;
      }

      this.persistScope({
        mode: 'selectedProjects',
        selectedProjectIds: selected.map((item) => item.project.id),
      });
      return;
    }

    if (picked.project) {
      this.persistScope({
        mode: 'activeProject',
        activeProjectId: picked.project.id,
      });
    }
  }
}
