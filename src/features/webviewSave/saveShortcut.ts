/**
 * Ctrl+S / Cmd+S in webview panels that have a Save button.
 *
 * A package.json keybinding (when-clause on `activeWebviewPanelId`) overrides
 * VS Code's own save while one of these panels is active and runs the panel's
 * save command. That command posts `requestSave` to the webview, which first
 * commits the focused input (blur fires its pending `change` edit), then posts
 * `save`, so the edit being typed is part of the save.
 */

export const SAVE_REQUEST_MESSAGE = 'requestSave';

/** Webview view types that get Ctrl+S / Cmd+S mapped to their Save button. */
export const SAVE_SHORTCUT_PANELS = {
  kpsEditor: {
    viewType: 'policyStudio.kpsEditor',
    command: 'policyStudioTools.kpsEditor.save',
  },
  envValuesEditor: {
    viewType: 'policyStudio.envValuesEditor',
    command: 'policyStudioTools.envValuesEditor.save',
  },
} as const;

/**
 * Inline script for a webview: answers `requestSave` by committing the focused
 * input and posting `{ type: 'save' }`. Expects `vscode` (acquireVsCodeApi()).
 */
export function getSaveShortcutScript(): string {
  return `
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || message.type !== '${SAVE_REQUEST_MESSAGE}') return;
      const active = document.activeElement;
      const commit = active && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement);
      if (commit) {
        active.blur();
      }
      vscode.postMessage({ type: 'save' });
      if (commit && active.isConnected) {
        active.focus();
      }
    });
  `;
}
