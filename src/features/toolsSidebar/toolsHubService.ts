import { EventEmitter } from 'events';
import type { CircuitSearchViewHost, ToolsHubTool } from './types';
import { sortRegisteredTools } from './toolsTreeModel';

let sharedHub: ToolsHubService | undefined;

export function getSharedToolsHubService(): ToolsHubService {
  if (!sharedHub) {
    sharedHub = new ToolsHubService();
  }
  return sharedHub;
}

export class ToolsHubService {
  private readonly tools: ToolsHubTool[] = [];
  private searchProvider: CircuitSearchViewHost | undefined;
  private readonly emitter = new EventEmitter();

  registerTool(tool: ToolsHubTool): void {
    const existingIndex = this.tools.findIndex((entry) => entry.id === tool.id);
    if (existingIndex >= 0) {
      this.tools[existingIndex] = tool;
    } else {
      this.tools.push(tool);
    }
    this.emitter.emit('changed');
  }

  getTools(): ToolsHubTool[] {
    return sortRegisteredTools(this.tools);
  }

  setSearchProvider(provider: CircuitSearchViewHost): void {
    this.searchProvider = provider;
  }

  focusCircuitSearch(): void {
    this.searchProvider?.focus();
  }

  notifyScopeChanged(): void {
    this.searchProvider?.notifyScopeChanged();
  }

  refresh(): void {
    this.emitter.emit('changed');
  }

  onDidChange(listener: () => void): { dispose: () => void } {
    this.emitter.on('changed', listener);
    return { dispose: () => this.emitter.off('changed', listener) };
  }
}
