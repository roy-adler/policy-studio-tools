import path from 'path';
import { describe, expect, it } from 'vitest';
import { isPolicyStudioProject } from '../../src/features/projectDetection/detectPolicyStudioProject';

const fixturesDir = path.join(__dirname, '..', 'fixtures');

describe('isPolicyStudioProject', () => {
  it('detects sample project in test/fixtures/sample-policy-project', () => {
    const sampleProject = path.join(fixturesDir, 'sample-policy-project');
    expect(isPolicyStudioProject(sampleProject)).toBe(true);
  });

  it('detects YAML project with values.yaml and Policies directory', () => {
    const yamlProject = path.join(fixturesDir, 'sample-yaml-policy-project');
    expect(isPolicyStudioProject(yamlProject)).toBe(true);
  });

  it('does not detect normal folders', () => {
    const normalFolder = path.join(fixturesDir, 'normal-folder');
    expect(isPolicyStudioProject(normalFolder)).toBe(false);
  });

  it('does not detect values.yaml without Policy Studio directories', () => {
    const valuesOnly = path.join(fixturesDir, 'values-yaml-only');
    expect(isPolicyStudioProject(valuesOnly)).toBe(false);
  });
});
