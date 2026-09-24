'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const R = require('./dataset-readiness.cjs');

function preparePredictions(input, payload, catalog, report) {
  if (input.schema !== 'ved-symbol-predictions-v1' || !Array.isArray(input.pages) || !input.pages.length || input.pages.length > 1000 ||
      ![input.model_id, input.run_id].every(v => typeof v === 'string' && v.trim() && v.length <= 200)) throw Error('Expected prediction schema, model/run identity and pages');
  const knownClasses = new Set(catalog.entries.map(c => c.id));
  const ids = new Set();
  const pages = input.pages.map(p => {
    const source = payload.sheets.find(s => s.id === p.page_id);
    const audit = report.pages.find(s => s.id === p.page_id);
    if (!source || ids.has(p.page_id)) throw Error('Unknown or duplicate prediction page');
    ids.add(p.page_id);
    if (audit.sealed_test || audit.review?.project_proposal?.split === 'sealed_test') throw Error('Sealed-test prediction review is excluded');
    if (!audit.source_verified || p.source_sha256 !== source.source_sha256) throw Error('Prediction source hash mismatch or unavailable source');
    if (!Array.isArray(p.annotations) || p.annotations.length > 10000) throw Error('Invalid prediction annotation count');
    const predictions = p.annotations.map((a, i) => {
      if (!knownClasses.has(a.class_id) || !R.validBox({ geometry: { type: 'bbox', coordinates: a.box } }, source) || !Number.isFinite(a.confidence) || a.confidence < 0 || a.confidence > 1) throw Error('Invalid prediction class, confidence or coordinates');
      return { id: `prediction-${i + 1}`, page_id: p.page_id, class_id: a.class_id, box: a.box, confidence: a.confidence };
    });
    const truth = audit.annotations.filter(a => !a.reasons.length).map(a => ({ id: a.id, page_id: p.page_id, class_id: a.class_id, box: a.box }));
    const complete = audit.review?.layers.symbols.complete && audit.review.layers.symbols.reviewed && audit.review.quality === 'readable' &&
      !audit.annotations.some(a => a.reasons.length) && !audit.blockers.includes('unresolved_page_regions');
    const metrics = R.detectionMetrics(truth, predictions, { complete: !!complete, split: audit.review?.project_proposal?.split });
    const errors = [];
    if (complete) {
      // Diagnostics use the same greedy ordering as the aggregate matcher.
      const used = new Set();
      for (const prediction of predictions.filter(p => p.confidence >= 0.5).sort((a, b) => b.confidence - a.confidence)) {
        const overlap = truth.map((t, i) => ({ t, i, score: R.iou(t.box, prediction.box) })).filter(m => !used.has(m.i)).sort((a, b) => b.score - a.score);
        const match = overlap.find(m => m.score >= 0.5 && m.t.class_id === prediction.class_id);
        if (match) { used.add(match.i); continue; }
        const wrong = overlap.find(m => m.score >= 0.5);
        const near = overlap.find(m => m.score > 0 && m.t.class_id === prediction.class_id);
        errors.push({ prediction_id: prediction.id, kind: wrong ? 'wrong_class' : near ? 'localization' : 'false_positive', truth_id: (wrong || near)?.t.id || null });
      }
      truth.forEach((t, i) => { if (!used.has(i)) errors.push({ truth_id: t.id, kind: 'missed_symbol' }); });
    }
    return { page_id: p.page_id, source_sha256: p.source_sha256, annotation_revision: audit.revision,
      image_url: audit.image_url, width: source.width, height: source.height, predictions, truth, errors, metrics,
      evaluation_status: complete ? 'local_reviewed_diagnostic_not_gold_or_release_acceptance' : 'NOT MEASURED: complete readable reviewed symbol ground truth required' };
  });
  return { schema: input.schema, model_id: input.model_id, run_id: input.run_id, catalog_version: catalog.version,
    confidence_threshold: 0.5, iou_threshold: 0.5, created_at: new Date().toISOString(), pages };
}

function persistPredictions(directory, record) {
  fs.mkdirSync(directory, { recursive: true });
  const id = `${Date.now()}-${crypto.randomUUID()}`;
  const stored = { ...record, artifact_id: id, content_sha256: R.revision(record) };
  fs.writeFileSync(path.join(directory, `${id}.json`), JSON.stringify(stored, null, 2), { flag: 'wx' });
  return stored;
}
module.exports = { preparePredictions, persistPredictions };
