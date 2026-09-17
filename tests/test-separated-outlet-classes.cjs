// tests/test-separated-outlet-classes.cjs
// Verifies separation of single/duplex outlet classes and normal/UPS power convenience outlets
// Strictly zero emojis.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function runTests(workspaceDir) {
  console.log('Testing outlet class separation in:', workspaceDir);

  const context = { window: {} };
  context.window = context;
  vm.createContext(context);

  const load = (f) => vm.runInContext(fs.readFileSync(path.join(workspaceDir, f), 'utf8'), context);
  load('data.js');
  load('expanded-dataset.js');
  load('reference-library.js');
  load('outlet-class-upgrades.js');

  const d = context.ANNOTATION_DATA;
  assert(d, 'ANNOTATION_DATA must be defined');

  // 1. Group 12 (sheet-32)
  const s32 = d.sheets.find(x => x.id === 'sheet-32');
  assert(s32, 'sheet-32 must exist');
  const s32Active = s32.annotations.filter(a => a.layer === 'legend' && a.review_state !== 'deleted');
  const s32Entries = s32Active.map(a => a.legend_entry);
  assert(s32Entries.includes('sheet-32:L01S'), 'sheet-32 must contain sheet-32:L01S');
  assert(s32Entries.includes('sheet-32:L01D'), 'sheet-32 must contain sheet-32:L01D');
  assert(s32Entries.includes('sheet-32:L02S'), 'sheet-32 must contain sheet-32:L02S');
  assert(s32Entries.includes('sheet-32:L02D'), 'sheet-32 must contain sheet-32:L02D');
  assert(!s32Entries.includes('sheet-32:L01'), 'sheet-32 must NOT have active combined L01');
  assert(!s32Entries.includes('sheet-32:L02'), 'sheet-32 must NOT have active combined L02');
  console.log('Group 12 legend separation verified.');

  // Group 12 plan (sheet-31)
  const s31 = d.sheets.find(x => x.id === 'sheet-31');
  assert(s31, 'sheet-31 must exist');
  const s31Syms = s31.annotations.filter(a => a.layer === 'symbols');
  assert.strictEqual(s31Syms.length, 48, 'sheet-31 must have 48 symbols');
  assert(s31Syms.every(a => a.legend_entry === 'sheet-32:L02S'), 'All 48 symbols on sheet-31 must map to sheet-32:L02S');
  console.log('Group 12 plan (sheet-31) annotations verified.');

  // 2. Group 13 (sheet-34)
  const s34 = d.sheets.find(x => x.id === 'sheet-34');
  assert(s34, 'sheet-34 must exist');
  const s34Active = s34.annotations.filter(a => a.layer === 'legend' && a.review_state !== 'deleted');
  const s34Entries = s34Active.map(a => a.legend_entry);
  assert(s34Entries.includes('sheet-34:L16S'), 'sheet-34 must contain sheet-34:L16S');
  assert(s34Entries.includes('sheet-34:L16D'), 'sheet-34 must contain sheet-34:L16D');
  assert(s34Entries.includes('sheet-34:L17S'), 'sheet-34 must contain sheet-34:L17S');
  assert(s34Entries.includes('sheet-34:L17D'), 'sheet-34 must contain sheet-34:L17D');
  assert(!s34Entries.includes('sheet-34:L16'), 'sheet-34 must NOT have active combined L16');
  assert(!s34Entries.includes('sheet-34:L17'), 'sheet-34 must NOT have active combined L17');
  console.log('Group 13 legend separation verified.');

  // Group 13 plan (sheet-33)
  const s33 = d.sheets.find(x => x.id === 'sheet-33');
  assert(s33, 'sheet-33 must exist');
  const s33Voice = s33.annotations.filter(a => a.layer === 'symbols' && a.legend_entry === 'sheet-34:L16S');
  const s33Data = s33.annotations.filter(a => a.layer === 'symbols' && a.legend_entry === 'sheet-34:L17S');
  assert.strictEqual(s33Voice.length, 7, 'sheet-33 must have 7 voice symbols');
  assert.strictEqual(s33Data.length, 5, 'sheet-33 must have 5 data symbols');
  console.log('Group 13 plan (sheet-33) voice/data distinction verified.');

  // 3. Group 15 (sheet-37)
  const s37 = d.sheets.find(x => x.id === 'sheet-37');
  assert(s37, 'sheet-37 must exist');
  const s37Active = s37.annotations.filter(a => a.layer === 'legend' && a.review_state !== 'deleted');
  const s37Entries = s37Active.map(a => a.legend_entry);
  assert(s37Entries.includes('sheet-37:L01S'), 'sheet-37 must contain sheet-37:L01S');
  assert(s37Entries.includes('sheet-37:L01D'), 'sheet-37 must contain sheet-37:L01D');
  assert(s37Entries.includes('sheet-37:L02S'), 'sheet-37 must contain sheet-37:L02S');
  assert(s37Entries.includes('sheet-37:L02D'), 'sheet-37 must contain sheet-37:L02D');
  assert(!s37Entries.includes('sheet-37:L01'), 'sheet-37 must NOT have active combined L01');
  assert(!s37Entries.includes('sheet-37:L02'), 'sheet-37 must NOT have active combined L02');
  console.log('Group 15 legend separation verified.');

  // Group 15 plan (sheet-38)
  const s38 = d.sheets.find(x => x.id === 'sheet-38');
  assert(s38, 'sheet-38 must exist');
  const s38Voice = s38.annotations.filter(a => a.layer === 'symbols' && a.legend_entry === 'sheet-37:L01S');
  const s38Data = s38.annotations.filter(a => a.layer === 'symbols' && (a.legend_entry === 'sheet-37:L02S' || a.legend_entry === 'sheet-37:L02D'));
  assert(s38Voice.length > 0, 'sheet-38 must have separated voice outlet annotations');
  assert(s38Data.length > 0, 'sheet-38 must have separated data outlet annotations');
  console.log(`Group 15 plan (sheet-38) separated into ${s38Data.length} data and ${s38Voice.length} voice symbols.`);

  // 4. Group 21 BDO Cubao (sheet-51)
  const s51 = d.sheets.find(x => x.id === 'sheet-51');
  assert(s51, 'sheet-51 must exist');
  const s51Active = s51.annotations.filter(a => a.layer === 'legend' && a.review_state !== 'deleted');
  const s51Entries = s51Active.map(a => a.legend_entry);
  assert(s51Entries.includes('sheet-51:L01N'), 'sheet-51 must contain sheet-51:L01N');
  assert(s51Entries.includes('sheet-51:L01U'), 'sheet-51 must contain sheet-51:L01U');
  assert(!s51Entries.includes('sheet-51:L01'), 'sheet-51 must NOT have active combined L01');
  
  // Verify plan annotations on sheet-51
  const s51NormalOutlets = s51.annotations.filter(a => a.layer === 'symbols' && a.legend_entry === 'sheet-51:L01N');
  const s51UpsOutlets = s51.annotations.filter(a => a.layer === 'symbols' && a.legend_entry === 'sheet-51:L01U');
  assert(s51NormalOutlets.length >= 11, 'sheet-51 must have at least 11 Normal power convenience outlets annotated');
  assert(s51UpsOutlets.length >= 11, 'sheet-51 must have at least 11 UPS power convenience outlets annotated');
  console.log(`Group 21 (sheet-51) convenience outlets verified: ${s51NormalOutlets.length} Normal, ${s51UpsOutlets.length} UPS.`);

  // 5. Reference crops verification
  const expectedCrops = [
    'sheet-32-L01-single.png', 'sheet-32-L01-duplex.png',
    'sheet-32-L02-single.png', 'sheet-32-L02-duplex.png',
    'sheet-34-L16-single.png', 'sheet-34-L16-duplex.png',
    'sheet-34-L17-single.png', 'sheet-34-L17-duplex.png',
    'sheet-37-L01-single.png', 'sheet-37-L01-duplex.png',
    'sheet-37-L02-single.png', 'sheet-37-L02-duplex.png',
    'sheet-51-L01-normal.png', 'sheet-51-L01-ups.png'
  ];

  for (const crop of expectedCrops) {
    const cropPath = path.join(workspaceDir, 'references', 'split-outlets', crop);
    assert(fs.existsSync(cropPath), `Reference crop must exist: ${crop}`);
    const stat = fs.statSync(cropPath);
    assert(stat.size > 100, `Crop ${crop} must not be empty (size: ${stat.size})`);
  }
  console.log(`All ${expectedCrops.length} reference crops verified on disk.`);

  // 6. Reference library entries
  const lib = context.REFERENCE_LIBRARY;
  assert(lib && Array.isArray(lib.entries), 'REFERENCE_LIBRARY.entries must be an array');
  for (const def of context.OUTLET_CLASS_UPGRADES.definitions) {
    const entry = lib.entries.find(e => e.id === def.id);
    assert(entry, `Reference library must contain entry for ${def.id}`);
    assert.strictEqual(entry.label, def.label, `Label mismatch for ${def.id}`);
  }
  console.log('Reference library entries verified.');

  // 7. Legends Tab simulation (workspace-ui.js)
  for (const sheetId of ['sheet-32', 'sheet-34', 'sheet-37', 'sheet-51']) {
    const sheet = d.sheets.find(x => x.id === sheetId);
    const legendCards = (sheet.annotations || []).filter(a => a.layer === 'legend' && a.review_state !== 'deleted');
    assert(legendCards.length > 0, `Legends tab for ${sheetId} must render cards`);
    const entries = legendCards.map(a => a.legend_entry);
    if (sheetId === 'sheet-32') {
      assert(entries.includes('sheet-32:L01S') && entries.includes('sheet-32:L01D'));
      assert(entries.includes('sheet-32:L02S') && entries.includes('sheet-32:L02D'));
    } else if (sheetId === 'sheet-34') {
      assert(entries.includes('sheet-34:L16S') && entries.includes('sheet-34:L16D'));
      assert(entries.includes('sheet-34:L17S') && entries.includes('sheet-34:L17D'));
    } else if (sheetId === 'sheet-37') {
      assert(entries.includes('sheet-37:L01S') && entries.includes('sheet-37:L01D'));
      assert(entries.includes('sheet-37:L02S') && entries.includes('sheet-37:L02D'));
    } else if (sheetId === 'sheet-51') {
      assert(entries.includes('sheet-51:L01N') && entries.includes('sheet-51:L01U'));
    }
  }
  console.log('Legends tab cards simulation: PASSED for all sheets.');

  // 8. Class dropdown mapping simulation (review.js populateLegendDropdowns)
  const legendMap = new Map();
  for (const s of (d.sheets || [])) {
    for (const a of (s.annotations || []).filter(x => x.layer === 'legend' && x.legend_entry && x.review_state !== 'deleted')) {
      if (!legendMap.has(a.legend_entry)) {
        legendMap.set(a.legend_entry, { legend_entry: a.legend_entry, label: a.label || a.legend_entry });
      }
    }
  }

  const dropdownEntries = [...legendMap.keys()];
  assert(dropdownEntries.includes('sheet-32:L01S'), '#edit-class must include sheet-32:L01S');
  assert(dropdownEntries.includes('sheet-32:L01D'), '#edit-class must include sheet-32:L01D');
  assert(dropdownEntries.includes('sheet-32:L02S'), '#edit-class must include sheet-32:L02S');
  assert(dropdownEntries.includes('sheet-32:L02D'), '#edit-class must include sheet-32:L02D');
  assert(dropdownEntries.includes('sheet-34:L16S'), '#edit-class must include sheet-34:L16S');
  assert(dropdownEntries.includes('sheet-34:L16D'), '#edit-class must include sheet-34:L16D');
  assert(dropdownEntries.includes('sheet-34:L17S'), '#edit-class must include sheet-34:L17S');
  assert(dropdownEntries.includes('sheet-34:L17D'), '#edit-class must include sheet-34:L17D');
  assert(dropdownEntries.includes('sheet-37:L01S'), '#edit-class must include sheet-37:L01S');
  assert(dropdownEntries.includes('sheet-37:L01D'), '#edit-class must include sheet-37:L01D');
  assert(dropdownEntries.includes('sheet-37:L02S'), '#edit-class must include sheet-37:L02S');
  assert(dropdownEntries.includes('sheet-37:L02D'), '#edit-class must include sheet-37:L02D');
  assert(dropdownEntries.includes('sheet-51:L01N'), '#edit-class must include sheet-51:L01N');
  assert(dropdownEntries.includes('sheet-51:L01U'), '#edit-class must include sheet-51:L01U');
  assert(!dropdownEntries.includes('sheet-32:L01'), '#edit-class must NOT include retired sheet-32:L01');
  assert(!dropdownEntries.includes('sheet-32:L02'), '#edit-class must NOT include retired sheet-32:L02');
  assert(!dropdownEntries.includes('sheet-34:L16'), '#edit-class must NOT include retired sheet-34:L16');
  assert(!dropdownEntries.includes('sheet-34:L17'), '#edit-class must NOT include retired sheet-34:L17');
  assert(!dropdownEntries.includes('sheet-37:L01'), '#edit-class must NOT include retired sheet-37:L01');
  assert(!dropdownEntries.includes('sheet-37:L02'), '#edit-class must NOT include retired sheet-37:L02');
  assert(!dropdownEntries.includes('sheet-51:L01'), '#edit-class must NOT include retired sheet-51:L01');
  console.log('#edit-class dropdown classes verified: all 14 new separate classes present, retired combined classes excluded.');

  console.log(`Outlet class separation verification in ${workspaceDir}: ALL PASSED.`);
}

runTests(path.resolve(__dirname, '..'));

const docDir = 'c:\\Users\\kupal\\Documents\\VED-floor-plan-review-portable';
if (fs.existsSync(docDir) && fs.existsSync(path.join(docDir, 'outlet-class-upgrades.js'))) {
  runTests(docDir);
}
