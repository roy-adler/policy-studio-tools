import * as vscode from 'vscode';
import { jumpToCircuit } from '../circuitNavigation/circuitNavigationService';
import { resolveServicePathCircuitName } from './resolveServicePathCircuitName';
import type { ServicePathEntry } from './types';

export async function openServicePathEntry(entry: ServicePathEntry): Promise<void> {
  const uri = vscode.Uri.file(entry.filePath);
  const document = await vscode.workspace.openTextDocument(uri);
  const selection = new vscode.Range(
    entry.uriPrefixRange.start.line,
    entry.uriPrefixRange.start.character,
    entry.uriPrefixRange.end.line,
    entry.uriPrefixRange.end.character,
  );
  const editor = await vscode.window.showTextDocument(document, { selection });
  editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
}

export async function jumpToServicePathCircuit(entry: ServicePathEntry): Promise<void> {
  const circuitName = resolveServicePathCircuitName(entry.filterCircuit);
  if (!circuitName) {
    return;
  }
  await jumpToCircuit(circuitName, { projectId: entry.projectId });
}
