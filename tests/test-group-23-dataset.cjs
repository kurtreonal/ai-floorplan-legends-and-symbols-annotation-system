// tests/test-group-23-dataset.cjs
// Verification test suite for Group 23 to 28 dataset expansion
// Strictly zero emojis.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const assert = require('assert');
const sharp = require('sharp');

const ROOT_DIR = path.resolve(__dirname, '..');

async function runTests() {
  console.log('================================================================');
  console.log('VED Group 23-28 Dataset Expansion Test Suite');
  console.log('================================================================');

  // Test 1: Browser Environment Simulation (data.js + expanded-dataset.js)
  console.log('\n--- Test 1: Simulating Browser Dataset Load ---');
  const windowContext = { window: {} };
  windowContext.window = windowContext;
  vm.createContext(windowContext);

  const dataJsPath = path.join(ROOT_DIR, 'data.js');
  const expandedJsPath = path.join(ROOT_DIR, 'expanded-dataset.js');

  assert(fs.existsSync(dataJsPath), 'data.js must exist');
  assert(fs.existsSync(expandedJsPath), 'expanded-dataset.js must exist');

  vm.runInContext(fs.readFileSync(dataJsPath, 'utf8'), windowContext);
  vm.runInContext(fs.readFileSync(expandedJsPath, 'utf8'), windowContext);

  const data = windowContext.ANNOTATION_DATA;
  assert(data, 'window.ANNOTATION_DATA must be defined');
  assert(Array.isArray(data.sheets), 'data.sheets must be an array');

  console.log(`Total sheets loaded: ${data.sheets.length}`);
  console.log(`Total groups loaded: ${data.counts.groups}`);
  console.log(`Total plans: ${data.counts.plans}`);
  console.log(`Total legend/reference sheets: ${data.counts.legend_reference_sheets}`);

  assert.strictEqual(data.sheets.length, 67, 'Expected 67 sheets (50 legacy + 2 previous expansions + 15 new)');
  assert.strictEqual(data.counts.groups, 28, 'Expected 28 groups (1 through 28)');
  assert.strictEqual(data.counts.plans, 40, 'Expected 40 plans');
  assert.strictEqual(data.counts.legend_reference_sheets, 27, 'Expected 27 legend/reference sheets');
  console.log('Dataset count assertions passed.');

  // Test 2: Group 23-28 Presence and Distribution
  console.log('\n--- Test 2: Verifying Group Distribution ---');
  const expectedGroups = {
    23: { count: 3, sheets: ['sheet-53', 'sheet-54', 'sheet-55'], legendId: 'sheet-53' },
    24: { count: 2, sheets: ['sheet-56', 'sheet-57'], legendId: 'sheet-56' },
    25: { count: 7, sheets: ['sheet-58', 'sheet-59', 'sheet-60', 'sheet-61', 'sheet-62', 'sheet-63', 'sheet-64'], legendId: 'sheet-58' },
    26: { count: 1, sheets: ['sheet-65'], legendId: 'sheet-65' },
    27: { count: 1, sheets: ['sheet-66'], legendId: 'sheet-66' },
    28: { count: 1, sheets: ['sheet-67'], legendId: 'sheet-67' }
  };

  for (const [groupNumStr, spec] of Object.entries(expectedGroups)) {
    const groupNum = Number(groupNumStr);
    const sheetsInGroup = data.sheets.filter(s => s.group === groupNum);
    assert.strictEqual(sheetsInGroup.length, spec.count, `Group ${groupNum} should have ${spec.count} sheets, found ${sheetsInGroup.length}`);
    const sheetIds = sheetsInGroup.map(s => s.id);
    for (const expectedId of spec.sheets) {
      assert(sheetIds.includes(expectedId), `Group ${groupNum} missing expected sheet ${expectedId}`);
    }

    // Verify legend association on plan sheets
    for (const sheet of sheetsInGroup) {
      if (sheet.sheet_type === 'plan') {
        assert(Array.isArray(sheet.associated_legend_ids), `${sheet.id} must have associated_legend_ids array`);
        assert(sheet.associated_legend_ids.includes(spec.legendId), `${sheet.id} should associate with legend ${spec.legendId}`);
      }
    }
    console.log(`Group ${groupNum}: verified ${spec.count} sheets (${spec.sheets.join(', ')}).`);
  }
  console.log('Group distribution assertions passed.');

  // Test 3: Asset Files, Hash Integrity, and Dimension Validation
  console.log('\n--- Test 3: Image Files, SHA-256 Hashes, and Dimensions ---');
  const newSheetIds = [
    'sheet-53', 'sheet-54', 'sheet-55', 'sheet-56', 'sheet-57',
    'sheet-58', 'sheet-59', 'sheet-60', 'sheet-61', 'sheet-62',
    'sheet-63', 'sheet-64', 'sheet-65', 'sheet-66', 'sheet-67'
  ];

  for (const sheetId of newSheetIds) {
    const sheet = data.sheets.find(s => s.id === sheetId);
    assert(sheet, `Sheet ${sheetId} must exist in data.sheets`);

    const imagePath = path.join(ROOT_DIR, sheet.image);
    assert(fs.existsSync(imagePath), `Image file missing: ${imagePath}`);

    const fileBuf = fs.readFileSync(imagePath);
    const hash = crypto.createHash('sha256').update(fileBuf).digest('hex');
    assert.strictEqual(hash, sheet.sha256, `SHA-256 mismatch for ${sheetId}: expected ${sheet.sha256}, got ${hash}`);

    const metadata = await sharp(fileBuf).metadata();
    assert.strictEqual(metadata.width, sheet.width, `Width mismatch for ${sheetId}: expected ${sheet.width}, got ${metadata.width}`);
    assert.strictEqual(metadata.height, sheet.height, `Height mismatch for ${sheetId}: expected ${sheet.height}, got ${metadata.height}`);

    console.log(`Verified ${sheetId} (${sheet.filename}): ${sheet.width}x${sheet.height}, hash ${hash.substring(0, 12)}...`);
  }
  console.log('Asset files, SHA-256 hashes, and dimensions verified successfully.');

  // Test 4: Auto-Annotation Engine Compatibility
  console.log('\n--- Test 4: Auto-Annotation Engine Compatibility ---');
  const autoAnnotate = require('../auto-annotate.cjs');
  assert(typeof autoAnnotate.runAutoAnnotation === 'function', 'runAutoAnnotation must be exported');

  // Legend reference sheet should reject annotation request with references_only
  const legendResult = await autoAnnotate.runAutoAnnotation('sheet-53');
  assert.strictEqual(legendResult.status, 'references_only', `Expected references_only for sheet-53, got ${legendResult.status}`);
  console.log('Legend reference sheet sheet-53 correctly returned status: references_only.');

  // Plan sheet sheet-54 lookup test in fixture mode (prevents unnecessary external API calls/tokens)
  const planResult = await autoAnnotate.runAutoAnnotation('sheet-54', [], { fixture: true });
  assert(planResult.sheet_id === 'sheet-54', 'Result must match requested sheet_id');
  assert.strictEqual(planResult.status, 'success', `Expected success in fixture mode, got ${planResult.status}`);
  console.log(`Plan sheet sheet-54 resolved in engine with status: ${planResult.status}.`);

  console.log('\n================================================================');
  console.log('ALL GROUP 23-28 DATASET TESTS PASSED SUCCESSFULLY');
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
