'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { revision } = require('./dataset-readiness.cjs');
const LAYERS = ['symbols', 'geometry', 'wiring', 'text', 'completeness'];

function readHistory(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = fs.readdirSync(directory).filter(f => /^\d{8}\.json$/.test(f)).sort();
  const records = files.map(f => JSON.parse(fs.readFileSync(path.join(directory, f), 'utf8')));
  let previous = null;
  records.forEach((record, index) => {
    const { hash, ...body } = record;
    if (body.sequence !== index + 1 || body.previous !== previous || hash !== revision(body)) throw Error('Review history integrity failure');
    previous = hash;
  });
  return records;
}

function appendReview(directory, sheet, request, catalogVersion) {
  if (request.annotation_revision !== revision(sheet)) throw Error('Annotations changed; refresh before reviewing');
  if (typeof request.actor !== 'string' || !request.actor.trim() || request.actor.length > 120) throw Error('A reviewer name is required (local attestation only)');
  if (request.training_approved || request.action === 'approve_training') throw Error('Authenticated dataset approval is not configured');
  if (!['layer_review', 'project_proposal', 'quality_review'].includes(request.action)) throw Error('Unsupported review action');
  const history = readHistory(directory);
  const previous = history.at(-1)?.hash || null;
  if ((request.previous || null) !== previous) throw Error('Review history changed; refresh before saving');
  let value;
  if (request.action === 'layer_review') {
    if (!LAYERS.includes(request.layer) || typeof request.complete !== 'boolean' || typeof request.reviewed !== 'boolean') throw Error('Invalid layer review');
    if (request.reviewed && !request.complete) throw Error('Review completion requires annotation completion');
    value = { layer: request.layer, complete: request.complete, reviewed: request.reviewed };
  } else if (request.action === 'quality_review') {
    if (!['readable', 'unreadable', 'pending'].includes(request.quality)) throw Error('Invalid quality decision');
    value = { quality: request.quality };
  } else {
    if (typeof request.project !== 'string' || !request.project.trim() || request.project.length > 120 || !['train', 'validation', 'sealed_test', 'pending'].includes(request.split)) throw Error('Invalid project/split proposal');
    const established = history.find(r => r.page_id === sheet.id && r.action === 'project_proposal');
    if (established && (established.value.project !== request.project || established.value.split !== request.split)) throw Error('Established grouping proposal cannot be silently rewritten; explicit split-change review is required');
    value = { project: request.project, split: request.split, status: 'proposed_not_independently_verified' };
  }
  const body = { sequence: history.length + 1, previous, page_id: sheet.id, annotation_revision: revision(sheet),
    catalog_version: catalogVersion, actor: request.actor.trim(), identity_assurance: 'local_unverified_attestation',
    at: new Date().toISOString(), action: request.action, value, notes: String(request.notes || '').slice(0, 2000),
    // Full source annotation snapshot makes stale decisions recoverable.
    annotation_snapshot: sheet };
  const record = { ...body, hash: revision(body) };
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${String(body.sequence).padStart(8, '0')}.json`), JSON.stringify(record, null, 2), { flag: 'wx' });
  return record;
}

function pageReview(history, page, catalogVersion) {
  const all = history.filter(r => r.page_id === page.id);
  const current = all.filter(r => r.annotation_revision === revision(page) && r.catalog_version === catalogVersion);
  const layers = Object.fromEntries(LAYERS.map(layer => [layer, current.filter(r => r.action === 'layer_review' && r.value.layer === layer).at(-1)?.value || { complete: false, reviewed: false }]));
  return { layers, stale_decisions: all.length - current.length, decision_count: all.length,
    quality: current.filter(r => r.action === 'quality_review').at(-1)?.value.quality || 'pending',
    project_proposal: current.filter(r => r.action === 'project_proposal').at(-1)?.value || null,
    training_approved: false, identity_assurance: 'local_unverified_attestation' };
}
function sealedPages(history) {
  const groups = history.filter(r => r.action === 'project_proposal');
  const projects = new Set(groups.filter(r => r.value.split === 'sealed_test').map(r => r.value.project));
  return new Set(groups.filter(r => projects.has(r.value.project)).map(r => r.page_id));
}
module.exports = { LAYERS, readHistory, appendReview, pageReview, sealedPages };
