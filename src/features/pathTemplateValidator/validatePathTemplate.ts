import type { QuickFixDescriptor, ValidationIssue } from './types';

const PLACEHOLDER_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const REGEX_METACHARACTERS = /[.+?()[\]{}|\\^$]/;

interface ParsedPlaceholder {
  name: string;
  regexPart: string | undefined;
  start: number;
  end: number;
}

export function validatePathTemplate(template: string): ValidationIssue[] {
  const trimmed = template.trim();
  if (trimmed.length === 0) {
    return [issue('emptyTemplate', 'error', 'Path template must not be empty or whitespace only.')];
  }

  const issues: ValidationIssue[] = [];

  if (!trimmed.startsWith('/')) {
    issues.push(
      issue(
        'missingLeadingSlash',
        'warning',
        'Path template should start with "/" for absolute routing paths.',
        {
          ruleId: 'missingLeadingSlash',
          title: 'Insert leading slash',
          replacement: `/${trimmed}`,
        },
      ),
    );
  }

  if (trimmed.endsWith('/') && trimmed.length > 1) {
    issues.push(
      issue(
        'trailingSlash',
        'info',
        'Trailing "/" may change path matching behaviour.',
        {
          ruleId: 'trailingSlash',
          title: 'Remove trailing slash',
          replacement: trimmed.replace(/\/+$/, ''),
        },
      ),
    );
  }

  if (trimmed.includes('//')) {
    issues.push(
      issue(
        'consecutiveSlashes',
        'warning',
        'Path template contains consecutive slashes ("//").',
        {
          ruleId: 'consecutiveSlashes',
          title: 'Collapse consecutive slashes',
          replacement: trimmed.replace(/\/{2,}/g, '/'),
        },
      ),
    );
  }

  const placeholderIssues = validatePlaceholders(trimmed);
  issues.push(...placeholderIssues);

  const staticSegments = staticPathSegments(trimmed);
  if (hasUnsupportedWildcard(staticSegments)) {
    issues.push(
      issue(
        'unsupportedWildcard',
        'warning',
        'Wildcard segments ("*" or "**") are not supported in API Gateway path templates.',
      ),
    );
  }

  for (const segment of staticSegments) {
    if (REGEX_METACHARACTERS.test(segment)) {
      issues.push(
        issue(
          'ambiguousRegexLiteral',
          'warning',
          `Static path segment "${segment}" contains characters that may be interpreted as regex metacharacters.`,
        ),
      );
      break;
    }
  }

  return issues;
}

function issue(
  ruleId: string,
  severity: ValidationIssue['severity'],
  message: string,
  suggestedFix?: QuickFixDescriptor,
): ValidationIssue {
  return { ruleId, severity, message, suggestedFix };
}

function validatePlaceholders(template: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const placeholders: ParsedPlaceholder[] = [];
  let index = 0;

  while (index < template.length) {
    const open = template.indexOf('{', index);
    if (open === -1) {
      break;
    }

    if (open > 0 && template[open - 1] === '\\') {
      index = open + 1;
      continue;
    }

    const close = findPlaceholderClose(template, open);
    if (close === -1) {
      issues.push(
        issue(
          'unclosedPlaceholder',
          'error',
          'Unclosed placeholder: "{" has no matching "}".',
        ),
      );
      return issues;
    }

    const inner = template.slice(open + 1, close);
    if (inner.includes('{') || inner.includes('}')) {
      issues.push(
        issue(
          'unclosedPlaceholder',
          'error',
          'Nested braces are not allowed inside placeholders.',
        ),
      );
      return issues;
    }

    const colonIndex = inner.indexOf(':');
    const rawName = colonIndex === -1 ? inner : inner.slice(0, colonIndex);
    const regexPart = colonIndex === -1 ? undefined : inner.slice(colonIndex + 1);

    const name = rawName.trim();
    if (name.length === 0 || !PLACEHOLDER_NAME_PATTERN.test(name)) {
      issues.push(
        issue(
          'invalidPlaceholderName',
          'error',
          `Invalid placeholder name "${rawName || '(empty)'}" — use letters, digits, "_", or "-", starting with a letter or "_".`,
        ),
      );
    }

    if (regexPart !== undefined) {
      const regexIssues = validateRegexPart(regexPart);
      issues.push(...regexIssues);
    }

    placeholders.push({ name, regexPart, start: open, end: close + 1 });
    index = close + 1;
  }

  const seen = new Map<string, number>();
  for (const placeholder of placeholders) {
    if (!placeholder.name) {
      continue;
    }
    const count = (seen.get(placeholder.name) ?? 0) + 1;
    seen.set(placeholder.name, count);
  }

  for (const [name, count] of seen) {
    if (count > 1) {
      issues.push(
        issue(
          'duplicateParam',
          'error',
          `Placeholder "{${name}}" appears ${count} times; each parameter name must be unique.`,
        ),
      );
    }
  }

  return issues;
}

function findPlaceholderClose(template: string, openIndex: number): number {
  for (let i = openIndex + 1; i < template.length; i += 1) {
    if (template[i] === '}' && template[i - 1] !== '\\') {
      return i;
    }
  }
  return -1;
}

function validateRegexPart(regexPart: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  let depth = 0;

  for (let i = 0; i < regexPart.length; i += 1) {
    const ch = regexPart[i];
    if (ch === '\\') {
      const next = regexPart[i + 1];
      if (!next) {
        issues.push(
          issue(
            'invalidRegexGroup',
            'error',
            'Regex constraint ends with an invalid escape sequence.',
          ),
        );
        return issues;
      }
      i += 1;
      continue;
    }
    if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth -= 1;
      if (depth < 0) {
        issues.push(
          issue(
            'invalidRegexGroup',
            'error',
            'Regex constraint contains an unmatched ")".',
          ),
        );
        return issues;
      }
    }
  }

  if (depth > 0) {
    issues.push(
      issue(
        'invalidRegexGroup',
        'error',
        'Regex constraint contains an unclosed "(".',
      ),
    );
  }

  return issues;
}

function staticPathSegments(template: string): string[] {
  const segments: string[] = [];
  let current = '';
  let index = 0;

  while (index < template.length) {
    const open = template.indexOf('{', index);
    if (open === -1) {
      current += template.slice(index);
      break;
    }

    if (open > 0 && template[open - 1] === '\\') {
      current += template.slice(index, open + 1);
      index = open + 1;
      continue;
    }

    current += template.slice(index, open);
    const close = findPlaceholderClose(template, open);
    if (close === -1) {
      current += template.slice(open);
      break;
    }

    segments.push(...splitStaticSegments(current));
    current = '';
    index = close + 1;
  }

  segments.push(...splitStaticSegments(current));
  return segments.filter((segment) => segment.length > 0);
}

function splitStaticSegments(pathPart: string): string[] {
  return pathPart.split('/').filter((segment) => segment.length > 0);
}

function hasUnsupportedWildcard(segments: string[]): boolean {
  return segments.some((segment) => segment === '*' || segment === '**');
}
