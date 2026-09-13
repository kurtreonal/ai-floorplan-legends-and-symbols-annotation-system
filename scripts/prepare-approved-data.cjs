// prepare-approved-data.cjs
// Builds derived approved reference library from merged-annotations.json, data.js, and expanded-dataset.js
// Conforms to GEMINI-SYMBOL-DETECTION-HANDOFF.md specifications. Zero emojis.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const defaultMergedPath = 'C:/Users/kupal/Downloads/merged-annotations.json';
const mergedPath = process.argv[2] || defaultMergedPath;
const rootDir = fs.existsSync(path.join(__dirname, 'data.js')) ? __dirname : path.resolve(__dirname, '..');
const dataJsPath = path.join(rootDir, 'data.js');
const expandedJsPath = path.join(rootDir, 'expanded-dataset.js');
const outputPath = fs.existsSync(path.join(rootDir, 'data')) ? path.join(rootDir, 'data/approved-references.json') : path.join(rootDir, 'approved-references.json');

console.log('Reading data sources...');
console.log('Source file:', mergedPath);

if (!fs.existsSync(mergedPath)) {
  console.error(`Error: ${mergedPath} not found.`);
  process.exit(1);
}

const mergedData = JSON.parse(fs.readFileSync(mergedPath, 'utf8'));
const sheets = mergedData.sheets || mergedData;

// Read window.ANNOTATION_DATA from data.js and expanded-dataset.js
let dataJsSheets = [];
let expandedSheets = [];
let windowContext = {};
try {
  eval(fs.readFileSync(dataJsPath, 'utf8'));
  dataJsSheets = windowContext.ANNOTATION_DATA?.sheets || [];
} catch (e) {
  // Try evaluating with local window variable
  try {
    let window = windowContext;
    eval(fs.readFileSync(dataJsPath, 'utf8'));
    dataJsSheets = window.ANNOTATION_DATA?.sheets || [];
    windowContext = window;
  } catch (err) {
    console.warn('Warning: Could not parse data.js directly:', err.message);
  }
}

try {
  if (fs.existsSync(expandedJsPath)) {
    let window = windowContext;
    eval(fs.readFileSync(expandedJsPath, 'utf8'));
    expandedSheets = window.DATASET_EXPANSION?.sheets || [];
    if (window.ANNOTATION_DATA?.sheets) {
      dataJsSheets = window.ANNOTATION_DATA.sheets;
    }
  }
} catch (e) {
  console.warn('Warning: Could not parse expanded-dataset.js directly:', e.message);
}

const metaMap = new Map();
for (const s of dataJsSheets) metaMap.set(s.id, s);
for (const s of expandedSheets) metaMap.set(s.id, s);

let totalAnnotations = 0;
let totalActive = 0;
let totalDeleted = 0;
let totalLegends = 0;
let totalLegendsWithoutId = 0;

const approvedSheets = [];
const legendCatalog = new Map(); // legend_entry -> { legend_entry, label, layer, examples: [] }
const unlinkedLegends = []; // array of records without legend_entry, given stable reference_id

