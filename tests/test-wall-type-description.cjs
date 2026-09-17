// tests/test-wall-type-description.cjs
// Automated CDP verification of wall type descriptions and automatic labeling.
// Strictly zero emojis.

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const PORT = 9229;
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_DIR = path.resolve('.temp/cdp-test-wall-types');

fs.mkdirSync(TEMP_DIR, { recursive: true });

const chrome = spawn(CHROME_PATH, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${TEMP_DIR}`,
  '--window-size=1600,1200',
  'http://127.0.0.1:3000/'
]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
    this.ws.onmessage = msg => {
      const parsed = JSON.parse(msg.data);
      if (parsed.id && this.callbacks.has(parsed.id)) {
        const { resolve, reject } = this.callbacks.get(parsed.id);
        this.callbacks.delete(parsed.id);
        if (parsed.error) reject(new Error(parsed.error.message));
        else resolve(parsed.result);
      }
    };
  }

  async send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = this.id++;
      this.callbacks.set(msgId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error('Eval failed: ' + JSON.stringify(res.exceptionDetails));
    }
    return res.result.value;
  }
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function run() {
  try {
    let targets = null;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      try {
        targets = await fetchJSON(`http://127.0.0.1:${PORT}/json/list`);
        if (targets && targets.length > 0) break;
      } catch {}
    }

    if (!targets || !targets.length) {
      throw new Error('Failed to connect to Chrome remote debugging port.');
    }

    const pageTarget = targets.find(t => t.type === 'page');
    console.log('Connecting to Chrome...');
    const client = new CDPClient(pageTarget.webSocketDebuggerUrl);

    await new Promise((resolve, reject) => {
      client.ws.onopen = resolve;
      client.ws.onerror = reject;
    });

    console.log('Waiting for application page load...');
    await sleep(2000);

    // Check 1: Verify wall type UI rendered in DOM
    const uiCheck = await client.eval(`(() => {
      const select = document.getElementById('edit-wall-type');
      const descBox = document.getElementById('wall-type-desc');
      const chipsHost = document.getElementById('wall-type-chips');
      const chips = Array.from(document.querySelectorAll('.wall-type-chip')).map(c => ({
        key: c.dataset.key,
        title: c.querySelector('.wall-type-chip-title')?.textContent?.trim(),
        desc: c.querySelector('.wall-type-chip-desc')?.textContent?.trim()
      }));
      return {
        hasSelect: Boolean(select),
        selectOptionsCount: select?.options?.length,
        hasDescBox: Boolean(descBox),
        chipsCount: chips.length,
        chips
      };
    })()`);

    console.log('\n--- Wall Type UI Check ---');
    console.log('UI elements:', JSON.stringify(uiCheck, null, 2));
    assert.strictEqual(uiCheck.hasSelect, true, 'Must have #edit-wall-type');
    assert.strictEqual(uiCheck.hasDescBox, true, 'Must have #wall-type-desc');
    assert.strictEqual(uiCheck.chipsCount, 7, 'Must have 7 wall type quick-select chips');

    // Check 2: Load sheet-02 which has standard wall geometry annotations
    console.log('\n--- Testing Wall Selection on sheet-02 ---');
    await client.eval(`(() => {
      document.getElementById('group').value = '1';
      document.getElementById('group').dispatchEvent(new Event('change'));
      document.getElementById('sheet').value = 'sheet-02';
      document.getElementById('sheet').dispatchEvent(new Event('change'));
    })()`);
    await sleep(1200);

    const sheetCheck = await client.eval(`(() => {
      const ws = window.reviewWorkspace;
      const cur = ws.getCurrent();
      const geomAnn = cur.annotations.find(a => a.layer === 'geometry');
      if (geomAnn) {
        ws.choose(geomAnn.id);
      }
      const selected = ws.getSelected();
      const fieldVisible = !document.getElementById('wall-type-field').hidden;
      return {
        sheetId: cur.id,
        selectedId: selected?.id,
        selectedLayer: selected?.layer,
        selectedLabel: selected?.label,
        selectedWallType: selected?.wall_type,
        fieldVisible
      };
    })()`);
    console.log('Sheet-02 selected wall:', JSON.stringify(sheetCheck, null, 2));
    assert.strictEqual(sheetCheck.fieldVisible, true, 'Wall type field must be visible for geometry annotations');

    // Check 3: Click "Glass wall / partition" chip
    console.log('\n--- Clicking "Glass wall / partition" chip ---');
    const clickGlassResult = await client.eval(`(() => {
      const chip = document.querySelector('.wall-type-chip[data-key="glass"]');
      if (chip) chip.click();
      const ws = window.reviewWorkspace;
      const sel = ws.getSelected();
      const labelInput = document.getElementById('edit-label').value;
      const selectVal = document.getElementById('edit-wall-type').value;
      const descText = document.getElementById('wall-type-desc').textContent;
      const isChipActive = chip.classList.contains('active');
      const stage = ws.getStage();
      const lineNode = stage?.findOne(n => n.name() === 'annotation' && n.getAttr('annotationId') === sel.id);
      const lineStroke = lineNode?.stroke();
      return {
        clickedKey: 'glass',
        isChipActive,
        selectVal,
        labelInput,
        descText,
        lineStroke,
        annotationWallType: sel?.wall_type,
        annotationLabel: sel?.label,
        annotationNote: sel?.note
      };
    })()`);
    console.log('Glass wall click result:', JSON.stringify(clickGlassResult, null, 2));
    assert.strictEqual(clickGlassResult.isChipActive, true, 'Glass chip must be marked active');
    assert.strictEqual(clickGlassResult.selectVal, 'glass', 'Select value must be glass');
    assert.strictEqual(clickGlassResult.annotationWallType, 'glass', 'Annotation wall_type must be updated to glass');
    assert.strictEqual(clickGlassResult.lineStroke, '#06b6d4', 'Line stroke must change to glass cyan #06b6d4');
    assert(clickGlassResult.labelInput.includes('Glass wall / partition'), 'Label input must include Glass wall title');
    assert(clickGlassResult.labelInput.includes('glazed partition') || clickGlassResult.labelInput.includes('architectural glass'), 'Label input must include architectural description');
    assert.strictEqual(clickGlassResult.annotationLabel, clickGlassResult.labelInput, 'Annotation label must match edit-label input');
    assert(clickGlassResult.annotationNote.includes('glazed') || clickGlassResult.annotationNote.includes('glass'), 'Annotation note must store architectural description');

    // Check 4: Click "Fire-rated wall" chip
    console.log('\n--- Clicking "Fire-rated wall" chip ---');
    const clickFireResult = await client.eval(`(() => {
      const chip = document.querySelector('.wall-type-chip[data-key="fire_rated"]');
      if (chip) chip.click();
      const ws = window.reviewWorkspace;
      const sel = ws.getSelected();
      const labelInput = document.getElementById('edit-label').value;
      const selectVal = document.getElementById('edit-wall-type').value;
      const isFireActive = chip.classList.contains('active');
      const isGlassActive = document.querySelector('.wall-type-chip[data-key="glass"]').classList.contains('active');
      const lineNode = ws.getStage()?.findOne(n => n.name() === 'annotation' && n.getAttr('annotationId') === sel.id);
      const lineStroke = lineNode?.stroke();
      return {
        clickedKey: 'fire_rated',
        isFireActive,
        isGlassActive,
        selectVal,
        labelInput,
        lineStroke,
        annotationWallType: sel?.wall_type,
        annotationLabel: sel?.label,
        annotationNote: sel?.note
      };
    })()`);
    console.log('Fire-rated wall click result:', JSON.stringify(clickFireResult, null, 2));
    assert.strictEqual(clickFireResult.isFireActive, true, 'Fire rated chip must be marked active');
    assert.strictEqual(clickFireResult.isGlassActive, false, 'Glass chip must no longer be active');
    assert.strictEqual(clickFireResult.selectVal, 'fire_rated', 'Select value must be fire_rated');
    assert.strictEqual(clickFireResult.annotationWallType, 'fire_rated', 'Annotation wall_type must be fire_rated');
    assert.strictEqual(clickFireResult.lineStroke, '#ef4444', 'Line stroke must change to fire-rated red #ef4444');
    assert(clickFireResult.labelInput.includes('Fire-rated wall'), 'Label must include Fire-rated wall');
    assert(clickFireResult.labelInput.includes('smoke barrier') || clickFireResult.labelInput.includes('fire-resistive'), 'Label must include fire description');

    // Check 5: Dropdown change triggers automatic description and label assignment
    console.log('\n--- Testing Dropdown selection: curtain_wall ---');
    const dropdownResult = await client.eval(`(() => {
      const select = document.getElementById('edit-wall-type');
      select.value = 'curtain_wall';
      select.dispatchEvent(new Event('change'));
      const ws = window.reviewWorkspace;
      const sel = ws.getSelected();
      const chip = document.querySelector('.wall-type-chip[data-key="curtain_wall"]');
      const lineNode = ws.getStage()?.findOne(n => n.name() === 'annotation' && n.getAttr('annotationId') === sel.id);
      const lineStroke = lineNode?.stroke();
      return {
        selectVal: select.value,
        isChipActive: chip.classList.contains('active'),
        labelInput: document.getElementById('edit-label').value,
        lineStroke,
        annotationWallType: sel?.wall_type,
        annotationLabel: sel?.label,
        annotationNote: sel?.note
      };
    })()`);
    console.log('Dropdown change result:', JSON.stringify(dropdownResult, null, 2));
    assert.strictEqual(dropdownResult.annotationWallType, 'curtain_wall', 'Annotation wall_type must be curtain_wall');
    assert.strictEqual(dropdownResult.isChipActive, true, 'Curtain wall chip must be active');
    assert.strictEqual(dropdownResult.lineStroke, '#0ea5e9', 'Line stroke must change to curtain wall sky blue #0ea5e9');
    assert(dropdownResult.annotationLabel.includes('Curtain wall'), 'Annotation label must be updated with Curtain wall description');

    // Check 6: Click Opening / doorway (no wall)
    console.log('\n--- Clicking "Opening / doorway (no wall)" chip ---');
    const clickOpeningResult = await client.eval(`(() => {
      const chip = document.querySelector('.wall-type-chip[data-key="opening"]');
      if (chip) chip.click();
      const ws = window.reviewWorkspace;
      const sel = ws.getSelected();
      const lineNode = ws.getStage()?.findOne(n => n.name() === 'annotation' && n.getAttr('annotationId') === sel.id);
      return {
        clickedKey: 'opening',
        selectVal: document.getElementById('edit-wall-type').value,
        lineStroke: lineNode?.stroke(),
        annotationWallType: sel?.wall_type
      };
    })()`);
    console.log('Opening click result:', JSON.stringify(clickOpeningResult, null, 2));
    assert.strictEqual(clickOpeningResult.selectVal, 'opening');
    assert.strictEqual(clickOpeningResult.annotationWallType, 'opening');
    assert.strictEqual(clickOpeningResult.lineStroke, '#f59e0b', 'Line stroke must change to opening amber #f59e0b');

    // Check 7: Verify all remaining wall types: partition, standard, other
    for (const [key, expectedColor] of [
      ['partition', '#8b5cf6'],
      ['standard', '#3b82f6'],
      ['other', '#64748b']
    ]) {
      console.log(`\n--- Clicking "${key}" chip ---`);
      const testRes = await client.eval(`(() => {
        const chip = document.querySelector('.wall-type-chip[data-key="${key}"]');
        if (chip) chip.click();
        const ws = window.reviewWorkspace;
        const sel = ws.getSelected();
        const lineNode = ws.getStage()?.findOne(n => n.name() === 'annotation' && n.getAttr('annotationId') === sel.id);
        return {
          wallType: sel?.wall_type,
          stroke: lineNode?.stroke()
        };
      })()`);
      console.log(`${key} result:`, JSON.stringify(testRes));
      assert.strictEqual(testRes.wallType, key, `Wall type must be ${key}`);
      assert.strictEqual(testRes.stroke, expectedColor, `Line stroke for ${key} must be ${expectedColor}`);
    }

    // Select "opening" and capture in dark mode to verify against user view
    await client.eval(`(() => {
      document.querySelector('.wall-type-chip[data-key="opening"]')?.click();
      document.documentElement.setAttribute('data-theme', 'dark');
    })()`);

    // Take screenshots
    const shotDark = await client.send('Page.captureScreenshot', { format: 'png' });
    const shotDarkPath = path.resolve('.temp/test-wall-type-dark.png');
    fs.writeFileSync(shotDarkPath, Buffer.from(shotDark.data, 'base64'));
    console.log('Saved dark verification screenshot:', shotDarkPath);

    const shot = await client.send('Page.captureScreenshot', { format: 'png' });
    const shotPath = path.resolve('.temp/test-wall-type-description.png');
    fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
    console.log('Saved verification screenshot:', shotPath);

    console.log('\n================================================================');
    console.log('ALL TESTS FOR WALL TYPE DESCRIPTION & AUTO-LABELING PASSED!');
    console.log('================================================================\n');
  } finally {
    chrome.kill('SIGTERM');
  }
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
