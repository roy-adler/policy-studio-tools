import path from 'path';
import { describe, expect, it } from 'vitest';
import { compareSnapshots } from '../../src/features/policyDiff/compareSnapshots';
import { loadPolicySnapshotFromDirectory } from '../../src/features/policyDiff/directoryAdapter';
import { normalizeScript } from '../../src/features/policyDiff/semanticModel';
import { POLICY_DIFF_TOOL } from '../../src/features/policyDiff/toolDescriptor';

const fixturesDir = path.join(__dirname, '..', 'fixtures', 'policy-diff');

async function loadFixture(name: string) {
  return loadPolicySnapshotFromDirectory(path.join(fixturesDir, name));
}

async function diffFixtures(leftName: string, rightName: string) {
  const left = await loadFixture(leftName);
  const right = await loadFixture(rightName);
  return compareSnapshots(left, right);
}

describe('policy diff', () => {
  it('registers compare policies tool in Analyze group', () => {
    expect(POLICY_DIFF_TOOL.group).toBe('analyze');
    expect(POLICY_DIFF_TOOL.command).toBe('policyStudioTools.comparePolicies');
    expect(POLICY_DIFF_TOOL.available).toBe(true);
  });

  it('reports no semantic changes for formatting-only YAML projects', async () => {
    const report = await diffFixtures('baseline', 'formatting-only');

    expect(report.identical).toBe(true);
    expect(report.summary.addedCircuits).toBe(0);
    expect(report.summary.removedCircuits).toBe(0);
    expect(report.summary.modifiedCircuits).toBe(0);
    expect(report.summary.scriptChanges).toBe(0);
    expect(report.summary.pathChanges).toBe(0);
    expect(report.summary.urlChanges).toBe(0);
  });

  it('reports no semantic changes for formatting-only YAML', async () => {
    const left = await loadPolicySnapshotFromDirectory(
      path.join(fixturesDir, 'formatting-only-yaml-baseline'),
    );
    const right = await loadPolicySnapshotFromDirectory(
      path.join(fixturesDir, 'formatting-only-yaml-reformatted'),
    );
    const report = compareSnapshots(left, right);

    expect(report.identical).toBe(true);
    expect(report.summary.modifiedCircuits).toBe(0);
  });

  it('detects modified script in changed circuit fixture', async () => {
    const report = await diffFixtures('baseline', 'changed-circuit');

    expect(report.summary.modifiedCircuits).toBe(1);
    expect(report.summary.scriptChanges).toBe(1);

    const authChange = report.modifiedCircuits.find((entry) => entry.circuitName === 'AuthCircuit');
    expect(authChange?.scriptChanges[0]).toEqual(
      expect.objectContaining({
        filterName: 'ValidateToken',
        before: 'return token != null;',
        after: 'return token != null && token.length > 0;',
      }),
    );
  });

  it('detects added and removed circuits', async () => {
    const report = await diffFixtures('baseline', 'added-removed');

    expect(report.summary.addedCircuits).toBe(1);
    expect(report.summary.removedCircuits).toBe(1);
    expect(report.addedCircuits.some((entry) => entry.circuitName === 'PaymentAPI')).toBe(true);
    expect(report.removedCircuits.some((entry) => entry.circuitName === 'AuthCircuit')).toBe(true);
    expect(report.summary.leftOnlyFiles).toBe(1);
    expect(report.summary.rightOnlyFiles).toBe(1);
  });

  it('detects routing path and backend URL changes', async () => {
    const report = await diffFixtures('baseline', 'routing-url');

    expect(report.summary.pathChanges).toBe(1);
    expect(report.summary.urlChanges).toBe(1);

    const orderChange = report.modifiedCircuits.find((entry) => entry.circuitName === 'OrderAPI');
    expect(orderChange?.pathChanges[0]).toEqual(
      expect.objectContaining({
        before: '/orders/{orderId}',
        after: '/v2/orders/{orderId}',
      }),
    );
    expect(orderChange?.urlChanges[0]).toEqual(
      expect.objectContaining({
        before: 'https://api.example.com/orders',
        after: 'https://api.example.com/v2/orders',
      }),
    );
  });

  it('ignores CRLF-only script differences', () => {
    expect(normalizeScript('line1\r\nline2')).toBe('line1\nline2');
    expect(normalizeScript('same')).toBe(normalizeScript('same\r\n'));
  });

  it('lists unparseable files without failing the comparison', async () => {
    const report = await diffFixtures('baseline', 'invalid');

    expect(report.unparseableRight).toContain('Policies/BrokenPolicy.yaml');
    expect(report.summary.removedCircuits).toBe(1);
    expect(report.modifiedCircuits.length + report.addedCircuits.length).toBeGreaterThanOrEqual(0);
  });

  it('summary counts match detailed change lists', async () => {
    const report = await diffFixtures('baseline', 'routing-url');

    const modifiedFilterCount = report.modifiedCircuits.reduce(
      (total, circuit) => total + circuit.filterChanges.filter((change) => change.kind === 'modified').length,
      0,
    );
    const scriptCount = report.modifiedCircuits.reduce(
      (total, circuit) => total + circuit.scriptChanges.length,
      0,
    );
    const pathCount = report.modifiedCircuits.reduce(
      (total, circuit) => total + circuit.pathChanges.length,
      0,
    );
    const urlCount = report.modifiedCircuits.reduce(
      (total, circuit) => total + circuit.urlChanges.length,
      0,
    );

    expect(report.summary.modifiedFilters).toBe(modifiedFilterCount);
    expect(report.summary.scriptChanges).toBe(scriptCount);
    expect(report.summary.pathChanges).toBe(pathCount);
    expect(report.summary.urlChanges).toBe(urlCount);
  });
});
