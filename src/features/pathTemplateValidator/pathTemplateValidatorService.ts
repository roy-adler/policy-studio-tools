import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { discoverPolicyFiles } from '../circuitSearch/policyFileDiscovery';
import { getProjectForFile } from '../projectRegistry/discoverProjects';
import { getSharedProjectRegistryStore } from '../projectRegistry/projectRegistryService';
import type { PolicyStudioProject } from '../projectRegistry/types';
import { getSharedToolsHubService } from '../toolsSidebar/toolsHubService';
import {
  analyzePathTemplatesInContent,
  summarizeValidationResults,
  type PathTemplateValidationSummary,
} from './analyzePathTemplates';
import { PATH_TEMPLATE_VALIDATOR_TOOL } from './toolDescriptor';
import {
  PATH_TEMPLATE_DIAGNOSTIC_SOURCE,
  type ValidationIssue,
  type ValidationResult,
} from './types';

const VALIDATION_DEBOUNCE_MS = 400;
const POLICY_FILE_PATTERN = /\.(xml|ya?ml)$/i;
const DOCS_RELATIVE_PATH = 'docs/path-templates.md';

export { analyzePathTemplatesInContent, summarizeValidationResults } from './analyzePathTemplates';
export type { PathTemplateValidationSummary } from './analyzePathTemplates';

function severityForIssue(issue: ValidationIssue): vscode.DiagnosticSeverity {
  switch (issue.severity) {
    case 'error':
      return vscode.DiagnosticSeverity.Error;
    case 'warning':
      return vscode.DiagnosticSeverity.Warning;
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}

function buildDiagnosticMessage(
  issue: ValidationIssue,
  projectDisplayName: string | undefined,
  multipleProjects: boolean,
): string {
  const prefix = multipleProjects && projectDisplayName ? `[${projectDisplayName}] ` : '';
  return `${prefix}${issue.message} (${issue.ruleId})`;
}

function docsUri(context: vscode.ExtensionContext): vscode.Uri | undefined {
  const docsPath = path.join(context.extensionPath, DOCS_RELATIVE_PATH);
  return vscode.Uri.file(docsPath);
}

export class PathTemplateValidatorService {
  private readonly diagnosticCollection: vscode.DiagnosticCollection;
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection(
      PATH_TEMPLATE_DIAGNOSTIC_SOURCE,
    );
  }

  activate(): void {
    getSharedToolsHubService().registerTool(PATH_TEMPLATE_VALIDATOR_TOOL);

    this.context.subscriptions.push(
      this.diagnosticCollection,
      vscode.workspace.onDidOpenTextDocument((document) => {
        void this.validateDocument(document);
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        this.scheduleValidation(event.document);
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.clearScheduledValidation(document.uri.toString());
        this.diagnosticCollection.delete(document.uri);
      }),
      vscode.commands.registerCommand('policyStudioTools.validatePathTemplates', () =>
        this.runWorkspaceValidation(),
      ),
    );

    for (const document of vscode.workspace.textDocuments) {
      void this.validateDocument(document);
    }
  }

  private scheduleValidation(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        void this.validateDocument(document);
      }, VALIDATION_DEBOUNCE_MS),
    );
  }

  private clearScheduledValidation(key: string): void {
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.debounceTimers.delete(key);
    }
  }

  private async validateDocument(document: vscode.TextDocument): Promise<void> {
    if (!this.isPolicyDocument(document)) {
      return;
    }

    const store = getSharedProjectRegistryStore();
    const projects = store.getProjectsInScope();
    const project = getProjectForFile(document.uri.fsPath, projects);
    if (!project) {
      this.diagnosticCollection.delete(document.uri);
      return;
    }

    const results = analyzePathTemplatesInContent(document.getText(), document.uri.fsPath);
    const diagnostics = this.buildDiagnostics(results, project, projects.length > 1);
    this.diagnosticCollection.set(document.uri, diagnostics);
  }

  private isPolicyDocument(document: vscode.TextDocument): boolean {
    return POLICY_FILE_PATTERN.test(document.uri.fsPath);
  }

  private buildDiagnostics(
    results: ValidationResult[],
    project: PolicyStudioProject,
    multipleProjects: boolean,
  ): vscode.Diagnostic[] {
    const docs = docsUri(this.context);
    const diagnostics: vscode.Diagnostic[] = [];

    for (const result of results) {
      for (const issue of result.issues) {
        const range = new vscode.Range(
          result.location.range.start.line,
          result.location.range.start.character,
          result.location.range.end.line,
          result.location.range.end.character,
        );
        const diagnostic = new vscode.Diagnostic(
          range,
          buildDiagnosticMessage(issue, project.displayName, multipleProjects),
          severityForIssue(issue),
        );
        diagnostic.source = PATH_TEMPLATE_DIAGNOSTIC_SOURCE;
        diagnostic.code = `${PATH_TEMPLATE_DIAGNOSTIC_SOURCE}.${issue.ruleId}`;
        if (docs) {
          diagnostic.relatedInformation = [
            new vscode.DiagnosticRelatedInformation(
              new vscode.Location(docs, new vscode.Position(0, 0)),
              'See valid path template examples in docs/path-templates.md',
            ),
          ];
        }
        diagnostics.push(diagnostic);
      }
    }

    return diagnostics;
  }

  private async runWorkspaceValidation(): Promise<void> {
    const store = getSharedProjectRegistryStore();
    const projects = store.getProjectsInScope();

    if (projects.length === 0) {
      void vscode.window.showWarningMessage(
        'No Policy Studio projects in the current scope.',
      );
      return;
    }

    const summary = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Validating path templates',
        cancellable: false,
      },
      async () => this.scanProjects(projects),
    );

    const parts = [
      `${summary.filesScanned} file(s) scanned`,
      `${summary.templatesValidated} template(s) checked`,
      `${summary.errorCount} error(s)`,
      `${summary.warningCount} warning(s)`,
      summary.infoCount > 0 ? `${summary.infoCount} info` : undefined,
    ].filter(Boolean);

    if (summary.errorCount > 0 || summary.warningCount > 0) {
      void vscode.window.showWarningMessage(`Path template validation: ${parts.join(' · ')}`);
      return;
    }

    void vscode.window.showInformationMessage(`Path template validation: ${parts.join(' · ')}`);
  }

  async scanProjects(projects: PolicyStudioProject[]): Promise<PathTemplateValidationSummary> {
    const multipleProjects = projects.length > 1;
    let filesScanned = 0;
    let templatesValidated = 0;
    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;

    for (const project of projects) {
      const files = await discoverPolicyFiles(project);
      for (const absolutePath of files) {
        let content: string;
        try {
          content = await fs.readFile(absolutePath, 'utf8');
        } catch {
          continue;
        }

        filesScanned += 1;
        const results = analyzePathTemplatesInContent(content, absolutePath);
        const partial = summarizeValidationResults(results);
        templatesValidated += partial.templatesValidated;
        errorCount += partial.errorCount;
        warningCount += partial.warningCount;
        infoCount += partial.infoCount;

        const uri = vscode.Uri.file(absolutePath);
        const diagnostics = this.buildDiagnostics(results, project, multipleProjects);
        this.diagnosticCollection.set(uri, diagnostics);
      }
    }

    return {
      filesScanned,
      templatesValidated,
      errorCount,
      warningCount,
      infoCount,
    };
  }
}
