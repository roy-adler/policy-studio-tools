import { describe, expect, it } from 'vitest';
import { pathMatchesAnyGlob } from '../../src/features/projectRegistry/globMatch';

describe('pathMatchesAnyGlob', () => {
  it('matches ** for any path', () => {
    expect(pathMatchesAnyGlob('apps/gateway-a', ['**'])).toBe(true);
    expect(pathMatchesAnyGlob('deep/nested/path', ['**'])).toBe(true);
  });

  it('excludes node_modules paths', () => {
    const excludes = ['**/node_modules/**'];
    expect(pathMatchesAnyGlob('node_modules/decoy', excludes)).toBe(true);
    expect(pathMatchesAnyGlob('apps/node_modules/pkg', excludes)).toBe(true);
    expect(pathMatchesAnyGlob('apps/gateway-a', excludes)).toBe(false);
  });

  it('excludes .git paths', () => {
    const excludes = ['**/.git/**'];
    expect(pathMatchesAnyGlob('.git/objects', excludes)).toBe(true);
    expect(pathMatchesAnyGlob('src/main.ts', excludes)).toBe(false);
  });
});
