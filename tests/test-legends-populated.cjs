// tests/test-legends-populated.cjs
// Verifies that newly added floorplan legends are populated in the legend index and workspace UI
// Strictly zero emojis.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');

function testWorkspaceLegends(workspaceDir) {
  console.log('Testing workspace:', workspaceDir);
  const dataJs = path.join(workspaceDir, 'data.js');
  const expJs = path.join(workspaceDir, 'expanded-dataset.js');

  assert(fs.existsSync(dataJs), 'data.js must exist');
  assert(fs.existsSync(expJs), 'expanded-dataset.js must exist');

  const context = { window: {} };
  context.window = context;
  vm.createContext(context);

  vm.runInContext(fs.readFileSync(dataJs, 'utf8'), context);
  vm.runInContext(fs.readFileSync(expJs, 'utf8'), context);

  const d = context.ANNOTATION_DATA;
  assert(d, 'window.ANNOTATION_DATA must be defined');

  const legendSheetIds = ['sheet-53', 'sheet-56', 'sheet-58', 'sheet-65', 'sheet-66', 'sheet-67'];

  for (const sheetId of legendSheetIds) {
    const s = d.sheets.find(x => x.id === sheetId);
    assert(s, `Sheet ${sheetId} must exist`);
    assert(Array.isArray(s.annotations), `${sheetId} annotations must be an array`);

    const legendAnnotations = s.annotations.filter(a => a.layer === 'legend' && a.review_state !== 'deleted');
    console.log(`${sheetId} (${s.filename}): ${legendAnnotations.length} legend annotations found.`);
    assert(legendAnnotations.length > 0, `Sheet ${sheetId} MUST have at least 1 legend annotation! Found: ${legendAnnotations.length}`);

    for (const a of legendAnnotations) {
      assert(a.label, `${sheetId} annotation ${a.id} must have a label`);
      assert(a.legend_entry, `${sheetId} annotation ${a.id} must have a legend_entry`);
      assert(a.geometry && a.geometry.type === 'bbox', `${sheetId} annotation ${a.id} must have a bbox geometry`);
      const [x1, y1, x2, y2] = a.geometry.coordinates;
      assert(x1 >= 0 && x2 <= s.width && x1 < x2, `Invalid x coordinates in ${a.id}: [${x1}, ${x2}] on sheet width ${s.width}`);
      assert(y1 >= 0 && y2 <= s.height && y1 < y2, `Invalid y coordinates in ${a.id}: [${y1}, ${y2}] on sheet height ${s.height}`);
    }
  }

  // Simulate workspace-ui.js show(s) logic for sheet-67 (Group 28)
  const sheet67 = d.sheets.find(x => x.id === 'sheet-67');
  assert(sheet67, 'sheet-67 must exist');

  const associatedIds = Array.isArray(sheet67.associated_legend_ids) ? sheet67.associated_legend_ids : [];
  const targetSheets = [sheet67, ...(d.sheets || []).filter(x => associatedIds.includes(x.id) && x.id !== sheet67.id)];
  const cards = [];
  for (const source of targetSheets) {
    for (const a of (source.annotations || []).filter(a => a.layer === 'legend' && a.review_state !== 'deleted')) {
      cards.push({ label: a.label, entry: a.legend_entry, coordinates: a.geometry.coordinates });
    }
  }

  console.log(`Simulation of Legends tab for sheet-67 (Group 28): rendered ${cards.length} legend cards.`);
  assert(cards.length > 0, 'Legends tab for sheet-67 must render at least 1 legend card (cannot show "No embedded/associated legend indexed")');

  console.log(`Workspace ${workspaceDir} legends verification: PASSED.`);
}

testWorkspaceLegends(path.resolve(__dirname, '..'));

const docDir = 'c:\\Users\\kupal\\Documents\\VED-floor-plan-review-portable';
if (fs.existsSync(docDir)) {
  testWorkspaceLegends(docDir);
}
console.log('ALL LEGEND VERIFICATION TESTS COMPLETED SUCCESSFULLY.');
