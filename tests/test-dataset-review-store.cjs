'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { revision } = require('../dataset-readiness.cjs');
const S = require('../dataset-review-store.cjs');
const sheet = { id: 'synthetic', annotations: [{ id: 'one', label: 'outlet' }] };
const request = { actor: 'Synthetic reviewer', annotation_revision: revision(sheet), action: 'layer_review', layer: 'symbols', complete: true, reviewed: true };
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ved-review-test-'));

test('immutable history, save/reload, task-specific review and stale invalidation', () => {
  const root = dir();
  const record = S.appendReview(root, sheet, request, 'catalog');
  const original = fs.readFileSync(path.join(root, '00000001.json'));
  let history = S.readHistory(root);
  let state = S.pageReview(history, sheet, 'catalog');
  assert.equal(state.layers.symbols.complete, true);
  assert.equal(state.layers.geometry.complete, false);
  assert.equal(state.training_approved, false);
  const changed = structuredClone(sheet); changed.annotations[0].label = 'switch';
  state = S.pageReview(history, changed, 'catalog');
  assert.equal(state.layers.symbols.complete, false);
  assert.equal(state.stale_decisions, 1);
  S.appendReview(root, changed, { ...request, annotation_revision: revision(changed), previous: record.hash, complete: false, reviewed: false }, 'catalog');
  assert.deepEqual(fs.readFileSync(path.join(root, '00000001.json')), original);
  history = S.readHistory(root); assert.equal(history.length, 2);
  assert.deepEqual(history[0].annotation_snapshot, sheet);
});
test('reject stale writes, self-declared authority, incomplete review and history tampering', () => {
  const root = dir();
  assert.throws(() => S.appendReview(root, sheet, { ...request, annotation_revision: 'old' }, 'c'), /Annotations changed/);
  assert.throws(() => S.appendReview(root, sheet, { ...request, training_approved: true }, 'c'), /Authenticated/);
  assert.throws(() => S.appendReview(root, sheet, { ...request, complete: false }, 'c'), /requires annotation/);
  S.appendReview(root, sheet, request, 'c');
  assert.throws(() => S.appendReview(root, sheet, request, 'c'), /history changed/);
  const file = path.join(root, '00000001.json');
  const record = JSON.parse(fs.readFileSync(file)); record.value.complete = false;
  fs.writeFileSync(file, JSON.stringify(record));
  assert.throws(() => S.readHistory(root), /integrity/);
});
test('project and split proposals cannot silently change established membership', () => {
  const root = dir();
  const proposal = { ...request, action: 'project_proposal', project: 'project-a', split: 'validation' };
  const first = S.appendReview(root, sheet, proposal, 'c');
  assert.throws(() => S.appendReview(root, sheet, { ...proposal, previous: first.hash, split: 'train' }, 'c'), /cannot be silently rewritten/);
  assert.equal(S.pageReview(S.readHistory(root), sheet, 'c').project_proposal.status, 'proposed_not_independently_verified');
});
