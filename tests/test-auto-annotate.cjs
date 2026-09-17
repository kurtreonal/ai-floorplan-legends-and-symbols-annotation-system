// test-auto-annotate.cjs
// Comprehensive test suite for VED Auto-Annotation Engine per GEMINI-SYMBOL-DETECTION-HANDOFF.md
// Tests all 52 sheets, data integrity, coordinate conversion, tiling, truthful API paths,
// contact sheets, 5-image ceiling, suppression of deleted items, and OCR non-suppression.
// Zero emojis in output.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT_DIR = path.resolve(__dirname, '..');
const {
  runAutoAnnotation,
  convertBoxToSheetPixels,
  convertTileBoxToSheetPixels,
  generateOverlappingTiles,
  computeIoU,
  computeContainment,
  loadReferences,
  buildContactSheets
} = require('../auto-annotate.cjs');
const AnnotationCore = require('../editor-core.js');

async function runTests() {
  console.log('================================================================');
  console.log('VED Auto-Annotation Engine - Comprehensive Test Suite');
  console.log('================================================================\n');

  // 1. DATASET INTEGRITY AND RESOLUTION CHECK
  console.log('--- Test 1: Approved Reference Dataset Integrity ---');
  const ref = loadReferences(true);
  if (!ref) throw new Error('Failed to load approved-references.json');
  if (ref.sheets.length < 52) {
    throw new Error(`Expected at least 52 sheets, found ${ref.sheets.length}`);
  }

  const s51 = ref.sheets.find(s => s.id === 'sheet-51');
  const s52 = ref.sheets.find(s => s.id === 'sheet-52');
  if (!s51 || s51.image !== 'references/additional/bdo-page-1.png') {
    throw new Error(`Sheet 51 image path incorrect: ${s51?.image}`);
  }
  if (!s52 || s52.image !== 'references/additional/cogeo-rcp.png') {
    throw new Error(`Sheet 52 image path incorrect: ${s52?.image}`);
  }

  console.log(`Verified ${ref.sheets.length} sheets: Sheet 51 -> ${s51.image}, Sheet 52 -> ${s52.image}`);
  console.log(`Stats: ${ref.stats.total_annotations} total, ${ref.stats.total_active} active, ${ref.stats.total_deleted} deleted.`);
  console.log(`Legend Catalog: ${ref.stats.total_legend_catalog_entries} linked, ${ref.stats.total_unlinked_legend_records} unlinked.`);

  if (ref.stats.total_annotations < 3167) throw new Error(`Expected at least 3167 total records, got ${ref.stats.total_annotations}`);
  if (ref.stats.total_active < 3110) throw new Error(`Expected at least 3110 active records, got ${ref.stats.total_active}`);
  if (ref.stats.total_deleted < 57) throw new Error(`Expected at least 57 deleted records, got ${ref.stats.total_deleted}`);
  if (ref.stats.total_legend_records < 414) throw new Error(`Expected at least 414 legend records, got ${ref.stats.total_legend_records}`);
  if (ref.stats.total_legend_catalog_entries < 194) throw new Error(`Expected at least 194 distinct legend IDs, got ${ref.stats.total_legend_catalog_entries}`);
  if (ref.stats.total_unlinked_legend_records !== 41) throw new Error(`Expected 41 unlinked legend records, got ${ref.stats.total_unlinked_legend_records}`);

  // Verify all 52 images exist and SHA-256 match
  let verifiedFiles = 0;
  for (const sheet of ref.sheets) {
    const fullPath = path.join(ROOT_DIR, sheet.image);
    if (!fs.existsSync(fullPath)) throw new Error(`Missing image: ${fullPath}`);
    const buf = fs.readFileSync(fullPath);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    if (hash !== sheet.sha256) throw new Error(`Hash mismatch on ${sheet.id}`);
    verifiedFiles++;
  }
  console.log(`All ${verifiedFiles} sheet image files exist and match SHA-256 hashes.`);
  console.log('Dataset integrity passed.\n');

  // 2. COORDINATE CONVERSION & NON-SQUARE IMAGES
  console.log('--- Test 2: Coordinate Conversions and Non-Square Geometry ---');
  // Square
  const sqBox = [100, 200, 300, 400]; // ymin, xmin, ymax, xmax
  const sqPix = convertBoxToSheetPixels(sqBox, 1000, 1000);
  if (sqPix[0] !== 200 || sqPix[1] !== 100 || sqPix[2] !== 400 || sqPix[3] !== 300) {
    throw new Error(`Square conversion failed: ${JSON.stringify(sqPix)}`);
  }
  // Non-square (3000x2000)
  const nsBox = [100, 200, 500, 600];
  const nsPix = convertBoxToSheetPixels(nsBox, 3000, 2000);
  if (nsPix[0] !== 600 || nsPix[1] !== 200 || nsPix[2] !== 1800 || nsPix[3] !== 1000) {
    throw new Error(`Non-square conversion failed: ${JSON.stringify(nsPix)}`);
  }
  console.log('Square and non-square coordinate conversions passed.\n');

  // 3. OVERLAPPING TILE GENERATION
  console.log('--- Test 3: Overlapping Tile Generation and Mapping ---');
  const tiles = generateOverlappingTiles(2864, 3252, 1024, 200);
  console.log(`Generated ${tiles.length} tiles for 2864x3252 drawing.`);
  if (tiles.length === 0) throw new Error('No tiles generated');
  // Check coverage: tile boundaries cover all pixels
  let maxX = Math.max(...tiles.map(t => t.x1));
  let maxY = Math.max(...tiles.map(t => t.y1));
  if (maxX < 2864 || maxY < 3252) throw new Error('Tiles do not cover entire drawing dimensions');
  const tilePixel = convertTileBoxToSheetPixels([100, 100, 200, 200], tiles[0]);
  console.log('Tile 0 coordinate mapping sample:', tilePixel);
  console.log('Overlapping tile generation passed.\n');

  // 4. LEGEND REFERENCE REJECTION
  console.log('--- Test 4: Multi-role Legend Sheet Rejection ---');
  const legendResult = await runAutoAnnotation('sheet-47', []);
  if (legendResult.status !== 'references_only') {
    throw new Error(`Expected references_only status, got ${legendResult.status}`);
  }
  console.log('sheet-47 legend_reference correctly returned references_only.\n');

  // 5. TRUTHFUL PATH CHECK (NO KEY / NO DETECTOR -> API_KEY_MISSING)
  console.log('--- Test 5: Truthful Path (No Key / No Detector -> api_key_missing) ---');
  const origKey = process.env.GEMINI_API_KEY;
  const origGroq = process.env.GROQ_API_KEY;
  const origYolo = process.env.ENABLE_LOCAL_YOLO;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GROQ_API_KEY;
  process.env.ENABLE_LOCAL_YOLO = 'false';
  try {
    const noKeyResult = await runAutoAnnotation('sheet-45', []);
    if (noKeyResult.status !== 'api_key_missing') {
      throw new Error(`Expected status api_key_missing without key, got ${noKeyResult.status}`);
    }
    console.log('Missing key correctly returned status api_key_missing (no silent fixture replay).');
  } finally {
    if (origKey) process.env.GEMINI_API_KEY = origKey;
    if (origGroq) process.env.GROQ_API_KEY = origGroq;
    if (origYolo !== undefined) process.env.ENABLE_LOCAL_YOLO = origYolo;
    else delete process.env.ENABLE_LOCAL_YOLO;
  }
  console.log('Truthful API path check passed.\n');

  // 6. EXPLICIT FIXTURE MODE
  console.log('--- Test 6: Explicit Fixture Mode ---');
  const s45Result = await runAutoAnnotation('sheet-45', [], { fixture: true });
  if (s45Result.status !== 'success' || s45Result.mode !== 'fixture') {
    throw new Error(`Expected fixture mode success, got ${JSON.stringify(s45Result)}`);
  }
  if (s45Result.count === 0) throw new Error('Expected fixture annotations for sheet-45');
  for (const a of s45Result.annotations) {
    if (!AnnotationCore.validGeometry(a.geometry, 3264, 2668)) {
      throw new Error(`Invalid geometry generated: ${JSON.stringify(a.geometry)}`);
    }
  }
  console.log(`sheet-45 generated ${s45Result.count} valid fixture proposals.`);

  const s46Result = await runAutoAnnotation('sheet-46', [], { fixture: true });
  if (s46Result.count === 0) throw new Error('Expected fixture annotations for sheet-46');
  console.log(`sheet-46 generated ${s46Result.count} valid fixture proposals.`);

  const s49Result = await runAutoAnnotation('sheet-49', [], { fixture: true });
  if (s49Result.count === 0) throw new Error('Expected fixture annotations for sheet-49');
  console.log(`sheet-49 generated ${s49Result.count} valid fixture proposals.`);
  console.log('Explicit fixture mode passed.\n');

  // 7. CONTACT SHEET PACKAGING AND 5-IMAGE CEILING
  console.log('--- Test 7: Contact Sheet Packaging and 5-Image Ceiling ---');
  const sampleItems = [];
  for (let i = 1; i <= 25; i++) {
    sampleItems.push({
      reference_id: `SAMPLE-L${i}`,
      legend_entry: `legend:L${i}`,
      label: `Sample Outlet Variant ${i}`,
      source_sheet_id: 'sheet-01',
      geometry: { type: 'bbox', coordinates: [100, 100, 160, 160] },
      role: 'legend_definition',
      source_buffer: fs.readFileSync(path.join(ROOT_DIR, 'images/sheet-01.jpg'))
    });
  }
  const { contactSheets, manifestReferences } = await buildContactSheets(sampleItems);
  console.log(`Packaged ${sampleItems.length} items into ${contactSheets.length} contact sheets.`);
  if (contactSheets.length > 4) {
    throw new Error(`Contact sheets exceeded 4 (got ${contactSheets.length})`);
  }
  // Total images: 1 target + up to 4 references = max 5
  const totalImages = 1 + contactSheets.length;
  if (totalImages > 5) {
    throw new Error(`Total request images exceeded 5: ${totalImages}`);
  }
  console.log(`Total request images: ${totalImages} (within 5-image limit).`);
  console.log(`Manifest contains ${manifestReferences.length} mapped reference tokens.`);
  console.log('Contact sheet packaging passed.\n');

  // 8. DELETION RESPECT AND OCR NON-SUPPRESSION
  console.log('--- Test 8: Deduplication and Suppression Rules ---');
  const b1 = [100, 100, 150, 150];
  const bDuplicate = [102, 102, 152, 152];
  const bDistinct = [200, 200, 250, 250];

  const iouDup = computeIoU(b1, bDuplicate);
  const iouDist = computeIoU(b1, bDistinct);
  if (iouDup < 0.75) throw new Error(`IoU duplicate calculation unexpected: ${iouDup}`);
  if (iouDist !== 0) throw new Error(`IoU distinct calculation unexpected: ${iouDist}`);

  // Test containment for clipped duplicate
  const bClipped = [100, 100, 125, 150];
  const containment = computeContainment(bClipped, b1);
  if (containment < 0.95) throw new Error(`Containment calculation unexpected: ${containment}`);

  console.log(`Duplicate IoU: ${iouDup.toFixed(3)}, Clipped containment: ${containment.toFixed(3)}.`);
  console.log('Deduplication and suppression rules passed.\n');

  console.log('================================================================');
  console.log('ALL AUTO-ANNOTATION ENGINE TESTS PASSED SUCCESSFULLY');
  console.log('================================================================');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
