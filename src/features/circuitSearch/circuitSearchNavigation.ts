import * as path from 'path';
import * as vscode from 'vscode';
import { buildCircuitIndex, resolveCircuitDefinitions } from '../circuitSearch/circuitIndex';
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
  const store = getSharedProjectRegistryStore();
  const project = store.getProjectRegistry().projects.find((p) => p.id === projectId);
  if (!project) {
    return;
  }

  const index = await buildCircuitIndex(project);
  const definitions = resolveCircuitDefinitions(index, circuitName);

  if (definitions.length === 0) {
    void vscode.window.showWarningMessage(`Circuit '${circuitName}' not found in this project.`);
    return;
  }

  if (definitions.length === 1) {
    await openCircuitDefinition(definitions[0]);
    return;
  }

  const picked = await vscode.window.showQuickPick(
    definitions.map((definition) => ({
      label: definition.circuitName,
      description: definition.filePath,
      definition,
    })),
    { placeHolder: `Multiple definitions found for ${circuitName}` },
  );

  if (picked) {
    await openCircuitDefinition(picked.definition);
  }
}

async function openCircuitDefinition(definition: {
  absolutePath: string;
  range: CircuitSearchResult['jumpTarget']['range'];
}): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(definition.absolutePath));
  const selection = new vscode.Range(
    definition.range.start.line,
    definition.range.start.character,
    definition.range.end.line,
    definition.range.end.character,
  );
  const editor = await vscode.window.showTextDocument(document, { selection });
  editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
}
