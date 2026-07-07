import * as path from 'path';
import * as vscode from 'vscode';
import { jumpToCircuit } from '../circuitNavigation/circuitNavigationService';
import type { CircuitSearchResult } from '../circuitSearch/types';
import { getSharedProjectRegistryStore } from '../projectRegistry/projectRegistryService';

export async function openCircuitSearchResult(result: CircuitSearchResult): Promise<void> {
  const project = getSharedProjectRegistryStore()
    .getProjectRegistry()
    .projects.find((p) => p.id === result.projectId);
  if (!project) {
    return;
  }

  const absolutePath = vscode.Uri.file(path.join(project.rootPath, result.jumpTarget.filePath));
  const document = await vscode.workspace.openTextDocument(absolutePath);
  const selection = new vscode.Range(
    result.jumpTarget.range.start.line,
    result.jumpTarget.range.start.character,
    result.jumpTarget.range.end.line,
    result.jumpTarget.range.end.character,
  );
  const editor = await vscode.window.showTextDocument(document, { selection });
  editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
}

export async function jumpToReferencedCircuit(
  projectId: string,
  circuitName: string,
): Promise<void> {
  await jumpToCircuit(circuitName, { projectId });
}
