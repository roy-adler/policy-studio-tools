export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface QuickFixDescriptor {
  ruleId: string;
  title: string;
  replacement: string;
}

export interface ValidationIssue {
  ruleId: string;
  severity: ValidationSeverity;
  message: string;
  suggestedFix?: QuickFixDescriptor;
}

export interface PathTemplateLocation {
  file: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface ValidationResult {
  template: string;
  location: PathTemplateLocation;
  issues: ValidationIssue[];
}

export interface ExtractedPathTemplate {
  template: string;
  startOffset: number;
  endOffset: number;
}

export const PATH_TEMPLATE_DIAGNOSTIC_SOURCE = 'policyStudio.pathTemplate';

export const ROUTING_PATH_FIELD_NAMES = [
  'path',
  'uriTemplate',
  'pathTemplate',
  'uriPath',
] as const;

export type RoutingPathFieldName = (typeof ROUTING_PATH_FIELD_NAMES)[number];
