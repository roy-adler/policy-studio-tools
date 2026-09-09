import { describe, expect, it } from 'vitest';
import {
  decodeFilenameTokens,
  parseFilenameKeyFields,
  stripCollisionSuffix,
} from '../../src/features/pathSearch/filenameTokens';

describe('filenameTokens', () => {
  it('decodes Axway filesystem tokens', () => {
    expect(decodeFilenameTokens('(slash)api(slash)orders')).toBe('/api/orders');
    expect(decodeFilenameTokens('(asterisk)')).toBe('*');
    expect(decodeFilenameTokens('http(colon)(slash)(slash)x')).toBe('http://x');
  });

  it('strips trailing collision suffix before key split', () => {
    expect(stripCollisionSuffix('(slash)api(slash)orders,GET 1')).toBe(
      '(slash)api(slash)orders,GET',
    );
    expect(stripCollisionSuffix('(slash),(asterisk)')).toBe('(slash),(asterisk)');
  });

  it('parses method and matcher from comma key fields', () => {
    expect(parseFilenameKeyFields('(slash),(asterisk)')).toEqual({
      keys: ['/', '*'],
      uriMatcher: '*',
    });
    expect(parseFilenameKeyFields('(slash)api(slash)orders,GET')).toEqual({
      keys: ['/api/orders', 'GET'],
      httpMethod: 'GET',
    });
    expect(parseFilenameKeyFields('(slash)api(slash)orders,GET 1')).toEqual({
      keys: ['/api/orders', 'GET'],
      httpMethod: 'GET',
    });
  });
});
