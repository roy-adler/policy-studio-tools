import * as vscode from 'vscode';
import { getSharedProjectRegistryStore } from '../projectRegistry/projectRegistryService';
import { buildProjectsTree, type ProjectsTreeNode } from './projectsTreeModel';

export class ProjectsTreeProvider implements vscode.TreeDataProvider<ProjectsTreeNode> {
  private readonly emitter = new vscode.EventEmitter<ProjectsTreeNode | undefined | void>();

  readonly onDidChangeTreeData = this.emitter.event;

  constructor() {
    const store = getSharedProjectRegistryStore();
    store.onProjectsChanged(() => this.refresh());
    store.onScopeChanged(() => this.refresh());
  }

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: ProjectsTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.id = element.id;
    item.description = element.description;
    item.tooltip = element.tooltip;
    if (element.iconId) {
      item.iconPath = new vscode.ThemeIcon(element.iconId);
    }

    if (element.command) {
      item.command = {
        command: element.command,
        title: element.label,
      };
    } else if (element.kind === 'project' && element.projectId) {
      const projectId = element.projectId;
      item.command = {
        command: 'policyStudioTools.setActiveProject',
        title: 'Set active project',
        arguments: [projectId],
      };
    }

    if (element.kind === 'warning') {
      item.contextValue = 'warning';
    }

    return item;
  }

  getChildren(): ProjectsTreeNode[] {
    const store = getSharedProjectRegistryStore();
    return buildProjectsTree(store.getProjectRegistry(), store.getScope());
  }
}

export function registerSetActiveProjectCommand(
  setActiveProject: (projectId: string) => void,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'policyStudioTools.setActiveProject',
    (projectId: string) => {
      setActiveProject(projectId);
    },
  );
}
