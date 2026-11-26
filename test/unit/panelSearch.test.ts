import path from 'path';
import { describe, expect, it } from 'vitest';
import { loadKpsSession } from '../../src/features/kpsEditor/loadKpsSession';
import { renderKpsEditorHtml } from '../../src/features/kpsEditor/kpsPanelHtml';
import { compareSnapshots } from '../../src/features/policyDiff/compareSnapshots';
import { loadPolicySnapshotFromDirectory } from '../../src/features/policyDiff/directoryAdapter';
import { renderPolicyDiffReportHtml } from '../../src/features/policyDiff/policyDiffPanelHtml';
import { getFlowPanelHtml } from '../../src/features/policyFlowView/flowPanelHtml';

const kpsRoot = path.join(__dirname, '..', 'fixtures', 'kps-editor', 'sample', 'KPS');
const diffFixturesDir = path.join(__dirname, '..', 'fixtures', 'policy-diff');

describe('panel search', () => {
  it('renders a KPS row search that keeps the remembered query', () => {
    const session = loadKpsSession(kpsRoot);
    const html = renderKpsEditorHtml(session, {
      cspSource: 'https://example',
      tableName: 'T_CC_Sample_WebServices.json',
      stageId: 'DEVL',
      nonce: 'testnonce',
      searchQuery: 'a"b',
    });
    expect(html).toContain('id="grid-search"');
    expect(html).toContain('value="a&quot;b"');
    expect(html).toContain('grid-empty-filter');
    expect(html).toContain("type: 'search'");
  });

  it('omits the KPS row search when the stage has no rows to filter', () => {
    const session = loadKpsSession(kpsRoot);
    const table = session.tables['T_CC_Sample_WebServices.json'];
    const missingStage = session.stageIds.find((id) => table.stages[id]?.status === 'missing');
    if (!missingStage) {
      return;
    }
    const html = renderKpsEditorHtml(session, {
      cspSource: 'https://example',
      tableName: 'T_CC_Sample_WebServices.json',
      stageTarget: { kind: 'stage', stageId: missingStage },
      nonce: 'testnonce',
    });
    expect(html).not.toContain('id="grid-search"');
  });

  it('renders a flow view search over filter nodes', () => {
    const html = getFlowPanelHtml('testnonce');
    expect(html).toContain('id="flow-search"');
    expect(html).toContain('applyFlowSearch');
  });

  it('renders a policy diff search with a nonce-allowed script', async () => {
    const left = await loadPolicySnapshotFromDirectory(path.join(diffFixturesDir, 'baseline'));
    const right = await loadPolicySnapshotFromDirectory(path.join(diffFixturesDir, 'baseline'));
    const html = renderPolicyDiffReportHtml(compareSnapshots(left, right), 'testnonce');
    expect(html).toContain('id="diff-search"');
    expect(html).toContain("script-src 'nonce-testnonce'");
    expect(html).toContain('<script nonce="testnonce">');
  });
});
