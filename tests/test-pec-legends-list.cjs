// tests/test-pec-legends-list.cjs
// Automated verification that Philippine Electrical Code (PEC) legend sources
// are included in the universal legend catalog (Legends tab, #own-legend-entries,
// window.legendList, and #edit-class dropdown) with proper preview crops and metadata.
// Strictly zero emojis.

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const PORT = 9235;
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_DIR = path.resolve('.temp/cdp-test-pec-legends');

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
    return res.result ? res.result.value : undefined;
  }

  async screenshot(filePath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(filePath, Buffer.from(res.data, 'base64'));
    console.log('Saved screenshot:', filePath);
  }
}

async function getDebuggerUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const data = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${PORT}/json`, res => {
          let buf = '';
          res.on('data', chunk => (buf += chunk));
          res.on('end', () => resolve(buf));
        }).on('error', reject);
      });
      const list = JSON.parse(data);
      const target = list.find(t => t.type === 'page');
      if (target && target.webSocketDebuggerUrl) return target.webSocketDebuggerUrl;
    } catch (e) {}
    await sleep(250);
  }
  throw new Error('Could not connect to Chrome debugging endpoint');
}

async function run() {
  try {
    console.log('Connecting to Chrome...');
    const wsUrl = await getDebuggerUrl();
    const cdp = new CDPClient(wsUrl);
    await new Promise(r => (cdp.ws.onopen = r));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    console.log('Waiting for application page load...');
    await sleep(2000);

    // 1. Verify PEC items in LegendRegistry and window.legendList
    console.log('\n--- 1. Verifying PEC entries in registry and window.legendList ---');
    const registryCheck = await cdp.eval(`(() => {
      const reg = window.LegendRegistry;
      const list = reg ? reg.list() : [];
      const pecSymbols = list.filter(e => e.is_pec);
      const windowListPec = (window.legendList || []).filter(e => e.is_pec);

      const sampleLabels = [
        'Ground (Earth)',
        'Circuit breaker',
        'Incandescent lamp outlet',
        'Fluorescent lamp outlet',
        'Single convenience outlet',
        'Duplex convenience outlet',
        'Manual fire alarm',
        'Smoke detector SD',
        'Heat detector HD',
        'Fire alarm control panel FACP',
        'AC motor',
        'Conduit wiring',
        'Open wiring',
        'Underground wiring',
        'Emergency wiring',
        'Fire alarm wiring',
        'Telephone wiring',
        'Intercom wiring',
        'Bell system wiring',
        'TV antenna wiring',
        'Closed circuit television (CCTV) wiring',
        'Music wiring',
        'Clock wiring',
        'Lightning arrester',
        'Main distribution panelboard (MDP)',
        'Three-pole switch S3P',
        'Four-way switch S4W',
        'Main switchboard (MSB)'
      ];

      const foundSamples = sampleLabels.map(label => {
        const item = reg.get(label);
        return {
          label,
          found: !!item,
          key: item?.key,
          is_pec: item?.is_pec,
          sourcesCount: item?.sources?.length,
          crop: item?.sources?.[0]?.uploaded_crop
        };
      });

      // Also check drawing-specific entries in registry
      const drawingSpecificLabels = [
        '200 mm LED recessed downlight',
        '300 mm surface-mounted dome-type lighting fixture',
        'LED tracklight',
        'Panel downlight'
      ];
      const foundDrawingSpecific = drawingSpecificLabels.map(label => {
        const item = reg.get(label);
        return {
          label,
          found: !!item,
          key: item?.key,
          is_drawing_specific: item?.is_drawing_specific,
          crop: item?.sources?.[0]?.uploaded_crop
        };
      });

      // Deduplication check: two-pole switch variant
      const switchTwoPole1 = reg.get('Switch two-pole (S2P)');
      const switchTwoPole2 = reg.get('Two-pole switch (S2P)');
      const switchKeyMatch = (switchTwoPole1 && switchTwoPole2 && switchTwoPole1.key === switchTwoPole2.key);

      return {
        totalCatalogue: list.length,
        pecCatalogueCount: pecSymbols.length,
        windowLegendListCount: window.legendList ? window.legendList.length : 0,
        windowListPecCount: windowListPec.length,
        foundSamples,
        foundDrawingSpecific,
        switchKeyMatch,
        switchKey1: switchTwoPole1?.key,
        switchKey2: switchTwoPole2?.key
      };
    })()`);

    console.log('Registry check results:', JSON.stringify(registryCheck, null, 2));
    assert(registryCheck.pecCatalogueCount >= 60, `Expected at least 60 PEC symbols in catalog, got ${registryCheck.pecCatalogueCount}`);
    assert(registryCheck.windowListPecCount >= 60, `Expected at least 60 PEC symbols in window.legendList, got ${registryCheck.windowListPecCount}`);
    for (const sample of registryCheck.foundSamples) {
      assert.strictEqual(sample.found, true, `Sample symbol "${sample.label}" must exist in catalog`);
      assert.strictEqual(sample.is_pec, true, `Sample symbol "${sample.label}" must be flagged as is_pec`);
      assert(sample.crop, `Sample symbol "${sample.label}" must have a crop image path`);
    }
    for (const sample of registryCheck.foundDrawingSpecific) {
      assert.strictEqual(sample.found, true, `Drawing-specific symbol "${sample.label}" must exist in catalog`);
      assert.strictEqual(sample.is_drawing_specific, true, `Drawing-specific symbol "${sample.label}" must be flagged as is_drawing_specific`);
    }
    assert.strictEqual(registryCheck.switchKeyMatch, true, 'Switch two-pole and Two-pole switch must merge to same canonical key');

    // 2. Verify PEC cards in Legends tab (#own-legend-entries)
    console.log('\n--- 2. Verifying Legends Tab rendering of PEC cards and Reference list ---');
    await cdp.eval(`document.getElementById('tab-legends').click();`);
    await sleep(1000);

    const cardsCheck = await cdp.eval(`(() => {
      const extRef = document.getElementById('external-reference');
      const refHost = document.getElementById('reference-host');
      const refSelect = refHost ? refHost.querySelector('select') : null;
      const host = document.getElementById('own-legend-entries');
      const cards = Array.from(host.querySelectorAll('.legend-card'));
      
      const pecCards = cards.filter(c => {
        const text = c.textContent || '';
        return text.includes('PEC reference') || text.includes('Philippine Electrical Code');
      });

      const drawingCards = cards.filter(c => {
        const text = c.textContent || '';
        return text.includes('Drawing-specific reference');
      });

      const groundCard = cards.find(c => c.querySelector('button')?.textContent?.trim() === 'Ground (Earth)');
      const conduitWiringCard = cards.find(c => c.querySelector('button')?.textContent?.trim() === 'Conduit wiring');
      const downlightCard = cards.find(c => c.querySelector('button')?.textContent?.trim() === '200 mm LED recessed downlight');

      function inspectCard(card) {
        if (!card) return null;
        const btn = card.querySelector('button');
        const img = card.querySelector('img');
        const tag = card.querySelector('small');
        const hasDeleteBtn = !!card.querySelector('button.danger');
        return {
          label: btn?.textContent?.trim(),
          imgSrc: img?.getAttribute('src'),
          imgAlt: img?.getAttribute('alt'),
          tagText: tag?.textContent?.trim(),
          hasDeleteBtn
        };
      }

      // Check position: external-reference is before own-legend-entries
      const isRefBeforeCards = !!(extRef && host && (extRef.compareDocumentPosition(host) & Node.DOCUMENT_POSITION_FOLLOWING));

      return {
        totalCards: cards.length,
        pecCardsCount: pecCards.length,
        drawingCardsCount: drawingCards.length,
        hasExternalRef: !!extRef,
        isExternalRefOpen: extRef ? extRef.open : false,
        isRefBeforeCards,
        refSelectOptionCount: refSelect ? refSelect.options.length : 0,
        groundCard: inspectCard(groundCard),
        conduitWiringCard: inspectCard(conduitWiringCard),
        downlightCard: inspectCard(downlightCard)
      };
    })()`);

    console.log('Cards check results:', JSON.stringify(cardsCheck, null, 2));
    assert(cardsCheck.hasExternalRef, 'Reference verification list details element must exist');
    assert.strictEqual(cardsCheck.isExternalRefOpen, true, 'Reference verification list details must be open by default');
    assert.strictEqual(cardsCheck.isRefBeforeCards, true, 'Reference verification list must be positioned before legend cards for immediate visibility');
    assert(cardsCheck.refSelectOptionCount >= 80, `Reference select must contain all reference items, got ${cardsCheck.refSelectOptionCount}`);
    assert(cardsCheck.pecCardsCount >= 60, `Expected at least 60 PEC cards rendered, got ${cardsCheck.pecCardsCount}`);
    assert(cardsCheck.drawingCardsCount >= 4, `Expected drawing-specific cards rendered, got ${cardsCheck.drawingCardsCount}`);

    assert(cardsCheck.groundCard, 'Ground (Earth) card must be rendered');
    assert(cardsCheck.conduitWiringCard, 'Conduit wiring card must be rendered');
    assert(cardsCheck.conduitWiringCard.imgSrc.includes('wiring-conduit'), 'Conduit wiring card must point to conduit wiring image');
    assert(cardsCheck.downlightCard, '200 mm LED recessed downlight card must be rendered');
    assert.strictEqual(cardsCheck.downlightCard.tagText.includes('Drawing-specific reference'), true, 'Downlight card must display Drawing-specific tag');

    await cdp.screenshot(path.resolve('.temp/test-pec-legends-tab.png'));

    // 3. Verify interactive selection: clicking a wiring card loads it into Edit tab
    console.log('\n--- 3. Testing card interaction (click Conduit wiring) ---');
    const clickResult = await cdp.eval(`(() => {
      const host = document.getElementById('own-legend-entries');
      const wiringCard = Array.from(host.querySelectorAll('.legend-card')).find(c => c.querySelector('button')?.textContent?.trim() === 'Conduit wiring');
      if (!wiringCard) return { error: 'Card not found' };
      wiringCard.querySelector('button').click();

      const editClass = document.getElementById('edit-class').value;
      const editLabel = document.getElementById('edit-label').value;
      const editLayer = document.getElementById('edit-layer').value;
      const isEditTabActive = !document.getElementById('panel-edit').hidden;

      return {
        editClass,
        editLabel,
        editLayer,
        isEditTabActive
      };
    })()`);

    console.log('Click result:', JSON.stringify(clickResult, null, 2));
    assert.strictEqual(clickResult.isEditTabActive, true, 'Clicking Conduit wiring card must switch to Edit tab');
    assert.strictEqual(clickResult.editClass, 'u:conduit-wiring', 'Class picker must hold u:conduit-wiring');
    assert.strictEqual(clickResult.editLabel, 'Conduit wiring', 'Edit label must hold Conduit wiring');
    assert.strictEqual(clickResult.editLayer, 'symbols', 'Edit layer must be set to symbols');

    // 4. Verify #edit-class dropdown includes PEC and Drawing-specific classes without duplicates
    console.log('\n--- 4. Testing #edit-class options and duplicate elimination ---');
    const dropdownCheck = await cdp.eval(`(() => {
      const sel = document.getElementById('edit-class');
      const options = Array.from(sel.options).map(o => ({ value: o.value, text: o.text }));
      const groundOpt = options.find(o => o.value === 'u:ground-earth');
      const conduitOpt = options.find(o => o.value === 'u:conduit-wiring');
      const cogeoOpt = options.find(o => o.value === 'u:200-led-recessed-downlight' || o.text.includes('200 mm LED'));
      const pecOptions = options.filter(o => o.text.includes('PEC reference'));
      const drawingOptions = options.filter(o => o.text.includes('drawing-specific'));

      // Check for value duplicates in select
      const values = options.map(o => o.value);
      const uniqueValues = new Set(values);
      const duplicates = values.filter((v, i) => values.indexOf(v) !== i);

      return {
        totalOptions: options.length,
        pecOptionsCount: pecOptions.length,
        drawingOptionsCount: drawingOptions.length,
        duplicateValuesCount: duplicates.length,
        duplicates: duplicates.slice(0, 5),
        groundOpt,
        conduitOpt,
        cogeoOpt
      };
    })()`);

    console.log('Dropdown check results:', JSON.stringify(dropdownCheck, null, 2));
    assert(dropdownCheck.pecOptionsCount >= 60, `Expected at least 60 options with PEC indicator, got ${dropdownCheck.pecOptionsCount}`);
    assert(dropdownCheck.drawingOptionsCount >= 4, `Expected at least 4 drawing-specific options, got ${dropdownCheck.drawingOptionsCount}`);
    assert.strictEqual(dropdownCheck.duplicateValuesCount, 0, `Dropdown should have zero duplicate values, found: ${JSON.stringify(dropdownCheck.duplicates)}`);
    assert(dropdownCheck.groundOpt && dropdownCheck.groundOpt.text.includes('PEC reference'), 'Ground option must include PEC reference bit');
    assert(dropdownCheck.conduitOpt && dropdownCheck.conduitOpt.text.includes('PEC reference'), 'Conduit option must include PEC reference bit');
    assert(dropdownCheck.cogeoOpt && dropdownCheck.cogeoOpt.text.includes('drawing-specific'), 'Cogeo downlight option must include drawing-specific bit');

    // 5. Test search filter in Legends tab
    console.log('\n--- 5. Testing Legends Tab search for "wiring" ---');
    await cdp.eval(`document.getElementById('tab-legends').click();`);
    const searchResult = await cdp.eval(`(() => {
      const searchInput = document.getElementById('legend-catalog-search');
      searchInput.value = 'wiring';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));

      const host = document.getElementById('own-legend-entries');
      const cards = Array.from(host.querySelectorAll('.legend-card'));
      return {
        matchedCardCount: cards.length,
        matchedLabels: cards.map(c => c.querySelector('button')?.textContent?.trim())
      };
    })()`);

    console.log('Search results for "wiring":', JSON.stringify(searchResult, null, 2));
    assert(searchResult.matchedCardCount >= 10, 'Expected at least 10 matches for "wiring"');
    assert(searchResult.matchedLabels.includes('Conduit wiring'), 'Conduit wiring must match search');
    assert(searchResult.matchedLabels.includes('Emergency wiring'), 'Emergency wiring must match search');
    assert(searchResult.matchedLabels.includes('Telephone wiring'), 'Telephone wiring must match search');

    // Clear search
    await cdp.eval(`(() => {
      const searchInput = document.getElementById('legend-catalog-search');
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);

    console.log('\n================================================================');
    console.log('ALL PEC LEGEND SOURCE VERIFICATION TESTS PASSED SUCCESSFULLY');
    console.log('================================================================\n');

  } finally {
    try {
      chrome.kill('SIGKILL');
    } catch (e) {}
  }
}

run().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
