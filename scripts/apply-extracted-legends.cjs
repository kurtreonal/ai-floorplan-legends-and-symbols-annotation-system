// scripts/apply-extracted-legends.cjs
// Injects extracted legend annotations into expanded-dataset.js
// Conforms to VED dataset annotation review schema. Zero emojis.

const fs = require('fs');
const path = require('path');

function applyLegendsToWorkspace(targetDir) {
  const expPath = path.join(targetDir, 'expanded-dataset.js');
  const extractedPath = path.join(targetDir, '.temp', 'extracted-legends.json');
  const fallbackPath = path.join(__dirname, '..', '.temp', 'extracted-legends.json');

  const legendsFile = fs.existsSync(extractedPath) ? extractedPath : fallbackPath;
  if (!fs.existsSync(legendsFile)) {
    console.error('Extracted legends file not found:', legendsFile);
    return false;
  }

  const extractedList = JSON.parse(fs.readFileSync(legendsFile, 'utf8'));
  const expContent = fs.readFileSync(expPath, 'utf8');
  const m = expContent.match(/window\.DATASET_EXPANSION\s*=\s*(\{.*?\});/);
  if (!m) {
    console.error('Could not parse window.DATASET_EXPANSION in', expPath);
    return false;
  }

  const expansionObj = JSON.parse(m[1]);
  let totalLegendAdded = 0;

  for (const item of extractedList) {
    const sheet = expansionObj.sheets.find(s => s.id === item.id);
    if (!sheet) {
      console.warn(`Sheet ${item.id} not found in expanded-dataset.js`);
      continue;
    }

    if (!Array.isArray(sheet.annotations)) {
      sheet.annotations = [];
    }

    // Retain any non-legend annotations if existing
    const nonLegendAnnotations = sheet.annotations.filter(a => a.layer !== 'legend' && a.layer !== 'text');
    const newAnnotations = [];

    item.items.forEach((leg, idx) => {
      const num = String(idx + 1).padStart(2, '0');
      const legendEntry = `${sheet.id}:L${num}`;
      const symbolId = `${sheet.id}-legend-${num}`;
      const textId = `${sheet.id}-legend-text-${num}`;

      // Convert normalized [ymin, xmin, ymax, xmax] (0-1000) to pixel coordinates [x1, y1, x2, y2]
      const sBox = leg.symbol_box || [0, 0, 100, 100];
      const sYmin = Math.min(sBox[0], sBox[2]);
      const sXmin = Math.min(sBox[1], sBox[3]);
      const sYmax = Math.max(sBox[0], sBox[2]);
      const sXmax = Math.max(sBox[1], sBox[3]);

      const sx1 = Math.max(0, Math.min(sheet.width - 2, Math.round((sXmin * sheet.width) / 1000)));
      const sy1 = Math.max(0, Math.min(sheet.height - 2, Math.round((sYmin * sheet.height) / 1000)));
      const sx2 = Math.max(sx1 + 2, Math.min(sheet.width, Math.round((sXmax * sheet.width) / 1000)));
      const sy2 = Math.max(sy1 + 2, Math.min(sheet.height, Math.round((sYmax * sheet.height) / 1000)));

      newAnnotations.push({
        id: symbolId,
        layer: 'legend',
        label: leg.label.trim(),
        geometry: {
          type: 'bbox',
          coordinates: [sx1, sy1, sx2, sy2]
        },
        legend_entry: legendEntry,
        legendKey: legendEntry,
        review_state: 'needs_review',
        class_state: 'proposed_legend_mapping',
        production_class_id: null,
        method: 'assistant_visual_proposal',
        note: 'Embedded legend glyph. Legend sample, not an installed device.'
      });

      if (leg.text_box && Array.isArray(leg.text_box) && leg.text_box.length === 4) {
        const tBox = leg.text_box;
        const tYmin = Math.min(tBox[0], tBox[2]);
        const tXmin = Math.min(tBox[1], tBox[3]);
        const tYmax = Math.max(tBox[0], tBox[2]);
        const tXmax = Math.max(tBox[1], tBox[3]);

        const tx1 = Math.max(0, Math.min(sheet.width - 2, Math.round((tXmin * sheet.width) / 1000)));
        const ty1 = Math.max(0, Math.min(sheet.height - 2, Math.round((tYmin * sheet.height) / 1000)));
        const tx2 = Math.max(tx1 + 2, Math.min(sheet.width, Math.round((tXmax * sheet.width) / 1000)));
        const ty2 = Math.max(ty1 + 2, Math.min(sheet.height, Math.round((tYmax * sheet.height) / 1000)));

        newAnnotations.push({
          id: textId,
          layer: 'text',
          label: leg.label.trim(),
          geometry: {
            type: 'bbox',
            coordinates: [tx1, ty1, tx2, ty2]
          },
          legend_entry: legendEntry,
          review_state: 'needs_review',
          class_state: 'proposed_legend_mapping',
          production_class_id: null,
          method: 'assistant_visual_proposal',
          note: 'Transcribed from the drawing legend; preserve qualifiers.'
        });
      }
    });

    sheet.annotations = [...nonLegendAnnotations, ...newAnnotations];
    totalLegendAdded += item.items.length;
    console.log(`Updated ${sheet.id} (${sheet.filename}): ${item.items.length} legend entries, total annotations: ${sheet.annotations.length}.`);
  }

  const line1 = 'window.DATASET_EXPANSION=' + JSON.stringify(expansionObj) + ';';
  const line2 = '(function(){const d=window.ANNOTATION_DATA;if(!d)return;d.legacy_sheet_ids=d.sheets.map(s=>s.id);const existingIds=new Set(d.sheets.map(s=>s.id));for(const s of window.DATASET_EXPANSION.sheets){if(!existingIds.has(s.id)){d.sheets.push(s);existingIds.add(s.id);}else{const idx=d.sheets.findIndex(x=>x.id===s.id);if(idx>=0)d.sheets[idx]=s;}}d.counts.images=d.sheets.length;d.counts.groups=new Set(d.sheets.map(s=>s.group)).size;d.counts.plans=d.sheets.filter(s=>s.sheet_type===\'plan\'||s.sheet_type===\'plan_with_legend\').length;d.counts.legend_reference_sheets=d.sheets.filter(s=>s.sheet_type===\'legend_reference\').length;})();';

  fs.writeFileSync(expPath, line1 + '\n' + line2 + '\n', 'utf8');
  console.log(`Successfully updated ${expPath} with ${totalLegendAdded} legend entries.`);
  return true;
}

const targets = [
  'c:\\Users\\kupal\\Downloads\\VED-floor-plan-review-portable',
  'c:\\Users\\kupal\\Documents\\VED-floor-plan-review-portable'
];

for (const t of targets) {
  if (fs.existsSync(t)) {
    applyLegendsToWorkspace(t);
  }
}
