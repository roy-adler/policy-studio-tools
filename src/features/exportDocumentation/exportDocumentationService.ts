import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { buildCircuitIndex } from '../circuitSearch/circuitIndex';
import { getSharedProjectRegistryStore } from '../projectRegistry/projectRegistryService';
import type { PolicyStudioProject } from '../projectRegistry/types';
import { getSharedToolsHubService } from '../toolsSidebar/toolsHubService';
import { buildDocumentationModel } from './buildDocumentationModel';
import { renderDocumentationMarkdown } from './markdownRenderer';
import { EXPORT_DOCUMENTATION_TOOL } from './toolDescriptor';
import type { DocumentationModel, ExportDocumentationResult } from './types';

export async function exportDocumentationToFile(
  project: PolicyStudioProject,
  outputPath: string,
  options?: { toolVersion?: string },
): Promise<ExportDocumentationResult> {
  const index = await buildCircuitIndex(project);
  const model = buildDocumentationModel(index, { toolVersion: options?.toolVersion });
  const markdown = renderDocumentationMarkdown(model);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, markdown, 'utf8');

  return {
    filesWritten: [outputPath],
    circuitsDocumented: model.metadata.circuitCount,
    warnings: model.warnings,
  };
}

export class ExportDocumentationService {
  constructor(private readonly context: vscode.ExtensionContext) {}

  activate(): void {
    getSharedToolsHubService().registerTool(EXPORT_DOCUMENTATION_TOOL);

    this.context.subscriptions.push(
      vscode.commands.registerCommand('policyStudioTools.exportDocumentation', () =>
        this.runExportCommand(),
      ),
    );
  }

  private async runExportCommand(): Promise<void> {
    const store = getSharedProjectRegistryStore();
    const projects = store.getProjectsInScope();

    if (projects.length === 0) {
      void vscode.window.showWarningMessage(
        'No Policy Studio projects in the current scope.',
      );
      return;
    }

    const proceed = await vscode.window.showWarningMessage(
      'Exported documentation may contain secrets such as URLs, tokens, or script contents. Continue?',
      { modal: true },
      'Export',
    );
    if (proceed !== 'Export') {
      return;
    }

    const project = projects.length === 1 ? projects[0] : await this.pickProject(projects);
    if (!project) {
      return;
    }

    const defaultUri = vscode.Uri.file(
      path.join(project.rootPath, `${project.displayName}-documentation.md`),
    );
    const picked = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { Markdown: ['md'] },
      saveLabel: 'Export documentation',
    });
    if (!picked) {
      return;
    }

    const outputPath = picked.fsPath;

    try {
      await fs.access(outputPath);
      const overwrite = await vscode.window.showWarningMessage(
        `File already exists: ${path.basename(outputPath)}. Overwrite?`,
        { modal: true },
        'Overwrite',
      );
      if (overwrite !== 'Overwrite') {
        return;
      }
    } catch {
      // file does not exist yet
    }

    const extensionVersion =
      vscode.extensions.getExtension('RoyAdler.policy-studio-tools')?.packageJSON.version ??
      '0.0.1';

    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Exporting documentation for ${project.displayName}`,
        cancellable: false,
      },
      async () => exportDocumentationToFile(project, outputPath, { toolVersion: extensionVersion }),
    );

    const summary = [
      `Wrote ${result.filesWritten.length} file(s)`,
      `${result.circuitsDocumented} circuit(s) documented`,
      result.warnings.length > 0 ? `${result.warnings.length} warning(s)` : '',
    ]
      .filter(Boolean)
      .join(' · ');

    const openAction = 'Open file';
    const choice = await vscode.window.showInformationMessage(summary, openAction);
    if (choice === openAction) {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(outputPath));
      await vscode.window.showTextDocument(document, { preview: false });
    }
  }

  private async pickProject(
    projects: PolicyStudioProject[],
  ): Promise<PolicyStudioProject | undefined> {
    type ProjectQuickPickItem = vscode.QuickPickItem & { project: PolicyStudioProject };

    const items: ProjectQuickPickItem[] = projects.map((project) => ({
      label: project.displayName,
      description: project.relativePath || project.rootPath,
      project,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a Policy Studio project to export',
    });
    return picked?.project;
  }
}

export function combineDocumentationModels(models: DocumentationModel[]): DocumentationModel {
  if (models.length === 0) {
    throw new Error('At least one documentation model is required.');
  }
  if (models.length === 1) {
    return models[0];
  }

  const first = models[0];
  return {
    metadata: {
      ...first.metadata,
      projectName: models.map((model) => model.metadata.projectName).join(', '),
      circuitCount: models.reduce((total, model) => total + model.metadata.circuitCount, 0),
      filterCount: models.reduce((total, model) => total + model.metadata.filterCount, 0),
      entryPoints: models.flatMap((model) => model.metadata.entryPoints),
      referenceGraphSummary: models.map((model) => model.metadata.referenceGraphSummary).join('; '),
    },
    circuits: models.flatMap((model) => model.circuits),
    indices: {
      pathTemplates: models.flatMap((model) => model.indices.pathTemplates),
      backendUrls: models.flatMap((model) => model.indices.backendUrls),
      attributes: models.flatMap((model) => model.indices.attributes),
    },
    warnings: models.flatMap((model) => model.warnings),
  };
}
