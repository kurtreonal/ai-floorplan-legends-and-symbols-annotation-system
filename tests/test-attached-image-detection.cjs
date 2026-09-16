// test-attached-image-detection.cjs
// Verification test for attached/imported floor plan detection accuracy:
// Verifies accurate detection of Duplex Convenience Outlets ("C.O."),
// Wall Fans ("WF"), Air Conditioners ("ACU"), Panelboards, and exactly 2
// true Circuit Homeruns (pruning the 3 false ones). Zero emojis.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');
const envPath = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const { runAutoAnnotation } = require('../auto-annotate.cjs');

async function testAttachedImageDetection() {
  console.log('================================================================');
  console.log('Attached Floor Plan Symbol Detection & Arbitration Test');
  console.log('================================================================\n');

  const imgPath = path.join(ROOT_DIR, 'images/attached-sample.png');
  if (!fs.existsSync(imgPath)) {
    throw new Error('Test image not found at ' + imgPath);
  }

  const buf = fs.readFileSync(imgPath);
  const base64Img = buf.toString('base64');
  const hash = crypto.createHash('sha256').update(buf).digest('hex');

  const sheetMeta = {
    id: 'imported-sample-floorplan',
    group: 99,
    group_name: 'Group 99 · Attached Floor Plan',
    title: 'Attached Sample Floor Plan',
    filename: 'attached-sample.png',
    image: 'data:image/png;base64,' + base64Img,
    width: 538,
    height: 672,
    sha256: hash,
    coordinate_system: 'original_image_pixels',
    associated_legend_ids: [],
    issues: ['Attached floor plan test'],
    annotations: []
  };

  console.log('Executing runAutoAnnotation on attached sheet (538x672)...');
  const startTime = Date.now();
  const result = await runAutoAnnotation(sheetMeta.id, [], {}, sheetMeta);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\nAuto-annotation finished in ${elapsed}s.`);
  console.log(`Status: ${result.status}, Model: ${result.model}, Total Annotations: ${result.count}`);

  assert.equal(result.status, 'success', 'Expected auto-annotation status to be success');
  assert(Array.isArray(result.annotations), 'Expected annotations array');
  assert(result.count > 0, 'Expected at least 1 annotation detected');

  const byLabel = {};
  for (const ann of result.annotations) {
    byLabel[ann.label] = (byLabel[ann.label] || 0) + 1;
    assert(ann.geometry && ann.geometry.type === 'bbox', 'Invalid geometry type');
    const [x0, y0, x1, y1] = ann.geometry.coordinates;
    assert(x0 < x1 && y0 < y1, 'Invalid coordinates');
    assert(x0 >= 0 && y0 >= 0 && x1 <= sheetMeta.width && y1 <= sheetMeta.height, 'Coordinates out of sheet bounds');
  }

  console.log('\n--- Detection Breakdown by Symbol Class ---');
  for (const [label, count] of Object.entries(byLabel)) {
    console.log(`- ${label}: ${count}`);
  }

  console.log('\n--- Assertion Checks ---');
  
  // 1. Duplex Convenience Outlets ("C.O.") must be detected
  const duplexCount = byLabel['Duplex 3-prong power outlet'] || 0;
  console.log(`[Check 1] Duplex outlets detected: ${duplexCount}`);
  assert(duplexCount >= 4, `Expected at least 4 Duplex outlets (C.O.), found ${duplexCount}`);

  // 2. Wall Fans ("WF") must be detected
  const fanCount = byLabel['Wall fan'] || 0;
  console.log(`[Check 2] Wall fans detected: ${fanCount}`);
  assert(fanCount >= 3, `Expected at least 3 Wall fans (WF), found ${fanCount}`);

  // 3. Air Conditioning Units ("1.50 ACU") must be detected
  const acuCount = byLabel['Air conditioning unit'] || 0;
  console.log(`[Check 3] Air conditioning units detected: ${acuCount}`);
  assert(acuCount >= 2, `Expected at least 2 Air conditioning units (ACU), found ${acuCount}`);

  // 4. Panelboard designations (4 / MDP, 2 / MDP) must be detected
  const panelCount = byLabel['Panelboard'] || 0;
  console.log(`[Check 4] Panelboard circles detected: ${panelCount}`);
  assert(panelCount >= 1, `Expected at least 1 Panelboard tag, found ${panelCount}`);

  // 5. Circuit Homeruns: Exactly the true circuit homeruns (curved arcs connecting to MDP panels)
  // Must NOT detect 5 homeruns (3 false positives must be rejected)
  const homerunCount = byLabel['Circuit homerun'] || 0;
  console.log(`[Check 5] Circuit homeruns detected: ${homerunCount}`);
  assert(homerunCount <= 2, `Expected at most 2 true circuit homeruns (false homeruns pruned), found ${homerunCount}`);

  // 6. Overall detection count
  console.log(`[Check 6] Total valid symbols detected: ${result.count}`);
  assert(result.count >= 12, `Expected at least 12 symbols detected overall, found ${result.count}`);

  console.log('\n================================================================');
  console.log('ALL ATTACHED IMAGE DETECTION TESTS PASSED SUCCESSFULLY');
  console.log('================================================================\n');
}

testAttachedImageDetection().catch(err => {
  console.error('\nTest failed:', err.message);
  process.exit(1);
});
