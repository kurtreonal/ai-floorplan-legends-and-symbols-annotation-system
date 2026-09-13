'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function stable(value) {
  return JSON.stringify(value);
}

function loadBaseline(folder) {
  const context = { window: {} };
  for (const file of ['data.js', 'expanded-dataset.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(folder, file), 'utf8'), context, { filename: file });
  }
  return context.window.ANNOTATION_DATA;
}

function indexById(items) {
  return new Map(items.map((item) => [item.id, item]));
}

function mergeValue(base, left, right, description, conflicts) {
  if (stable(left) === stable(right)) return clone(left);
  if (stable(left) === stable(base)) return clone(right);
  if (stable(right) === stable(base)) return clone(left);
  conflicts.push(description);
  return clone(left);
}

function main() {
  const [baseFile, ...rest] = process.argv.slice(2);
  if (!baseFile || rest.length < 2) {
    console.error('Usage: node merge-reviews.cjs BASE.json REVIEW-A.json REVIEW-B.json [MORE.json ...] OUTPUT.json');
    process.exitCode = 1;
    return;
  }
  const outputFile = rest.pop();
  const inputFiles = [baseFile, ...rest];
  const exports = inputFiles.map(readJson);
  const baseline = loadBaseline(__dirname);
  const conflicts = [];

  for (const review of exports) {
    if (review.schema !== 'ved-editable-review-v2' || review.sheets?.length !== baseline.sheets.length) {
      throw new Error('Every input must be a complete ved-editable-review-v2 export for this bundle.');
    }
  }

  const merged = clone(exports[0]);
  merged.created_at = exports[0].created_at;
  merged.merged_at = new Date().toISOString();
  merged.merge_sources = inputFiles.map((file) => path.basename(file));
  merged.training_approved = false;
  for (const sheet of merged.sheets) {
    const source = baseline.sheets.find((item) => item.id === sheet.id);
    if (!source) throw new Error(`Unknown sheet: ${sheet.id}`);
    const byExport = exports.map((review) => indexById(review.sheets).get(sheet.id));
    if (byExport.some((item) => item.source_sha256 !== source.sha256)) {
      throw new Error(`Source hash mismatch for ${sheet.id}.`);
    }
    const baselineAnnotations = indexById(byExport[0].annotations);
    const ids = new Set(byExport.flatMap((item) => item.annotations.map((annotation) => annotation.id)));
    const annotations = [];
    for (const id of ids) {
      const base = baselineAnnotations.get(id);
      const values = byExport.map((item) => indexById(item.annotations).get(id));
      const present = values.filter(Boolean);
      if (!base) {
        if (present.every((value) => stable(value) === stable(present[0]))) annotations.push(clone(present[0]));
        else {
          conflicts.push(`${sheet.id}/${id}: independently added annotations differ`);
          annotations.push(clone(present[0]));
        }
        continue;
      }
      let value = clone(values[0] || base);
      for (let i = 1; i < values.length; i += 1) {
        value = mergeValue(base, value, values[i] || base, `${sheet.id}/${id}: annotation edits conflict`, conflicts);
      }
      annotations.push(value);
    }
    sheet.annotations = annotations;
    const baseDecision = exports[0].decisions?.[sheet.id] || { decision: 'pending', notes: '' };
    const decisions = exports.map((review) => review.decisions?.[sheet.id] || { decision: 'pending', notes: '' });
    let decision = clone(decisions[0]);
    for (let i = 1; i < decisions.length; i += 1) {
      decision = mergeValue(baseDecision, decision, decisions[i], `${sheet.id}: page decisions conflict`, conflicts);
    }
    if (decision.decision !== 'pending' || decision.notes) merged.decisions[sheet.id] = decision;
    else delete merged.decisions[sheet.id];
  }

  fs.writeFileSync(outputFile, JSON.stringify(merged, null, 2));
  const reportFile = `${outputFile}.conflicts.json`;
  fs.writeFileSync(reportFile, JSON.stringify({ schema: 'ved-review-merge-conflicts-v1', generated_at: new Date().toISOString(), conflicts }, null, 2));
  console.log(`Wrote ${outputFile}`);
  console.log(`Conflicts: ${conflicts.length} (${reportFile})`);
  process.exitCode = conflicts.length ? 2 : 0;
}

try {
  main();
} catch (error) {
  console.error(`Merge failed: ${error.message}`);
  process.exitCode = 1;
}
