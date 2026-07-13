import path from 'path';
import { describe, expect, it } from 'vitest';
import { parsePolicyXml } from '../../src/features/circuitSearch/xmlPolicyParser';
import { parsePolicyYaml } from '../../src/features/circuitSearch/yamlPolicyParser';
import { buildCircuitIndex } from '../../src/features/circuitSearch/circuitIndex';
import { searchCircuits } from '../../src/features/circuitSearch/searchCircuits';
import type { PolicyStudioProject } from '../../src/features/projectRegistry/types';

const fixturesDir = path.join(__dirname, '..', 'fixtures', 'circuit-search');

describe('parsePolicyXml (Axway entity store)', () => {
  it('extracts FilterCircuit and nested filter names from entity-store XML', () => {
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<entityStoreData xmlns="http://www.vordel.com/2005/06/24/entityStore">
  <entity type="FilterCircuit">
    <key type="FilterCircuit">
      <id field="name" value="Health Check"/>
    </key>
    <fval name="start"><value>Set Message</value></fval>
    <entity type="ChangeMessageFilter">
      <key type="ChangeMessageFilter">
        <id field="name" value="Set Message"/>
      </key>
      <fval name="body"><value>&lt;status&gt;ok&lt;/status&gt;</value></fval>
      <fval name="attributeName"><value>response.body</value></fval>
    </entity>
    <entity type="Reflector">
      <key type="Reflector">
        <id field="name" value="Reflect"/>
      </key>
    </entity>
    <entity type="CircuitReferralFilter">
      <key type="CircuitReferralFilter">
        <id field="name" value="Call Auth"/>
      </key>
      <fval name="circuit"><value>Policies/Auth/Validate Token</value></fval>
    </entity>
    <entity type="JavaScriptFilter">
      <key type="JavaScriptFilter">
        <id field="name" value="Run Script"/>
      </key>
      <fval name="script"><value>function run() { return checkHealth(); }</value></fval>
    </entity>
  </entity>
</entityStoreData>`;
    const parsed = parsePolicyXml(content);

    expect(parsed.circuits).toHaveLength(1);
    expect(parsed.circuits[0].name).toBe('Health Check');
    const filterNames = parsed.circuits[0].filters.map((filter) => filter.name).sort();
    expect(filterNames).toEqual(['Call Auth', 'Reflect', 'Run Script', 'Set Message']);
  });
});

describe('parsePolicyYaml (YamlES)', () => {
  it('extracts circuit and filters from YamlES policy file', () => {
    const fixture = path.join(fixturesDir, 'axway-yaml-es', 'Policies', 'Health Check.yaml');
    const fs = require('fs');
    const content = fs.readFileSync(fixture, 'utf8');
    const parsed = parsePolicyYaml(content);

    expect(parsed.circuits).toHaveLength(1);
    expect(parsed.circuits[0].name).toBe('Health Check');
    expect(parsed.circuits[0].filters.map((f) => f.name).sort()).toEqual([
      'Call Auth',
      'Reflect',
      'Run Script',
      'Set Message',
    ]);
  });
});

describe('searchCircuits (Axway fixtures)', () => {
  const yamlProject: PolicyStudioProject = {
    id: 'axway-yaml',
    rootPath: path.join(fixturesDir, 'axway-yaml-es'),
    workspaceFolder: path.join(fixturesDir, 'axway-yaml-es'),
    relativePath: '',
    displayName: 'axway-yaml',
    projectType: 'yaml',
  };

  it('finds Axway filter names by search query', async () => {
    const result = await searchCircuits([yamlProject], 'Set Message');
    expect(result.results.some((r) => r.filterName === 'Set Message')).toBe(true);
  });

  it('finds referenced circuit from CircuitReferralFilter', async () => {
    const result = await searchCircuits([yamlProject], 'Validate Token');
    expect(result.results.some((r) => r.matchKind === 'referencedCircuit')).toBe(true);
  });

  it('finds script content in JavaScriptFilter', async () => {
    const result = await searchCircuits([yamlProject], 'checkHealth');
    expect(result.results.some((r) => r.matchKind === 'script')).toBe(true);
  });

  it('searches YamlES policies', async () => {
    const result = await searchCircuits([yamlProject], 'Reflect');
    expect(result.results.some((r) => r.filterName === 'Reflect')).toBe(true);
  });
});
