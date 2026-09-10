import { describe, expect, it } from 'vitest';
import { extractEnvAttributePlaceholders } from '../../src/features/envValuesEditor/findEnvAttributeUsages';

describe('extractEnvAttributePlaceholders', () => {
  it('maps {{path.attributeValue}} to the ENV key and full-match offsets', () => {
    const content = 'cert: "{{Service.Health.serviceCert.attributeValue}}"';
    const found = extractEnvAttributePlaceholders(content);
    expect(found).toHaveLength(1);
    expect(found[0].envKey).toBe('Service.Health.serviceCert');
    expect(content.slice(found[0].startOffset, found[0].endOffset)).toBe(
      '{{Service.Health.serviceCert.attributeValue}}',
    );
  });

  it('trims whitespace inside the braces', () => {
    const content = '{{  A.AA.attributeValue  }}';
    const found = extractEnvAttributePlaceholders(content);
    expect(found).toHaveLength(1);
    expect(found[0].envKey).toBe('A.AA');
    expect(content.slice(found[0].startOffset, found[0].endOffset)).toBe(content);
  });

  it('keeps every match in the same string', () => {
    const content =
      '{{A.AA.attributeValue}} then {{B.BB.attributeValue}} and {{A.AA.attributeValue}}';
    const keys = extractEnvAttributePlaceholders(content).map((item) => item.envKey);
    expect(keys).toEqual(['A.AA', 'B.BB', 'A.AA']);
  });

  it('ignores placeholders that are not .attributeValue', () => {
    const content = 'path: "{{id}}" selector: "{{request.headers.host}}"';
    expect(extractEnvAttributePlaceholders(content)).toEqual([]);
  });
});