for (const sheet of sheets) {
  const meta = metaMap.get(sheet.id) || {};
  let sheetType = meta.sheet_type || sheet.sheet_type;
  if (!sheetType) {
    sheetType = (sheet.title && sheet.title.toLowerCase().includes('legend')) ? 'legend_reference' : 'plan';
  }
  const associatedLegends = meta.associated_legend_ids || sheet.associated_legend_ids || [];

  // Determine relative image path
  let relativeImage = meta.image || sheet.image;
  if (!relativeImage) {
    if (sheet.id === 'sheet-51') {
      relativeImage = 'references/additional/bdo-page-1.png';
    } else if (sheet.id === 'sheet-52') {
      relativeImage = 'references/additional/cogeo-rcp.png';
    } else {
      relativeImage = `images/${sheet.id}.jpg`;
    }
  }

  // Verify image file existence and sha256
  const absoluteImage = path.join(__dirname, relativeImage);
  if (!fs.existsSync(absoluteImage)) {
    console.error(`Error: Image file not found for ${sheet.id}: ${absoluteImage}`);
    process.exit(1);
  }

  const imageBuffer = fs.readFileSync(absoluteImage);
  const computedSha256 = crypto.createHash('sha256').update(imageBuffer).digest('hex');
  const expectedSha256 = meta.sha256 || sheet.source_sha256 || sheet.sha256;
  if (expectedSha256 && computedSha256 !== expectedSha256) {
    console.error(`Error: SHA-256 mismatch for ${sheet.id}! Computed: ${computedSha256}, Expected: ${expectedSha256}`);
    process.exit(1);
  }

  const activeAnnotations = [];
  const deletedAnnotations = [];

  for (const ann of sheet.annotations || []) {
    totalAnnotations++;
    if (ann.review_state === 'deleted') {
      totalDeleted++;
      deletedAnnotations.push({
        id: ann.id,
        layer: ann.layer,
        label: ann.label,
        geometry: ann.geometry,
        legend_entry: ann.legend_entry || null,
        review_state: 'deleted'
      });
      continue;
    }

    totalActive++;
    activeAnnotations.push(ann);

    if (ann.layer === 'legend') {
      totalLegends++;
      if (ann.legend_entry) {
        if (!legendCatalog.has(ann.legend_entry)) {
          legendCatalog.set(ann.legend_entry, {
            legend_entry: ann.legend_entry,
            label: ann.label,
            layer: ann.layer,
            examples: []
          });
        }
        const entry = legendCatalog.get(ann.legend_entry);
        entry.examples.push({
          source_annotation_id: ann.id,
          source_sheet_id: sheet.id,
          source_sha256: computedSha256,
          geometry: ann.geometry,
          label: ann.label,
          role: 'legend_definition'
        });
      } else {
        totalLegendsWithoutId++;
        const stableRefId = `ref-${sheet.id}-${ann.id}`;
        unlinkedLegends.push({
          reference_id: stableRefId,
          legend_entry: null,
          source_annotation_id: ann.id,
          source_sheet_id: sheet.id,
          source_sha256: computedSha256,
          geometry: ann.geometry,
          label: ann.label,
          role: 'unlinked_legend'
        });
      }
    }
  }

  approvedSheets.push({
    id: sheet.id,
    group: meta.group ?? sheet.group,
    group_name: meta.group_name || sheet.group_name || '',
    title: meta.title || sheet.title || '',
    sheet_type: sheetType,
    image: relativeImage,
    width: sheet.width || meta.width,
    height: sheet.height || meta.height,
    sha256: computedSha256,
    associated_legend_ids: associatedLegends,
    active_annotations_count: activeAnnotations.length,
    deleted_annotations_count: deletedAnnotations.length,
    annotations: activeAnnotations,
    deletions: deletedAnnotations,
    legends: activeAnnotations.filter(a => a.layer === 'legend'),
    symbols: activeAnnotations.filter(a => a.layer === 'symbols')
  });
}

const catalogArray = Array.from(legendCatalog.values());

const result = {
  version: 'ved-approved-references-v2',
  generated_at: new Date().toISOString(),
  stats: {
    total_sheets: approvedSheets.length,
    total_annotations: totalAnnotations,
    total_active: totalActive,
    total_deleted: totalDeleted,
    total_legend_records: totalLegends,
    total_legend_catalog_entries: catalogArray.length,
    total_unlinked_legend_records: totalLegendsWithoutId
  },
  legend_catalog: catalogArray,
  unlinked_legends: unlinkedLegends,
  sheets: approvedSheets
};

fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
console.log(`Generated ${outputPath}`);
console.log(`Summary: ${approvedSheets.length} sheets verified.`);
console.log(`Annotations: ${totalAnnotations} total, ${totalActive} active, ${totalDeleted} deleted.`);
console.log(`Legends: ${totalLegends} total (${catalogArray.length} distinct linked legend IDs, ${totalLegendsWithoutId} unlinked legend records).`);
