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
        'AC motor'
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

      return {
        totalCatalogue: list.length,
        pecCatalogueCount: pecSymbols.length,
        windowLegendListCount: window.legendList ? window.legendList.length : 0,
        windowListPecCount: windowListPec.length,
        foundSamples
      };
    })()`);

    console.log('Registry check results:', JSON.stringify(registryCheck, null, 2));
    assert(registryCheck.pecCatalogueCount >= 29, `Expected at least 29 PEC symbols in catalog, got ${registryCheck.pecCatalogueCount}`);
    assert(registryCheck.windowListPecCount >= 29, `Expected at least 29 PEC symbols in window.legendList, got ${registryCheck.windowListPecCount}`);
    for (const sample of registryCheck.foundSamples) {
      assert.strictEqual(sample.found, true, `Sample symbol "${sample.label}" must exist in catalog`);
      assert.strictEqual(sample.is_pec, true, `Sample symbol "${sample.label}" must be flagged as is_pec`);
      assert(sample.crop, `Sample symbol "${sample.label}" must have a crop image path`);
    }

    // 2. Verify PEC cards in Legends tab (#own-legend-entries)
    console.log('\n--- 2. Verifying Legends Tab rendering of PEC cards ---');
    await cdp.eval(`document.getElementById('tab-legends').click();`);
    await sleep(1000);

    const cardsCheck = await cdp.eval(`(() => {
      const host = document.getElementById('own-legend-entries');
      const cards = Array.from(host.querySelectorAll('.legend-card'));
      
      const pecCards = cards.filter(c => {
        const text = c.textContent || '';
        return text.includes('PEC reference') || text.includes('Philippine Electrical Code');
      });

      const groundCard = cards.find(c => c.querySelector('button')?.textContent?.trim() === 'Ground (Earth)');
      const breakerCard = cards.find(c => c.querySelector('button')?.textContent?.trim() === 'Circuit breaker');

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

      return {
        totalCards: cards.length,
        pecCardsCount: pecCards.length,
        groundCard: inspectCard(groundCard),
        breakerCard: inspectCard(breakerCard)
      };
    })()`);

    console.log('Cards check results:', JSON.stringify(cardsCheck, null, 2));
    assert(cardsCheck.pecCardsCount >= 29, `Expected at least 29 PEC cards rendered, got ${cardsCheck.pecCardsCount}`);
    assert(cardsCheck.groundCard, 'Ground (Earth) card must be rendered');
    assert.strictEqual(cardsCheck.groundCard.imgSrc, 'references/pec-earth.png', 'Ground card must point to pec-earth image');
    assert.strictEqual(cardsCheck.groundCard.tagText, 'PEC reference source (Philippine Electrical Code)', 'Ground card must display PEC tag');
    assert.strictEqual(cardsCheck.groundCard.hasDeleteBtn, false, 'PEC card must not have a delete button');

    assert(cardsCheck.breakerCard, 'Circuit breaker card must be rendered');
    assert.strictEqual(cardsCheck.breakerCard.imgSrc, 'references/pec-breaker.png', 'Circuit breaker card must point to pec-breaker image');
    assert.strictEqual(cardsCheck.breakerCard.hasDeleteBtn, false, 'Circuit breaker PEC card must not have a delete button');

    await cdp.screenshot(path.resolve('.temp/test-pec-legends-tab.png'));

    // 3. Verify interactive selection: clicking a PEC card loads it into Edit tab
    console.log('\n--- 3. Testing card interaction (click Ground (Earth)) ---');
    const clickResult = await cdp.eval(`(() => {
      const host = document.getElementById('own-legend-entries');
      const groundCard = Array.from(host.querySelectorAll('.legend-card')).find(c => c.querySelector('button')?.textContent?.trim() === 'Ground (Earth)');
      if (!groundCard) return { error: 'Card not found' };
      groundCard.querySelector('button').click();

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
    assert.strictEqual(clickResult.isEditTabActive, true, 'Clicking PEC card must switch to Edit tab');
    assert.strictEqual(clickResult.editClass, 'u:ground-earth', 'Class picker must hold u:ground-earth');
    assert.strictEqual(clickResult.editLabel, 'Ground (Earth)', 'Edit label must hold Ground (Earth)');
    assert.strictEqual(clickResult.editLayer, 'symbols', 'Edit layer must be set to symbols');

    // 4. Verify #edit-class dropdown includes PEC classes with indicator
    console.log('\n--- 4. Testing #edit-class options ---');
    const dropdownCheck = await cdp.eval(`(() => {
      const sel = document.getElementById('edit-class');
      const options = Array.from(sel.options).map(o => ({ value: o.value, text: o.text }));
      const groundOpt = options.find(o => o.value === 'u:ground-earth');
      const breakerOpt = options.find(o => o.value === 'u:circuit-breaker');
      const smokeOpt = options.find(o => o.value === 'u:smoke-detector-sd');
      const pecOptions = options.filter(o => o.text.includes('PEC reference'));

      return {
        totalOptions: options.length,
        pecOptionsCount: pecOptions.length,
        groundOpt,
        breakerOpt,
        smokeOpt
      };
    })()`);

    console.log('Dropdown check results:', JSON.stringify(dropdownCheck, null, 2));
    assert(dropdownCheck.pecOptionsCount >= 29, `Expected at least 29 options with PEC indicator, got ${dropdownCheck.pecOptionsCount}`);
    assert(dropdownCheck.groundOpt && dropdownCheck.groundOpt.text.includes('PEC reference'), 'Ground option must include PEC reference bit');
    assert(dropdownCheck.breakerOpt && dropdownCheck.breakerOpt.text.includes('PEC reference'), 'Breaker option must include PEC reference bit');
    assert(dropdownCheck.smokeOpt && dropdownCheck.smokeOpt.text.includes('PEC reference'), 'Smoke detector option must include PEC reference bit');

    // 5. Test search filter in Legends tab
    console.log('\n--- 5. Testing Legends Tab search for "ground" ---');
    await cdp.eval(`document.getElementById('tab-legends').click();`);
    const searchResult = await cdp.eval(`(() => {
      const searchInput = document.getElementById('legend-catalog-search');
      searchInput.value = 'ground';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));

      const host = document.getElementById('own-legend-entries');
      const cards = Array.from(host.querySelectorAll('.legend-card'));
      return {
        matchedCardCount: cards.length,
        matchedLabels: cards.map(c => c.querySelector('button')?.textContent?.trim())
      };
    })()`);

    console.log('Search results for "ground":', JSON.stringify(searchResult, null, 2));
    assert(searchResult.matchedCardCount >= 1, 'Expected at least 1 match for "ground"');
    assert(searchResult.matchedLabels.includes('Ground (Earth)'), 'Ground (Earth) must match search');

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
