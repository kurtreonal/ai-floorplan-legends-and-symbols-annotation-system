// tests/test-legends-all-groups-priority.cjs
// Verifies Legends tab contains all legends from Group 1 to Group 28,
// with the selected group's symbols prioritized at the top.
// Strictly zero emojis.

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 9228;
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_DIR = path.resolve('.temp/cdp-test-all-groups');

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
    await sleep(2500);

    // 1. Test Group 28 Legends Tab
    console.log('\n--- Testing Group 28 Legends Tab ---');
    await cdp.eval(`(() => {
      const grp = document.getElementById('group');
      grp.value = '28';
      grp.dispatchEvent(new Event('change'));
      document.getElementById('tab-legends').click();
    })()`);
    await sleep(1500);

    const grp28Status = await cdp.eval(`(() => {
      const host = document.getElementById('own-legend-entries');
      const cards = Array.from(host.querySelectorAll('.legend-card'));
      const dividers = Array.from(host.querySelectorAll('.legend-section-divider'));
      const selectedCards = Array.from(host.querySelectorAll('.legend-card-selected-group, .legend-card-onsheet'));
      const firstCardLabel = cards[0]?.querySelector('button')?.textContent?.trim();
      const first5Labels = cards.slice(0, 5).map(c => c.querySelector('button')?.textContent?.trim());
      const countText = document.getElementById('legend-catalog-count')?.textContent;
      return {
        totalCards: cards.length,
        dividerCount: dividers.length,
        dividerTexts: dividers.map(d => d.textContent.trim()),
        selectedGroupCardCount: selectedCards.length,
        firstCardLabel,
        first5Labels,
        countText
      };
    })()`);

    console.log('Group 28 Legends status:', JSON.stringify(grp28Status, null, 2));
    if (grp28Status.totalCards < 100) {
      throw new Error(`Expected all groups in Legends tab (>= 100 cards), got: ${grp28Status.totalCards}`);
    }
    if (grp28Status.dividerCount < 1) {
      throw new Error('Expected section divider in Legends tab, got 0');
    }
    if (grp28Status.selectedGroupCardCount === 0) {
      throw new Error('Expected selected group cards marked at the top');
    }

    await cdp.screenshot(path.resolve('.temp/test-group-28-all-legends.png'));

    // 2. Test Group 21 Legends Tab (BDO Cubao)
    console.log('\n--- Testing Group 21 Legends Tab ---');
    await cdp.eval(`(() => {
      const grp = document.getElementById('group');
      grp.value = '21';
      grp.dispatchEvent(new Event('change'));
      document.getElementById('tab-legends').click();
    })()`);
    await sleep(1500);

    const grp21Status = await cdp.eval(`(() => {
      const host = document.getElementById('own-legend-entries');
      const cards = Array.from(host.querySelectorAll('.legend-card'));
      const first5Labels = cards.slice(0, 5).map(c => c.querySelector('button')?.textContent?.trim());
      const selectedCards = Array.from(host.querySelectorAll('.legend-card-selected-group, .legend-card-onsheet'));
      return {
        totalCards: cards.length,
        selectedCardsCount: selectedCards.length,
        first5Labels
      };
    })()`);

    console.log('Group 21 Legends status:', JSON.stringify(grp21Status, null, 2));
    if (grp21Status.totalCards !== grp28Status.totalCards) {
      throw new Error(`Total cards should remain universal across groups: ${grp21Status.totalCards} vs ${grp28Status.totalCards}`);
    }
    if (!grp21Status.first5Labels.includes('Duplex convenience outlet - normal power, white plate') &&
        !grp21Status.first5Labels.includes('3-prong twistlock outlet')) {
      throw new Error('Expected Group 21 specific symbols in first 5 labels');
    }

    await cdp.screenshot(path.resolve('.temp/test-group-21-all-legends.png'));

    // 3. Test #edit-class dropdown prioritization
    console.log('\n--- Testing #edit-class dropdown prioritization ---');
    await cdp.eval(`document.getElementById('tab-edit').click();`);
    await sleep(500);

    const editClassReport = await cdp.eval(`(() => {
      const sel = document.getElementById('edit-class');
      const options = Array.from(sel.options).map(o => ({
        value: o.value,
        text: o.text,
        onSheet: o.dataset.onSheet,
        selectedGroup: o.dataset.selectedGroup
      }));
      const nonBlank = options.filter(o => o.value !== '');
      let seenNonGroup = false;
      let groupItemsAfterNonGroup = 0;
      for (const o of nonBlank) {
        const isGroup = o.selectedGroup === '1' || o.onSheet === '1';
        if (!isGroup) seenNonGroup = true;
        else if (seenNonGroup) groupItemsAfterNonGroup++;
      }
      return {
        totalOptions: options.length,
        first10: nonBlank.slice(0, 10).map(o => ({ text: o.text, isGroup: o.selectedGroup === '1' || o.onSheet === '1' })),
        groupItemsAfterNonGroup
      };
    })()`);

    console.log('Dropdown report:', JSON.stringify(editClassReport, null, 2));
    if (editClassReport.groupItemsAfterNonGroup > 0) {
      throw new Error('Found selected group items appearing after non-group items in #edit-class dropdown');
    }
    if (editClassReport.totalOptions < 100) {
      throw new Error(`Expected all groups in #edit-class (>= 100 options), got: ${editClassReport.totalOptions}`);
    }

    // 4. Test selecting a legend card from another group to apply for the floorplan
    console.log('\n--- Testing selecting a legend card for the floorplan ---');
    await cdp.eval(`(() => {
      document.getElementById('tab-legends').click();
    })()`);
    await sleep(500);

    const clickResult = await cdp.eval(`(() => {
      const host = document.getElementById('own-legend-entries');
      const buttons = Array.from(host.querySelectorAll('.legend-card button'));
      // Find a button for a symbol from another group, e.g. Single telephone outlet
      const targetBtn = buttons.find(b => b.textContent.includes('Single telephone outlet')) || buttons[buttons.length - 1];
      const targetText = targetBtn.textContent;
      targetBtn.click();
      return {
        clickedText: targetText,
        activeTab: document.getElementById('panel-edit').hidden ? 'other' : 'edit',
        loadedClass: document.getElementById('edit-class').value,
        loadedLabel: document.getElementById('edit-label').value,
        loadedLayer: document.getElementById('edit-layer').value
      };
    })()`);

    console.log('Click result:', JSON.stringify(clickResult, null, 2));
    if (clickResult.activeTab !== 'edit') {
      throw new Error(`Expected active tab to be 'edit' after clicking legend, got: ${clickResult.activeTab}`);
    }
    if (!clickResult.loadedClass.startsWith('u:')) {
      throw new Error(`Expected loaded class to start with 'u:', got: ${clickResult.loadedClass}`);
    }
    if (!clickResult.loadedLabel) {
      throw new Error('Expected loaded label to be non-empty');
    }

    console.log('\n================================================================');
    console.log('ALL TESTS FOR UNIVERSAL LEGENDS WITH GROUP PRIORITY PASSED!');
    console.log('================================================================\n');
  } finally {
    chrome.kill('SIGTERM');
  }
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
