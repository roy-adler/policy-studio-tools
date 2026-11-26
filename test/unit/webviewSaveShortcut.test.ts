import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  SAVE_REQUEST_MESSAGE,
  SAVE_SHORTCUT_PANELS,
  getSaveShortcutScript,
} from '../../src/features/webviewSave/saveShortcut';
import { getKpsPanelShellHtml } from '../../src/features/kpsEditor/kpsPanelHtml';

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'),
) as {
  contributes: {
    commands: { command: string }[];
    keybindings: { command: string; key: string; mac?: string; when?: string }[];
  };
};

describe('Ctrl+S / Cmd+S in webview panels', () => {
  for (const [name, panel] of Object.entries(SAVE_SHORTCUT_PANELS)) {
    it(`binds Ctrl+S and Cmd+S to Save only while the ${name} panel is active`, () => {
      const binding = manifest.contributes.keybindings.find((kb) => kb.command === panel.command);
      expect(binding).toBeDefined();
      expect(binding?.key).toBe('ctrl+s');
      expect(binding?.mac).toBe('cmd+s');
      expect(binding?.when).toBe(`activeWebviewPanelId == '${panel.viewType}'`);
      expect(manifest.contributes.commands.map((c) => c.command)).toContain(panel.command);
    });
  }

  it('never binds Ctrl+S without a webview when-clause', () => {
    const saveKeys = manifest.contributes.keybindings.filter(
      (kb) => kb.key === 'ctrl+s' || kb.mac === 'cmd+s',
    );
    for (const kb of saveKeys) {
      expect(kb.when).toMatch(/^activeWebviewPanelId == '/);
    }
  });

  it('webview answers requestSave by committing the focused input and posting save', () => {
    const script = getSaveShortcutScript();
    expect(script).toContain(`message.type !== '${SAVE_REQUEST_MESSAGE}'`);
    expect(script.indexOf('active.blur()')).toBeLessThan(script.indexOf("postMessage({ type: 'save' })"));
    expect(() => new Function('vscode', script)).not.toThrow();
  });

  it('KPS shell page already listens for the shortcut', () => {
    expect(getKpsPanelShellHtml('n')).toContain(SAVE_REQUEST_MESSAGE);
  });
});
