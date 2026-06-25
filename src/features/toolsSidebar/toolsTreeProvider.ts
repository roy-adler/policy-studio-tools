import * as vscode from 'vscode';
import { getSharedToolsHubService } from './toolsHubService';
import { buildToolsTree, type ToolsTreeNode } from './toolsTreeModel';

export class ToolsTreeProvider implements vscode.TreeDataProvider<ToolsTreeNode> {
  private readonly emitter = new vscode.EventEmitter<ToolsTreeNode | undefined | void>();
  private projectDetected = false;

  readonly onDidChangeTreeData = this.emitter.event;

  constructor() {
    getSharedToolsHubService().onDidChange(() => this.refresh());
  }

  setProjectDetected(detected: boolean): void {
    this.projectDetected = detected;
    this.refresh();
  }

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: ToolsTreeNode): vscode.TreeItem {
    const collapsible =
      element.kind === 'group'
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(element.label, collapsible);
    item.id = element.id;
    item.tooltip = element.tooltip;

    if (element.iconId) {
      item.iconPath = new vscode.ThemeIcon(element.iconId);
    }

    if (element.kind === 'group') {
      item.contextValue = 'group';
    }

    if (element.command) {
      item.command = {
        command: element.command,
        title: element.label,
      };
    }

    return item;
  }

  getChildren(element?: ToolsTreeNode): ToolsTreeNode[] {
    const tree = buildToolsTree(getSharedToolsHubService().getTools(), this.projectDetected);
    if (!element) {
      return tree;
    }
    if (element.kind === 'group') {
      return element.children ?? [];
    }
    return [];
  }
}
