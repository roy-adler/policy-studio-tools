import * as fs from 'fs/promises';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { extractPathTemplates } from '../../src/features/pathTemplateValidator/extractPathTemplates';
import {
  analyzePathTemplatesInContent,
  summarizeValidationResults,
} from '../../src/features/pathTemplateValidator/analyzePathTemplates';
import { PATH_TEMPLATE_VALIDATOR_TOOL } from '../../src/features/pathTemplateValidator/toolDescriptor';
import { validatePathTemplate } from '../../src/features/pathTemplateValidator/validatePathTemplate';

const fixturesDir = path.join(__dirname, '..', 'fixtures', 'path-template-validator');

async function readFixture(relativePath: string): Promise<string> {
  return fs.readFile(path.join(fixturesDir, relativePath), 'utf8');
}

function ruleIds(issues: ReturnType<typeof validatePathTemplate>): string[] {
  return issues.map((issue) => issue.ruleId);
}

describe('validatePathTemplate rules', () => {
  describe('emptyTemplate', () => {
    it('accepts non-empty templates', () => {
      expect(ruleIds(validatePathTemplate('/api/v1/pets'))).not.toContain('emptyTemplate');
    });

    it('rejects empty and whitespace-only templates', () => {
      expect(ruleIds(validatePathTemplate(''))).toContain('emptyTemplate');
      expect(ruleIds(validatePathTemplate('   '))).toContain('emptyTemplate');
    });
  });

  describe('missingLeadingSlash', () => {
    it('accepts absolute paths', () => {
      expect(ruleIds(validatePathTemplate('/api/v1/pets'))).not.toContain('missingLeadingSlash');
    });

    it('warns when the template omits a leading slash', () => {
      const issues = validatePathTemplate('api/v1/pets');
      expect(ruleIds(issues)).toContain('missingLeadingSlash');
      expect(issues.find((issue) => issue.ruleId === 'missingLeadingSlash')?.suggestedFix).toEqual({
        ruleId: 'missingLeadingSlash',
        title: 'Insert leading slash',
        replacement: '/api/v1/pets',
      });
    });
  });

  describe('duplicateParam', () => {
    it('accepts distinct placeholders', () => {
      expect(
        ruleIds(validatePathTemplate('/api/v1/pets/{petId}/orders/{orderId}')),
      ).not.toContain('duplicateParam');
    });

    it('rejects repeated placeholder names', () => {
      expect(ruleIds(validatePathTemplate('/api/v1/{id}/{id}'))).toContain('duplicateParam');
    });
  });

  describe('unclosedPlaceholder', () => {
    it('accepts balanced placeholders', () => {
      expect(ruleIds(validatePathTemplate('/api/v1/{petId}'))).not.toContain('unclosedPlaceholder');
    });

    it('rejects missing closing brace', () => {
      expect(ruleIds(validatePathTemplate('/api/v1/{petId'))).toContain('unclosedPlaceholder');
    });

    it('rejects nested braces inside a placeholder', () => {
      expect(ruleIds(validatePathTemplate('/api/v1/{{id}}'))).toContain('unclosedPlaceholder');
    });
  });

  describe('invalidPlaceholderName', () => {
    it('accepts valid placeholder names', () => {
      expect(ruleIds(validatePathTemplate('/api/v1/{petId}'))).not.toContain('invalidPlaceholderName');
    });

    it('rejects empty and invalid placeholder names', () => {
      expect(ruleIds(validatePathTemplate('/api/v1/{}'))).toContain('invalidPlaceholderName');
      expect(ruleIds(validatePathTemplate('/api/v1/{pet id}'))).toContain('invalidPlaceholderName');
    });
  });

  describe('unsupportedWildcard', () => {
    it('accepts regex wildcards inside placeholder constraints', () => {
      expect(ruleIds(validatePathTemplate('/files/{path:.*}'))).not.toContain('unsupportedWildcard');
    });

    it('warns on path segment wildcards', () => {
      expect(ruleIds(validatePathTemplate('/api/v1/*/items'))).toContain('unsupportedWildcard');
      expect(ruleIds(validatePathTemplate('/api/**/items'))).toContain('unsupportedWildcard');
    });
  });

  describe('invalidRegexGroup', () => {
    it('accepts balanced regex groups', () => {
      expect(ruleIds(validatePathTemplate('/files/{path:(foo|bar)}'))).not.toContain('invalidRegexGroup');
    });

    it('rejects unclosed groups and unmatched closing parens', () => {
      expect(ruleIds(validatePathTemplate('/files/{path:(unclosed}'))).toContain('invalidRegexGroup');
      expect(ruleIds(validatePathTemplate('/files/{path:foo)}'))).toContain('invalidRegexGroup');
    });
  });

  describe('ambiguousRegexLiteral', () => {
    it('accepts plain static segments', () => {
      expect(ruleIds(validatePathTemplate('/api/v1/pets'))).not.toContain('ambiguousRegexLiteral');
    });

    it('warns when static segments contain regex metacharacters', () => {
      expect(ruleIds(validatePathTemplate('/api/v1/pets.json'))).toContain('ambiguousRegexLiteral');
    });
  });

  describe('consecutiveSlashes', () => {
    it('accepts single slashes between segments', () => {
      expect(ruleIds(validatePathTemplate('/api/v1/pets'))).not.toContain('consecutiveSlashes');
    });

    it('warns on consecutive slashes', () => {
      const issues = validatePathTemplate('/api//v1/pets');
      expect(ruleIds(issues)).toContain('consecutiveSlashes');
      expect(issues.find((issue) => issue.ruleId === 'consecutiveSlashes')?.suggestedFix).toEqual({
        ruleId: 'consecutiveSlashes',
        title: 'Collapse consecutive slashes',
        replacement: '/api/v1/pets',
      });
    });
  });

  describe('trailingSlash', () => {
    it('accepts paths without a trailing slash', () => {
      expect(ruleIds(validatePathTemplate('/api/v1/pets'))).not.toContain('trailingSlash');
    });

    it('reports info when a trailing slash is present', () => {
      const issues = validatePathTemplate('/api/v1/pets/');
      expect(ruleIds(issues)).toContain('trailingSlash');
      expect(issues.find((issue) => issue.ruleId === 'trailingSlash')?.severity).toBe('info');
    });
  });
});

