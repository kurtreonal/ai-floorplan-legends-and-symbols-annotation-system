'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { preparePredictions, persistPredictions } = require('../dataset-predictions.cjs');
const { sealedPages } = require('../dataset-review-store.cjs');
const source = { id: 'p', source_sha256: 'a'.repeat(64), width: 100, height: 100 };
const catalog = { version: 'v1', entries: [{ id: 'c' }, { id: 'd' }] };
const input = { schema: 'ved-symbol-predictions-v1', model_id: 'synthetic-test', run_id: 'test-only', pages: [{ page_id: 'p', source_sha256: source.source_sha256, annotations: [{ class_id: 'c', box: [0, 0, 10, 10], confidence: 0.9 }, { class_id: 'c', box: [0, 0, 10, 10], confidence: 0.8 }] }] };
const report = () => ({ pages: [{ id: 'p', source_verified: true, revision: 'r1', blockers: [], annotations: [{ id: 'truth1', reasons: [], class_id: 'c', box: [0, 0, 10, 10] }], review: { layers: { symbols: { complete: true, reviewed: true } }, quality: 'readable' } }] });
test('predictions remain separate; diagnostic matching and immutable artifacts', () => {
  const payload = { sheets: [source] }; const before = JSON.stringify(payload);
  const record = preparePredictions(input, payload, catalog, report());
  assert.equal(JSON.stringify(payload), before);
  assert.deepEqual(record.pages[0].metrics, { status: 'MEASURED', tp: 1, fp: 1, fn: 0, precision: 0.5, recall: 1 });
  assert.equal(record.pages[0].errors[0].kind, 'false_positive');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ved-prediction-test-'));
  const first = persistPredictions(directory, record);
  const bytes = fs.readFileSync(path.join(directory, first.artifact_id + '.json'));
  const second = persistPredictions(directory, record);
  assert.notEqual(first.artifact_id, second.artifact_id);
  assert.deepEqual(fs.readFileSync(path.join(directory, first.artifact_id + '.json')), bytes);
});
test('incomplete truth not measured; changed hashes, invalid boxes, sealed pages rejected', () => {
  const r = report(); r.pages[0].review.layers.symbols.complete = false;
  assert.equal(preparePredictions(input, { sheets: [source] }, catalog, r).pages[0].metrics.status, 'NOT MEASURED');
  r.pages[0].sealed_test = true;
  assert.throws(() => preparePredictions(input, { sheets: [source] }, catalog, r), /Sealed/);
  const changed = structuredClone(input); changed.pages[0].source_sha256 = 'b'.repeat(64);
  assert.throws(() => preparePredictions(changed, { sheets: [source] }, catalog, report()), /hash/);
  changed.pages[0].source_sha256 = source.source_sha256; changed.pages[0].annotations[0].box[2] = 101;
  assert.throws(() => preparePredictions(changed, { sheets: [source] }, catalog, report()), /coordinates/);
});
test('sealed protection follows project membership despite stale annotation revisions', () => {
  const records = [{ page_id: 'p', action: 'project_proposal', annotation_revision: 'old', value: { project: 'same', split: 'sealed_test' } }, { page_id: 'q', action: 'project_proposal', value: { project: 'same', split: 'train' } }];
  assert.deepEqual([...sealedPages(records)], ['p', 'q']);
});
