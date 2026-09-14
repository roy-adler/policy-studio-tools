import { describe, expect, it } from 'vitest';
import {
  isYamlPolicyBundleLayout,
  policyDisplayBasename,
  policyTreeRelativePath,
} from '../../src/features/projectRegistry/yamlPolicyBundle';

describe('isYamlPolicyBundleLayout', () => {
  it('matches POLICYNAME/POLICYNAME_yaml regardless of suffix case', () => {
    expect(isYamlPolicyBundleLayout('/repo/NAME_ONE/NAME_ONE_YAML')).toBe(true);
    expect(isYamlPolicyBundleLayout('/repo/NAME_ONE/NAME_ONE_yaml')).toBe(true);
  });

  it('does not match when the parent folder is not the yaml stem', () => {
    expect(isYamlPolicyBundleLayout('/repo/sample/POLICY_yaml')).toBe(false);
    expect(isYamlPolicyBundleLayout('/repo/policies/loose/OtherPolicy_yaml')).toBe(false);
  });

  it('does not match folders that are not a _yaml store', () => {
    expect(isYamlPolicyBundleLayout('/repo/policies/AUTH_GATEWAY')).toBe(false);
    expect(isYamlPolicyBundleLayout('/repo/gateway')).toBe(false);
  });
});

describe('policyDisplayBasename', () => {
  it('uses the parent folder for a yaml bundle layout', () => {
    expect(
      policyDisplayBasename('/repo/policies/NAME_ONE/NAME_ONE_YAML', 'policies/NAME_ONE/NAME_ONE_YAML'),
    ).toBe('NAME_ONE');
  });

  it('uses the project folder basename otherwise', () => {
    expect(policyDisplayBasename('/repo/sample/POLICY_yaml', 'sample/POLICY_yaml')).toBe('POLICY_yaml');
    expect(policyDisplayBasename('/repo/gateway', '')).toBe('gateway');
  });
});

describe('policyTreeRelativePath', () => {
  it('drops the inner _yaml folder so the tree leaf is POLICYNAME', () => {
    expect(
      policyTreeRelativePath(
        '/repo/policies/AUTH_GATEWAY/AUTH_GATEWAY_YAML',
        'policies/AUTH_GATEWAY/AUTH_GATEWAY_YAML',
      ),
    ).toBe('policies/AUTH_GATEWAY');
  });

  it('keeps the full relative path when the parent is not the yaml stem', () => {
    expect(policyTreeRelativePath('/repo/sample/POLICY_yaml', 'sample/POLICY_yaml')).toBe(
      'sample/POLICY_yaml',
    );
  });
});
