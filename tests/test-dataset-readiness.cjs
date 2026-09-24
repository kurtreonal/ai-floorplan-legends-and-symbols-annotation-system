'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const R = require('../dataset-readiness.cjs');
const hash = 'a'.repeat(64);
const refs = { legend_catalog: [{ legend_entry: 'legend:L1', label: 'Duplex outlet' }] };
const ann = { id: 'a1', layer: 'symbols', label: 'Duplex outlet', legend_entry: 'legend:L1', class_state: 'approved_legend_mapping', review_state: 'corrected', geometry: { type: 'bbox', coordinates: [1, 1, 9, 9] } };
const sheet = () => ({ id: 's1', group: 1, source_sha256: hash, width: 10, height: 10, coordinate_frame: 'original_image_pixels', associated_legend_ids: ['legend'], annotations: [structuredClone(ann)] });
const payload = s => ({ schema: 'ved-editable-review-v2', sheets: [s] });
const sources = new Map([[hash, { width: 10, height: 10 }]]);

test('catalog stable; drawing scope and ambiguities never invent classes', () => {
  const catalog = R.catalogOf(refs);
  assert.equal(catalog.version, R.catalogOf(structuredClone(refs)).version);
  assert.equal(R.resolveClass(sheet(), ann, catalog).class_id, 'legend:L1');
  const unknown = { ...ann, class_state: 'unmapped' };
  assert.equal(R.resolveClass(sheet(), unknown, catalog).needs_review, true);
  const ambiguous = R.catalogOf({ legend_catalog: [...refs.legend_catalog, { legend_entry: 'legend:L2', label: ann.label }] });
  assert.equal(R.resolveClass(sheet(), unknown, ambiguous).class_id, null);
  assert.equal(R.resolveClass({ ...sheet(), associated_legend_ids: [] }, ann, catalog).class_id, null);
});
test('invalid geometry is reported without clamping or mutation', () => {
  for (const coords of [[-1, 0, 4, 4], [1, 1, 11, 9], [1, 1, 1, 3], [NaN, 1, 3, 3], [9, 9, 1, 1]]) {
    const s = sheet(); s.annotations[0].geometry.coordinates = coords;
    assert.equal(R.validBox(s.annotations[0], s), false);
    assert.deepEqual(s.annotations[0].geometry.coordinates, coords);
    assert.equal(R.audit(payload(s), R.catalogOf(refs), sources).invalid_symbol_boxes, 1);
  }
});
test('claims, changed hashes and incomplete pages never become eligible', () => {
  const s = { ...sheet(), training_eligible: true, training_approved: true, project_id: 'claimed', split: 'train' };
  let report = R.audit(payload(s), R.catalogOf(refs), sources);
  assert.equal(report.eligible_pages, 0);
  assert.equal(report.verified_independent_projects, 0);
  assert.ok(report.pages[0].blockers.includes('symbol_completeness_unverified'));
  s.source_sha256 = 'b'.repeat(64);
  report = R.audit(payload(s), R.catalogOf(refs), sources);
  assert.equal(report.verified_sources, 0);
});
test('source duplicate groups are separate from project counts', () => {
  const p = payload(sheet()); p.sheets.push({ ...sheet(), id: 's2', group: 2 });
  const report = R.audit(p, R.catalogOf(refs), sources);
  assert.deepEqual(report.duplicate_source_groups, [['s1', 's2']]);
  assert.equal(report.verified_independent_projects, 0);
});
test('revision changes on corrections; stable through save/reload', () => {
  const s = sheet(); const before = R.revision(s);
  assert.equal(before, R.revision(JSON.parse(JSON.stringify(s))));
  s.annotations[0].geometry.coordinates[0] = 2;
  assert.notEqual(before, R.revision(s));
});
test('export preserves reviewer geometry and manual class choices require drawing scope', () => {
  const C = require('../editor-core.js');
  const s = sheet();
  s.annotations[0].geometry.coordinates = [-3, 1, 9, 9];
  const original = payload(s);
  const snapshot = C.preserveReviewExport(original, { sheets: [{ id: 's1', sha256: hash, annotations: [] }] });
  assert.deepEqual(snapshot, original);
  assert.deepEqual(snapshot.sheets[0].annotations[0].geometry.coordinates, [-3, 1, 9, 9]);
  assert.equal(snapshot.sheets[0].annotations[0].class_state, 'approved_legend_mapping');
  assert.equal(C.isScopedLegend(s, 'legend:L1'), true);
  assert.equal(C.isScopedLegend(s, 'other:L1'), false);
  assert.equal(C.isScopedLegend(s, 'u:unreviewed'), false);
});
test('proposed class coverage exposes validation labels missing from training', () => {
  const catalog = R.catalogOf({ legend_catalog: [refs.legend_catalog[0], { legend_entry: 'legend:L2', label: 'Smoke detector' }] });
  const first = sheet();
  const second = { ...sheet(), id: 's2', group: 2, source_sha256: 'b'.repeat(64), annotations: [{ ...structuredClone(ann), id: 'a2', legend_entry: 'legend:L2', label: 'Smoke detector' }] };
  const report = R.audit({ schema: 'ved-editable-review-v2', sheets: [first, second] }, catalog,
    new Map([[hash, { width: 10, height: 10 }], ['b'.repeat(64), { width: 10, height: 10 }]]));
  report.pages[0].review = { project_proposal: { split: 'train' } };
  report.pages[1].review = { project_proposal: { split: 'validation' } };
  const coverage = R.proposedClassCoverage(report, catalog);
  assert.equal(coverage.status, 'LOCAL_PROPOSAL_ONLY');
  assert.equal(coverage.validation_labels_absent_from_train, 1);
  assert.equal(coverage.validation_label_texts_absent_from_train, 1);
  assert.equal(coverage.classes.find(c => c.class_id === 'legend:L2').validation_label_absent_from_train, true);
  assert.equal(coverage.classes.find(c => c.class_id === 'legend:L1').proposed_train, 1);
});
test('equal legend text across drawings is diagnostic, not an approved class merge', () => {
  const catalog = R.catalogOf({ legend_catalog: [
    { legend_entry: 'legend-a:L1', label: 'Duplex outlet' },
    { legend_entry: 'legend-b:L1', label: 'Duplex outlet' },
  ] });
  const a = { ...sheet(), id: 'a', group: 1, associated_legend_ids: ['legend-a'], annotations: [{ ...structuredClone(ann), legend_entry: 'legend-a:L1' }] };
  const b = { ...sheet(), id: 'b', group: 2, associated_legend_ids: ['legend-b'], source_sha256: 'b'.repeat(64), annotations: [{ ...structuredClone(ann), legend_entry: 'legend-b:L1' }] };
  const report = R.audit({ schema: 'ved-editable-review-v2', sheets: [a, b] }, catalog,
    new Map([[hash, { width: 10, height: 10 }], ['b'.repeat(64), { width: 10, height: 10 }]]));
  report.pages[0].review = { project_proposal: { split: 'train' } };
  report.pages[1].review = { project_proposal: { split: 'validation' } };
  const coverage = R.proposedClassCoverage(report, catalog);
  assert.equal(coverage.classes.length, 2);
  assert.equal(coverage.exact_text_groups.length, 1);
  assert.equal(coverage.exact_text_groups[0].workspace_group_count, 2);
  assert.equal(coverage.validation_labels_absent_from_train, 1);
  assert.equal(coverage.validation_label_texts_absent_from_train, 0);
});
test('candidate export keeps reviewed class, source and box provenance without approval', () => {
  const s = sheet();
  s.annotations.push({ ...structuredClone(ann), id: 'bad', geometry: { type: 'bbox', coordinates: [-1, 1, 9, 9] } });
  s.annotations.push({ ...structuredClone(ann), id: 'proposal', class_state: 'proposed_legend_mapping' });
  const p = payload(s);
  const catalog = R.catalogOf(refs);
  const report = R.audit(p, catalog, sources);
  report.pages[0].review = { quality: 'readable', project_proposal: { project: 'proposal', split: 'train' }, layers: { symbols: { complete: false, reviewed: false } } };
  report.proposed_class_coverage = R.proposedClassCoverage(report, catalog);
  const bundle = R.symbolCandidates(p, report, catalog, 'f'.repeat(64));
  assert.equal(bundle.training_approved, false);
  assert.equal(bundle.records.length, 1);
  assert.equal(bundle.mapping_proposals.length, 1);
  assert.equal(bundle.mapping_proposals[0].mapping_status, 'exact_label_requires_human_confirmation');
  assert.deepEqual(bundle.records[0].box, [1, 1, 9, 9]);
  assert.equal(bundle.records[0].drawing_legend_id, 'legend:L1');
  assert.equal(bundle.records[0].annotation_review_state, 'corrected');
  assert.equal(bundle.records[0].source_sha256, hash);
  assert.equal(bundle.records[0].project_proposal.split, 'train');
  assert.deepEqual(bundle.exclusions[0].reasons, ['invalid_symbol_box']);
  assert.equal(s.annotations[1].geometry.coordinates[0], -1);
  const sealed = R.audit(p, catalog, sources, new Set(['s1']));
  sealed.pages[0].sealed_test = true;
  assert.equal(R.symbolCandidates(p, sealed, catalog, 'f'.repeat(64)).records.length, 0);
});
test('known-answer matching: duplicates, wrong classes and misses', () => {
  const truth = [{ page_id: 'p', class_id: 'c', box: [0, 0, 10, 10] }, { page_id: 'p', class_id: 'd', box: [20, 20, 30, 30] }];
  const predictions = [{ ...truth[0], confidence: 0.9 }, { ...truth[0], confidence: 0.8 }, { ...truth[1], class_id: 'c', confidence: 0.7 }];
  assert.deepEqual(R.detectionMetrics(truth, predictions, { complete: true, split: 'validation' }), { status: 'MEASURED', tp: 1, fp: 2, fn: 1, precision: 1 / 3, recall: 0.5 });
  assert.equal(R.detectionMetrics(truth, predictions).status, 'NOT MEASURED');
  assert.equal(R.detectionMetrics(truth, predictions, { complete: true, split: 'sealed_test' }).status, 'NOT MEASURED');
});
test('bounded source verification preserves bytes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ved-source-audit-'));
  fs.mkdirSync(path.join(root, 'images'));
  const file = path.join(root, 'images', 'synthetic.png');
  const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'white' } }).png().toBuffer();
  fs.writeFileSync(file, bytes);
  const index = await R.sourceIndex(root);
  assert.deepEqual(index.get(R.digest(bytes)), { width: 10, height: 10, image_url: '/images/synthetic.png' });
  assert.deepEqual(fs.readFileSync(file), bytes);
  // Intentionally retain the uniquely named synthetic fixture, not user data.
});
test('unsafe legacy export blocked before any writes', () => {
  const { exportYoloDataset } = require('../scripts/export-yolo-dataset.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ved-export-audit-'));
  const outputDir = path.join(root, 'must-not-exist');
  assert.throws(() => exportYoloDataset(payload(sheet()), { outputDir }), { code: 'DATASET_NOT_READY' });
  assert.equal(fs.existsSync(outputDir), false);
});
test('local-only provider selection and hosted refinement guard', async () => {
  const engine = require('../auto-annotate.cjs');
  for (const options of [{}, { useGroqOnly: true }, { useGeminiOnly: true }]) assert.ok(engine.getCandidateTargets(options).every(t => t.provider === 'local_yolo'));
  await assert.rejects(engine.improveDetectionsWithApi('', {}, []), /Hosted refinement is disabled/);
});
