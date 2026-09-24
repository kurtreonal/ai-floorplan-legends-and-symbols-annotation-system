'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { digest } = require('../dataset-readiness.cjs');
const server = require('../server.cjs');

test('local API: audit, export gate, origin guard and unchanged saved session', async () => {
  const session = path.join(__dirname, '..', 'data', 'saved-session.json');
  const before = digest(fs.readFileSync(session));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const status = await (await fetch(base + '/api/status')).json();
    assert.equal(status.local_only, true);
    assert.equal(status.model_hopping, false);
    assert.equal((await fetch(base + '/.env')).status, 403);
    assert.equal((await fetch(base + '/api/status', { headers: { Origin: 'https://example.invalid' } })).status, 403);
    const response = await fetch(base + '/api/dataset-readiness');
    assert.equal(response.status, 200);
    const report = await response.json();
    assert.equal(report.metrics, 'NOT MEASURED');
    assert.equal(report.source_count, JSON.parse(fs.readFileSync(session, 'utf8')).sheets.length);
    assert.equal(report.proposed_class_coverage.status, 'LOCAL_PROPOSAL_ONLY');
    const candidatesResponse = await fetch(base + '/api/dataset-symbol-candidates');
    assert.equal(candidatesResponse.status, 200);
    const candidates = await candidatesResponse.json();
    assert.equal(candidates.schema, 'ved-reviewed-symbol-candidates-v1');
    assert.equal(candidates.training_approved, false);
    assert.ok(candidates.records.length > 0);
    assert.ok(candidates.mapping_proposals.length > 0);
    assert.ok(candidates.records.every(record => /^[a-f0-9]{64}$/.test(record.source_sha256) && record.drawing_legend_id && record.box.length === 4));
    const rejected = await fetch(base + '/api/export-training-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: { sheets: [] } }) });
    assert.equal(rejected.status, 409);
    assert.equal((await rejected.json()).code, 'DATASET_NOT_READY');
    assert.equal(digest(fs.readFileSync(session)), before);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
