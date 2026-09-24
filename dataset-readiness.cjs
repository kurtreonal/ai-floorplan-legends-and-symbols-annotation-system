'use strict';

// Read-only dataset audit. No inferred permissions, project identities or approvals.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const REVIEWED = new Set(['corrected', 'manually_added', 'user_reviewed']);
const SHA = /^[a-f0-9]{64}$/;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const normalized = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
const revision = value => digest(JSON.stringify(stable(value)));

function catalogOf(references) {
  const entries = (references.legend_catalog || []).map(entry => ({
    id: entry.legend_entry, label: entry.label, examples: entry.examples || [],
  })).sort((a, b) => a.id.localeCompare(b.id));
  if (entries.some(e => !e.id || !e.label) || new Set(entries.map(e => e.id)).size !== entries.length) throw Error('Invalid or duplicate legend identities');
  return { version: revision(entries), entries };
}

function resolveClass(sheet, annotation, catalog) {
  const scopes = new Set([sheet.id, ...(sheet.associated_legend_ids || [])]);
  const scoped = catalog.entries.filter(e => scopes.has(e.id.split(':')[0]));
  const identity = scoped.filter(e => e.id === annotation.legend_entry);
  if (identity.length === 1 && annotation.class_state === 'approved_legend_mapping') return { class_id: identity[0].id, evidence: 'approved_drawing_identity' };
  const matches = scoped.filter(e => normalized(e.label) === normalized(annotation.label));
  if (matches.length === 1) return { class_id: matches[0].id, evidence: 'exact_drawing_label_proposal', needs_review: true };
  return { class_id: null, evidence: matches.length > 1 ? 'ambiguous_drawing_label' : 'unresolved_drawing_class', needs_review: true };
}

function validBox(annotation, sheet) {
  const b = annotation.geometry?.coordinates;
  return annotation.geometry?.type === 'bbox' && Array.isArray(b) && b.length === 4 &&
    b.every(Number.isFinite) && b[0] >= 0 && b[1] >= 0 && b[2] > b[0] && b[3] > b[1] &&
    b[2] <= sheet.width && b[3] <= sheet.height;
}

async function sourceIndex(root) {
  const byHash = new Map();
  for (const folder of ['images', 'references']) {
    const visit = async directory => {
      if (!fs.existsSync(directory)) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) { await visit(target); continue; }
        if (!/\.(jpg|jpeg|png)$/i.test(entry.name)) continue;
        const stat = fs.statSync(target);
        if (stat.size > 25 * 1024 * 1024) continue;
        const bytes = fs.readFileSync(target);
        const hash = digest(bytes);
        try {
          const meta = await sharp(bytes, { limitInputPixels: 60000000 }).metadata();
          if (meta.width > 10000 || meta.height > 10000) continue;
          byHash.set(hash, { width: meta.width, height: meta.height, image_url: '/' + path.relative(root, target).split(path.sep).map(encodeURIComponent).join('/') });
        } catch { /* Inventoried as unresolved by the caller, never exported. */ }
      }
    };
    await visit(path.join(root, folder));
  }
  return byHash;
}

