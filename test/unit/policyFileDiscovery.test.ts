import path from 'path';
import { describe, expect, it } from 'vitest';
import { discoverPolicyFiles } from '../../src/features/circuitSearch/policyFileDiscovery';
import type { PolicyStudioProject } from '../../src/features/projectRegistry/types';

const fixturesDir = path.join(__dirname, '..', 'fixtures', 'circuit-search');

function yamlProject(name: string, rootPath: string): PolicyStudioProject {
  return {
    id: `test-${name}`,
    rootPath,
    workspaceFolder: rootPath,
    relativePath: '',
    displayName: name,
    projectType: 'yaml',
  };
}

describe('discoverPolicyFiles', () => {
  it('finds nested team-a/*.yaml under a YAML project root', async () => {
    const project = yamlProject(
      'ambiguous-names',
      path.join(fixturesDir, 'ambiguous-names'),
    );

    const files = await discoverPolicyFiles(project);
    const relative = files.map((file) => path.relative(project.rootPath, file).split(path.sep).join('/'));

    expect(relative).toEqual(
      expect.arrayContaining(['team-a/SharedAuth.yaml', 'team-b/SharedAuth.yaml']),
    );
  });
});
