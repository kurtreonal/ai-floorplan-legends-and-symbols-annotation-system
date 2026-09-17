// scripts/merge-json-datasets.cjs
// Merges only13-cctvproblem.json and final.json into merge-data.json
// Zero external dependencies. Zero emojis.

const fs = require('fs');
const path = require('path');
const AnnotationCore = require('../editor-core.js');

const FILE_1 = 'C:\\Users\\kupal\\Downloads\\only13-cctvproblem.json';
const FILE_2 = 'C:\\Users\\kupal\\Downloads\\final.json';
const TARGET_FILE = 'C:\\Users\\kupal\\Downloads\\merge-data.json';

function getTime(a) {
  if (a.last_edited_at) return new Date(a.last_edited_at).getTime();
  if (a.created_at) return new Date(a.created_at).getTime();
  return 0;
}

function runMerge() {
  if (!fs.existsSync(FILE_1)) {
    throw new Error('File not found: ' + FILE_1);
  }
  if (!fs.existsSync(FILE_2)) {
    throw new Error('File not found: ' + FILE_2);
  }

  console.log('Reading', FILE_1, '...');
  const d1 = JSON.parse(fs.readFileSync(FILE_1, 'utf8'));
  console.log('Reading', FILE_2, '...');
  const d2 = JSON.parse(fs.readFileSync(FILE_2, 'utf8'));

  const mergedSheets = [];
  let d1Count = 0;
  let d2Count = 0;
  let mergedCount = 0;

  for (let i = 0; i < d1.sheets.length; i++) {
    const s1 = d1.sheets[i];
    const s2 = d2.sheets.find(s => s.id === s1.id);
    d1Count += s1.annotations.length;
    d2Count += (s2 ? s2.annotations.length : 0);

    const mergedSheet = { ...s1 };
    const annMap = new Map();

    // Ingest d2 first
    if (s2 && Array.isArray(s2.annotations)) {
      for (const a of s2.annotations) {
        annMap.set(a.id, JSON.parse(JSON.stringify(a)));
      }
    }

    // Merge d1
    if (Array.isArray(s1.annotations)) {
      for (const a1 of s1.annotations) {
        if (!annMap.has(a1.id)) {
          annMap.set(a1.id, JSON.parse(JSON.stringify(a1)));
        } else {
          const a2 = annMap.get(a1.id);
          const t1 = getTime(a1);
          const t2 = getTime(a2);

          let winner;
          if (t1 > t2) {
            winner = JSON.parse(JSON.stringify(a1));
          } else if (t2 > t1) {
            winner = JSON.parse(JSON.stringify(a2));
          } else {
            const isRev1 = a1.review_state === 'corrected' || a1.review_state === 'user_reviewed';
            const isRev2 = a2.review_state === 'corrected' || a2.review_state === 'user_reviewed';
            if (isRev1 && !isRev2) winner = JSON.parse(JSON.stringify(a1));
            else if (isRev2 && !isRev1) winner = JSON.parse(JSON.stringify(a2));
            else winner = JSON.parse(JSON.stringify(a1));
          }

          if (winner.legend_entry && !winner.legendKey) {
            winner.legendKey = winner.legend_entry;
          }
          annMap.set(a1.id, winner);
        }
      }
    }

    const annotations = Array.from(annMap.values()).map(a => {
      if (a.legend_entry && !a.legendKey) a.legendKey = a.legend_entry;
      return a;
    });

    mergedSheet.annotations = annotations;
    mergedCount += annotations.length;
    mergedSheets.push(mergedSheet);
  }

  const mergedPayload = {
    schema: d1.schema || 'ved-editable-review-v2',
    created_at: new Date().toISOString(),
    training_approved: false,
    coordinate_system: d1.coordinate_system || 'per_sheet_pixel_frame',
    baseline_revision: d1.baseline_revision || 'expanded-review-2026-09-09',
    decisions: Object.assign({}, d2.decisions || {}, d1.decisions || {}),
    legend_colors: Object.assign({}, d2.legend_colors || {}, d1.legend_colors || {}),
    sheets: mergedSheets
  };

  // Validate review using baseline
  const dataJsPath = path.join(__dirname, '..', 'data.js');
  const expJsPath = path.join(__dirname, '..', 'expanded-dataset.js');
  const dataJs = fs.readFileSync(dataJsPath, 'utf8');
  const expJs = fs.readFileSync(expJsPath, 'utf8');
  const sandbox = { window: {} };
  require('vm').runInNewContext(dataJs + ';' + expJs, sandbox);
  const baseline = sandbox.window.ANNOTATION_DATA;

  console.log('Validating merged review against baseline dataset...');
  AnnotationCore.validateReview(mergedPayload, baseline);
  console.log('Validation: PASS');

  console.log('Writing merged data to:', TARGET_FILE);
  fs.writeFileSync(TARGET_FILE, JSON.stringify(mergedPayload, null, 2), 'utf8');

  const stat = fs.statSync(TARGET_FILE);
  console.log('Successfully wrote merge-data.json (' + (stat.size / 1024 / 1024).toFixed(2) + ' MB)');
  console.log('Summary:');
  console.log('- Sheets:', mergedPayload.sheets.length);
  console.log('- Total annotations in only13-cctvproblem.json:', d1Count);
  console.log('- Total annotations in final.json:', d2Count);
  console.log('- Total annotations in merge-data.json:', mergedCount);
  console.log('- Decisions count:', Object.keys(mergedPayload.decisions).length);
  console.log('- Legend colors count:', Object.keys(mergedPayload.legend_colors).length);
}

runMerge();