function audit(payload, catalog, sources, sealed = new Set()) {
  if (payload.schema !== 'ved-editable-review-v2' || !Array.isArray(payload.sheets)) throw Error('Invalid review schema');
  const ids = new Set();
  const coverage = {};
  const pages = payload.sheets.map(sheet => {
    if (!sheet.id || ids.has(sheet.id)) throw Error('Duplicate or missing page identity');
    ids.add(sheet.id);
    const blockers = [];
    const source = sources.get(sheet.source_sha256);
    if (!SHA.test(sheet.source_sha256 || '') || !source) blockers.push('source_missing_or_hash_unverified');
    if (!source || source.width !== sheet.width || source.height !== sheet.height) blockers.push('source_dimensions_unverified');
    if (!['original_image_pixels', 'rendered_page_pixels'].includes(sheet.coordinate_frame)) blockers.push('coordinate_frame_unverified');
    if (sheet.coordinate_frame === 'rendered_page_pixels' && (!Number.isInteger(sheet.pdf_page) || sheet.pdf_page < 1 || !SHA.test(sheet.original_source_sha256 || ''))) blockers.push('pdf_page_identity_unverified');
    // Imported claims remain claims until a trusted review authority is integrated.
    blockers.push('project_identity_requires_verified_review', 'split_requires_verified_review', 'training_approval_authority_unavailable');
    const decision = payload.decisions?.[sheet.id]?.decision;
    if (['exclude', 'rescan_needed'].includes(decision)) blockers.push(decision);
    const annotations = [];
    const annotationIds = new Set();
    for (const ann of sheet.annotations || []) {
      if (!ann.id || annotationIds.has(ann.id)) blockers.push('duplicate_or_missing_annotation_identity');
      annotationIds.add(ann.id);
      if (ann.review_state === 'deleted') continue;
      if (sealed.has(sheet.id) || sheet.split === 'sealed_test') { blockers.push('sealed_test_excluded_from_class_design'); continue; }
      if (ann.layer === 'unresolved') blockers.push('unresolved_page_regions');
      if (ann.layer !== 'symbols') continue;
      const mapping = resolveClass(sheet, ann, catalog);
      const reasons = [];
      if (!validBox(ann, sheet)) reasons.push('invalid_symbol_box');
      if (!REVIEWED.has(ann.review_state)) reasons.push('annotation_review_pending');
      if (!mapping.class_id || mapping.needs_review) reasons.push(mapping.evidence);
      if (mapping.class_id) {
        coverage[mapping.class_id] ||= { reviewed: 0, pending: 0, train: 0, validation: 0, test: 0 };
        coverage[mapping.class_id][reasons.length ? 'pending' : 'reviewed']++;
      }
      annotations.push({ id: ann.id, box: ann.geometry?.coordinates, original_label: ann.label,
        review_state: ann.review_state, class_state: ann.class_state, ...mapping, reasons });
    }
    if (annotations.some(a => a.reasons.length)) blockers.push('symbol_corrections_pending');
    blockers.push('symbol_completeness_unverified');
    return { id: sheet.id, revision: revision(sheet), group: sheet.group, sheet_type: sheet.sheet_type, width: sheet.width, height: sheet.height, image_url: source?.image_url,
      source_verified: !!source && source.width === sheet.width && source.height === sheet.height,
      annotations, blockers: [...new Set(blockers)], eligible: false };
  });
  const hashGroups = new Map();
  for (const sheet of payload.sheets) for (const hash of new Set([sheet.source_sha256, sheet.original_source_sha256].filter(Boolean))) {
    if (!hashGroups.has(hash)) hashGroups.set(hash, new Set());
    hashGroups.get(hash).add(sheet.id);
  }
  return { schema: 'ved-dataset-readiness-v1', catalog_version: catalog.version,
    source_count: pages.length, workspace_group_count: new Set(pages.map(p => p.group)).size,
    verified_independent_projects: 0, unknown_project_pages: pages.length,
    verified_sources: pages.filter(p => p.source_verified).length,
    invalid_symbol_boxes: pages.reduce((n, p) => n + p.annotations.filter(a => a.reasons.includes('invalid_symbol_box')).length, 0),
    eligible_pages: 0, coverage, duplicate_source_groups: [...hashGroups.values()].filter(v => v.size > 1).map(v => [...v]),
    permission: 'VED owner authorized supplied collection; not annotation approval',
    encryption: 'deferred_with_user_acceptance', metrics: 'NOT MEASURED',
    evaluation_policy: { status: 'proposed_not_approved', precision: 0.85, recall: 0.85, iou: 0.5, detector_confidence: 0.5 }, pages };
}

function proposedClassCoverage(report, catalog) {
  const labels = new Map(catalog.entries.map(entry => [entry.id, entry.label]));
  const classes = new Map();
  for (const page of report.pages) {
    if (page.sealed_test) continue;
    const split = page.review?.project_proposal?.split;
    for (const annotation of page.annotations) {
      if (!annotation.class_id) continue;
      if (!classes.has(annotation.class_id)) classes.set(annotation.class_id, {
        class_id: annotation.class_id, label: labels.get(annotation.class_id),
        reviewed_valid: 0, pending: 0, proposed_train: 0, proposed_validation: 0,
        workspace_groups: new Set(),
      });
      const entry = classes.get(annotation.class_id);
      entry.workspace_groups.add(String(page.group));
      if (!page.source_verified || annotation.reasons.length) { entry.pending++; continue; }
      entry.reviewed_valid++;
      if (split === 'train') entry.proposed_train++;
      if (split === 'validation') entry.proposed_validation++;
    }
  }
  const items = [...classes.values()].map(({ workspace_groups, ...entry }) => ({
    ...entry, workspace_group_count: workspace_groups.size,
    validation_label_absent_from_train: entry.proposed_validation > 0 && entry.proposed_train === 0,
  })).sort((a, b) => a.label.localeCompare(b.label) || a.class_id.localeCompare(b.class_id));
  const byExactLabel = new Map();
  for (const entry of classes.values()) {
    const key = normalized(entry.label);
    if (!byExactLabel.has(key)) byExactLabel.set(key, {
      label: entry.label, drawing_class_ids: [], workspace_groups: new Set(),
      reviewed_valid: 0, proposed_train: 0, proposed_validation: 0,
    });
    const group = byExactLabel.get(key);
    group.drawing_class_ids.push(entry.class_id);
    for (const source of entry.workspace_groups) group.workspace_groups.add(source);
    group.reviewed_valid += entry.reviewed_valid;
    group.proposed_train += entry.proposed_train;
    group.proposed_validation += entry.proposed_validation;
  }
  const exactTextGroups = [...byExactLabel.values()].map(({ workspace_groups, ...group }) => ({
    ...group, workspace_group_count: workspace_groups.size,
    validation_text_absent_from_train: group.proposed_validation > 0 && group.proposed_train === 0,
  })).sort((a, b) => a.label.localeCompare(b.label));
  return { status: 'LOCAL_PROPOSAL_ONLY', classes: items,
    validation_labels_absent_from_train: items.filter(entry => entry.validation_label_absent_from_train).length,
    single_workspace_group_classes: items.filter(entry => entry.workspace_group_count === 1).length,
    exact_text_groups: exactTextGroups,
    single_workspace_group_label_texts: exactTextGroups.filter(group => group.workspace_group_count === 1).length,
    validation_label_texts_absent_from_train: exactTextGroups.filter(group => group.validation_text_absent_from_train).length };
}

