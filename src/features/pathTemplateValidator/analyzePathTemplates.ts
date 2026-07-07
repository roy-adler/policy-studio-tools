import { offsetToRange } from '../circuitSearch/textUtils';
import { extractPathTemplates } from './extractPathTemplates';
import type { ValidationResult } from './types';
import { validatePathTemplate } from './validatePathTemplate';

export interface PathTemplateValidationSummary {
  filesScanned: number;
  templatesValidated: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

export function analyzePathTemplatesInContent(
  content: string,
  filePath: string,
): ValidationResult[] {
  return extractPathTemplates(content).map((extracted) => ({
    template: extracted.template,
    location: {
      file: filePath,
      range: offsetToRange(content, extracted.startOffset, extracted.endOffset),
    },
    issues: validatePathTemplate(extracted.template),
  }));
}

export function summarizeValidationResults(
  results: ValidationResult[],
): Pick<PathTemplateValidationSummary, 'templatesValidated' | 'errorCount' | 'warningCount' | 'infoCount'> {
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;

  for (const result of results) {
    for (const issue of result.issues) {
      if (issue.severity === 'error') {
        errorCount += 1;
      } else if (issue.severity === 'warning') {
        warningCount += 1;
      } else {
        infoCount += 1;
      }
    }
  }

  return {
    templatesValidated: results.length,
    errorCount,
    warningCount,
    infoCount,
  };
}