describe('extractPathTemplates', () => {
  it('extracts allowlisted YamlES routing fields with offsets', async () => {
    const content = await readFixture('valid/Policies/ValidRouting.yaml');
    const extracted = extractPathTemplates(content);

    expect(extracted.map((entry) => entry.template)).toEqual([
      '/api/v1/pets/{petId}',
      '/api/v1/pets/{petId}/orders/{orderId}',
    ]);
    expect(content.slice(extracted[0].startOffset, extracted[0].endOffset)).toBe(
      '/api/v1/pets/{petId}',
    );
  });

  it('extracts multiple templates from mixed fixture content', async () => {
    const content = await readFixture('mixed/Policies/MixedRouting.yaml');
    const extracted = extractPathTemplates(content);

    expect(extracted).toHaveLength(3);
    expect(extracted.map((entry) => entry.template)).toEqual([
      '/api/v1/pets/{petId}',
      'api/bad/{id}/{id}',
      '/api//orders/',
    ]);
  });

  it('does not extract path-like strings from non-routing fields', async () => {
    const content = await readFixture('non-routing/Policies/NonRouting.yaml');

    expect(extractPathTemplates(content)).toEqual([]);
  });
});

describe('fixture-backed validation', () => {
  it('produces zero errors for valid templates', async () => {
    const content = await readFixture('valid/Policies/ValidRouting.yaml');

    for (const result of analyzePathTemplatesInContent(content, 'ValidRouting.yaml')) {
      expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    }
  });

  it('flags each invalid fixture by rule id', async () => {
    const cases: Array<[string, string]> = [
      ['invalid/empty-template.yaml', 'emptyTemplate'],
      ['invalid/missing-leading-slash.yaml', 'missingLeadingSlash'],
      ['invalid/duplicate-param.yaml', 'duplicateParam'],
      ['invalid/unclosed-placeholder.yaml', 'unclosedPlaceholder'],
      ['invalid/invalid-placeholder-name.yaml', 'invalidPlaceholderName'],
      ['invalid/unsupported-wildcard.yaml', 'unsupportedWildcard'],
      ['invalid/invalid-regex-group.yaml', 'invalidRegexGroup'],
      ['invalid/ambiguous-regex-literal.yaml', 'ambiguousRegexLiteral'],
      ['invalid/consecutive-slashes.yaml', 'consecutiveSlashes'],
      ['invalid/trailing-slash.yaml', 'trailingSlash'],
    ];

    for (const [fixturePath, expectedRule] of cases) {
      const content = await readFixture(fixturePath);
      const results = analyzePathTemplatesInContent(content, fixturePath);
      const allRuleIds = results.flatMap((result) => result.issues.map((issue) => issue.ruleId));
      expect(allRuleIds, fixturePath).toContain(expectedRule);
    }
  });

  it('summarizes mixed severities across a multi-template file', async () => {
    const content = await readFixture('mixed/Policies/MixedRouting.yaml');
    const results = analyzePathTemplatesInContent(content, 'MixedRouting.yaml');
    const summary = summarizeValidationResults(results);

    expect(summary.templatesValidated).toBe(3);
    expect(summary.errorCount).toBeGreaterThan(0);
    expect(summary.warningCount).toBeGreaterThan(0);
    expect(summary.infoCount).toBeGreaterThan(0);
  });
});

describe('tool descriptor', () => {
  it('registers under the validate group with the workspace command', () => {
    expect(PATH_TEMPLATE_VALIDATOR_TOOL.group).toBe('validate');
    expect(PATH_TEMPLATE_VALIDATOR_TOOL.command).toBe('policyStudioTools.validatePathTemplates');
    expect(PATH_TEMPLATE_VALIDATOR_TOOL.available).toBe(true);
  });
});