function symbolCandidates(payload, report, catalog, sessionSha256) {
  if (!SHA.test(sessionSha256 || '')) throw Error('Session hash required');
  const labels = new Map(catalog.entries.map(entry => [entry.id, entry.label]));
  const sheets = new Map(payload.sheets.map(sheet => [sheet.id, sheet]));
  const records = [], mappingProposals = [], exclusions = [];
  for (const page of report.pages) {
    const sheet = sheets.get(page.id);
    if (!sheet) throw Error('Page audit/source mismatch');
    for (const annotation of page.annotations) {
      const reasons = [...annotation.reasons];
      reasons.push(...page.blockers.filter(reason => ['coordinate_frame_unverified', 'pdf_page_identity_unverified', 'duplicate_or_missing_annotation_identity'].includes(reason)));
      if (!page.source_verified) reasons.push('source_unverified');
      if (page.sealed_test) reasons.push('sealed_test_excluded');
      if (['exclude', 'rescan_needed'].includes(payload.decisions?.[page.id]?.decision)) reasons.push('page_excluded');
      if (page.review?.quality === 'unreadable') reasons.push('page_unreadable');
      const candidate = { page_id: page.id, annotation_id: annotation.id, annotation_revision: page.revision,
        source_sha256: sheet.source_sha256, width: sheet.width, height: sheet.height,
        coordinate_frame: sheet.coordinate_frame, sheet_type: sheet.sheet_type,
        box: annotation.box, annotation_review_state: annotation.review_state,
        original_class_state: annotation.class_state,
        drawing_legend_id: annotation.class_id, drawing_legend_label: labels.get(annotation.class_id),
        workspace_group: sheet.group, project_proposal: page.review?.project_proposal || null,
        quality_review: page.review?.quality || 'pending',
        symbol_layer_review: page.review?.layers?.symbols || { complete: false, reviewed: false } };
      if (reasons.length === 1 && reasons[0] === 'exact_drawing_label_proposal') {
        mappingProposals.push({ ...candidate, mapping_status: 'exact_label_requires_human_confirmation' });
        continue;
      }
      if (reasons.length) {
        exclusions.push({ page_id: page.id, annotation_id: annotation.id, reasons: [...new Set(reasons)] });
        continue;
      }
      records.push({ ...candidate, mapping_status: 'explicit_drawing_mapping' });
    }
  }
  return { schema: 'ved-reviewed-symbol-candidates-v1', task: 'symbol_crop_candidates',
    status: 'review_export_not_training_approval', training_approved: false,
    source_session_sha256: sessionSha256, catalog_version: catalog.version,
    class_coverage: report.proposed_class_coverage, records,
    mapping_proposals: mappingProposals, exclusions };
}

function iou(a, b) {
  const intersection = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - intersection;
  return union > 0 ? intersection / union : 0;
}

// Confidence-ordered, class-aware, one-to-one matching; no sealed-test tuning.
function detectionMetrics(truth, predictions, { complete = false, split, confidence = 0.5, threshold = 0.5 } = {}) {
  if (!complete || split === 'sealed_test') return { status: 'NOT MEASURED' };
  for (const item of [...truth, ...predictions]) if (!item.page_id || !item.class_id || !Array.isArray(item.box) || item.box.length !== 4 || !item.box.every(Number.isFinite) || item.box[0] < 0 || item.box[1] < 0 || item.box[2] <= item.box[0] || item.box[3] <= item.box[1]) throw Error('Invalid metric input');
  if (![confidence, threshold].every(n => Number.isFinite(n) && n >= 0 && n <= 1) || predictions.some(p => !Number.isFinite(p.confidence) || p.confidence < 0 || p.confidence > 1)) throw Error('Invalid metric threshold or confidence');
  const used = new Set();
  const selected = predictions.filter(p => p.confidence >= confidence).sort((a, b) => b.confidence - a.confidence);
  let tp = 0;
  for (const p of selected) {
    let best = -1, overlap = threshold;
    truth.forEach((t, i) => {
      if (used.has(i) || t.page_id !== p.page_id || t.class_id !== p.class_id) return;
      const score = iou(p.box, t.box);
      if (score >= overlap && (best === -1 || score > overlap)) { best = i; overlap = score; }
    });
    if (best !== -1) { used.add(best); tp++; }
  }
  return { status: 'MEASURED', tp, fp: selected.length - tp, fn: truth.length - tp,
    precision: selected.length ? tp / selected.length : null, recall: truth.length ? tp / truth.length : null };
}

module.exports = { digest, revision, catalogOf, resolveClass, validBox, sourceIndex, audit, proposedClassCoverage, symbolCandidates, detectionMetrics, iou };
