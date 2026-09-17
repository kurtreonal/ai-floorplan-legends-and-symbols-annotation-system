// scripts/update-expanded-dataset.cjs
// Appends Group 23-28 sheets to window.DATASET_EXPANSION in expanded-dataset.js
// Conforms to VED additive dataset schema. Zero emojis.

const fs = require('fs');
const path = require('path');

function updateWorkspace(targetDir) {
  const expPath = path.join(targetDir, 'expanded-dataset.js');
  const metaPath = path.join(targetDir, '.temp', 'new-sheets-metadata.json');

  if (!fs.existsSync(expPath)) {
    console.error('File not found:', expPath);
    return false;
  }

  let newSheets = [];
  if (fs.existsSync(metaPath)) {
    newSheets = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } else {
    // Fallback to local .temp path
    const fallbackPath = path.join(__dirname, '..', '.temp', 'new-sheets-metadata.json');
    if (fs.existsSync(fallbackPath)) {
      newSheets = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
    } else {
      console.error('New sheets metadata not found in', metaPath);
      return false;
    }
  }

  const formattedNewSheets = newSheets.map(s => ({
    id: s.id,
    group: s.group,
    group_name: s.group_name,
    filename: s.filename,
    image: s.image,
    width: s.width,
    height: s.height,
    sha256: s.sha256,
    original_source_sha256: s.original_source_sha256,
    source_path: 'C:\\\\Users\\\\kupal\\\\Downloads\\\\FLOOR PLAN DATA SETS NIGGA\\\\' + s.filename,
    coordinate_frame: 'original_image_pixels',
    coordinate_system: 'original_image_pixels',
    pdf_page: null,
    sheet_type: s.sheet_type,
    title: s.title,
    rotation_to_read_clockwise: 0,
    associated_legend_ids: s.associated_legend_ids,
    annotations: [],
    issues: s.issues,
    training_eligible: false
  }));

  const expContent = fs.readFileSync(expPath, 'utf8');
  const m = expContent.match(/window\.DATASET_EXPANSION\s*=\s*(\{.*?\});/);
  if (!m) {
    console.error('Could not match window.DATASET_EXPANSION in', expPath);
    return false;
  }

  const expansionObj = JSON.parse(m[1]);
  const currentSheetIds = new Set(expansionObj.sheets.map(s => s.id));

  let addedCount = 0;
  for (const s of formattedNewSheets) {
    if (!currentSheetIds.has(s.id)) {
      expansionObj.sheets.push(s);
      currentSheetIds.add(s.id);
      addedCount++;
    }
  }

  const line1 = 'window.DATASET_EXPANSION=' + JSON.stringify(expansionObj) + ';';
  const line2 = '(function(){const d=window.ANNOTATION_DATA;if(!d)return;d.legacy_sheet_ids=d.sheets.map(s=>s.id);const existingIds=new Set(d.sheets.map(s=>s.id));for(const s of window.DATASET_EXPANSION.sheets){if(!existingIds.has(s.id)){d.sheets.push(s);existingIds.add(s.id);}}d.counts.images=d.sheets.length;d.counts.groups=new Set(d.sheets.map(s=>s.group)).size;d.counts.plans=d.sheets.filter(s=>s.sheet_type===\'plan\'||s.sheet_type===\'plan_with_legend\').length;d.counts.legend_reference_sheets=d.sheets.filter(s=>s.sheet_type===\'legend_reference\').length;})();';

  fs.writeFileSync(expPath, line1 + '\n' + line2 + '\n', 'utf8');
  console.log(`Updated ${expPath}: added ${addedCount} sheets. Total in expansion: ${expansionObj.sheets.length}.`);
  return true;
}

const targets = [
  'c:\\Users\\kupal\\Downloads\\VED-floor-plan-review-portable',
  'c:\\Users\\kupal\\Documents\\VED-floor-plan-review-portable'
];

for (const t of targets) {
  if (fs.existsSync(t)) {
    updateWorkspace(t);
  }
}
