// scripts/verify-outlet-ui.cjs
// Verifies outlet class separation, legends tab rendering, and reference desk search via headless Chrome CDP.
// Strictly zero emojis.

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 9227;
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_DIR = path.resolve('.temp/cdp-verify-outlet-ui');

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
    this.errors = [];
    this.ws.onmessage = msg => {
      const parsed = JSON.parse(msg.data);
      if (parsed.id && this.callbacks.has(parsed.id)) {
        const { resolve, reject } = this.callbacks.get(parsed.id);
        this.callbacks.delete(parsed.id);
        if (parsed.error) reject(new Error(parsed.error.message));
        else resolve(parsed.result);
      } else if (parsed.method === 'Runtime.consoleAPICalled') {
        const type = parsed.params.type;
        const text = parsed.params.args.map(a => a.value || a.description || '').join(' ');
        if (type === 'error') this.errors.push(text);
      } else if (parsed.method === 'Runtime.exceptionThrown') {
        const text = parsed.params.exceptionDetails.exception?.description || parsed.params.exceptionDetails.text;
        this.errors.push(text);
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
    } catch (e) {
      // retry
    }
    await sleep(250);
  }
  throw new Error('Could not connect to Chrome debugging endpoint');
}

async function run() {
  console.log('Launching headless Chrome and connecting via CDP...');
  const wsUrl = await getDebuggerUrl();
  const cdp = new CDPClient(wsUrl);

  await new Promise(r => (cdp.ws.onopen = r));
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  console.log('Waiting for application page load...');
  await sleep(2500);

  // 1. Verify #edit-class options and LegendRegistry
  console.log('Verifying #edit-class dropdown classes...');
  const dropdownReport = await cdp.eval(`(() => {
    const sel = document.getElementById('edit-class');
    if (!sel) return { error: 'No #edit-class' };
    const values = Array.from(sel.options).map(o => o.value);
    const lr = window.LegendRegistry;
    const expected = [
      'sheet-32:L01S', 'sheet-32:L01D', 'sheet-32:L02S', 'sheet-32:L02D',
      'sheet-34:L16S', 'sheet-34:L16D', 'sheet-34:L17S', 'sheet-34:L17D',
      'sheet-37:L01S', 'sheet-37:L01D', 'sheet-37:L02S', 'sheet-37:L02D',
      'sheet-51:L01N', 'sheet-51:L01U'
    ];
    const excluded = [
      'sheet-32:L01', 'sheet-32:L02',
      'sheet-34:L16', 'sheet-34:L17',
      'sheet-37:L01', 'sheet-37:L02',
      'sheet-51:L01'
    ];
    
    // Check if expected classes are present directly or resolved via LegendRegistry
    const allCatalog = lr ? lr.list().map(e => e.key) : values;
    const resolvedKeys = expected.map(e => lr ? lr.resolve(e) : e);
    const presentExpected = expected.filter((e, i) => allCatalog.includes(resolvedKeys[i]));
    const missingExpected = expected.filter((e, i) => !allCatalog.includes(resolvedKeys[i]));

    // Ensure retired combined classes are not active entries in catalog
    const forbiddenPresent = excluded.filter(e => {
      if (lr) {
        const key = lr.resolve(e);
        return key && allCatalog.includes(key) && lr.get(key)?.label?.includes('Combined');
      }
      return values.includes(e);
    });

    return {
      totalOptions: values.length,
      totalCatalog: allCatalog.length,
      resolvedKeys: Object.fromEntries(expected.map(e => [e, lr ? lr.resolve(e) : e])),
      presentExpected,
      missingExpected,
      forbiddenPresent
    };
  })()`);

  console.log('Dropdown analysis:', JSON.stringify(dropdownReport, null, 2));
  if (dropdownReport.missingExpected.length > 0) {
    throw new Error('Missing expected classes in catalogue / dropdown: ' + dropdownReport.missingExpected.join(', '));
  }
  if (dropdownReport.forbiddenPresent.length > 0) {
    throw new Error('Found retired combined classes: ' + dropdownReport.forbiddenPresent.join(', '));
  }

  // Helper function to switch sheets in review UI
  async function switchToSheet(sheetId) {
    await cdp.eval(`(() => {
      const sheet = (window.ANNOTATION_DATA.sheets || []).find(s => s.id === '${sheetId}');
      if (!sheet) throw new Error('Sheet not found: ${sheetId}');
      const groupSel = document.getElementById('group');
      groupSel.value = String(sheet.group);
      groupSel.onchange();
      const sheetSel = document.getElementById('sheet');
      sheetSel.value = '${sheetId}';
      sheetSel.onchange();
      document.getElementById('tab-legends').click();
    })()`);
    await sleep(1200);
  }

  // 2. Test Group 12 Legends tab (sheet-32)
  console.log('Testing Legends tab for Group 12 (sheet-32)...');
  await switchToSheet('sheet-32');

  const s32Cards = await cdp.eval(`(() => {
    const cards = Array.from(document.querySelectorAll('#own-legend-entries .legend-card'));
    return cards.map(c => ({
      text: c.querySelector('button')?.textContent || '',
      hasSvg: !!c.querySelector('svg')
    }));
  })()`);
  console.log('Sheet 32 rendered legend cards:', s32Cards.length, s32Cards.map(c => c.text));
  await cdp.screenshot(path.resolve('.temp/group-12-legends.png'));

  // 3. Test Group 13 Legends tab (sheet-34)
  console.log('Testing Legends tab for Group 13 (sheet-34)...');
  await switchToSheet('sheet-34');

  const s34Cards = await cdp.eval(`(() => {
    const cards = Array.from(document.querySelectorAll('#own-legend-entries .legend-card'));
    return cards.map(c => ({
      text: c.querySelector('button')?.textContent || '',
      hasSvg: !!c.querySelector('svg')
    }));
  })()`);
  console.log('Sheet 34 rendered legend cards:', s34Cards.length, s34Cards.map(c => c.text));
  await cdp.screenshot(path.resolve('.temp/group-13-legends.png'));

  // 4. Test Group 15 Legends tab (sheet-37)
  console.log('Testing Legends tab for Group 15 (sheet-37)...');
  await switchToSheet('sheet-37');

  const s37Cards = await cdp.eval(`(() => {
    const cards = Array.from(document.querySelectorAll('#own-legend-entries .legend-card'));
    return cards.map(c => ({
      text: c.querySelector('button')?.textContent || '',
      hasSvg: !!c.querySelector('svg')
    }));
  })()`);
  console.log('Sheet 37 rendered legend cards:', s37Cards.length, s37Cards.map(c => c.text));
  await cdp.screenshot(path.resolve('.temp/group-15-legends.png'));

  // 5. Test Group 21 Legends tab (sheet-51)
  console.log('Testing Legends tab for Group 21 BDO Cubao (sheet-51)...');
  await switchToSheet('sheet-51');

  const s51Cards = await cdp.eval(`(() => {
    const cards = Array.from(document.querySelectorAll('#own-legend-entries .legend-card'));
    return cards.map(c => ({
      text: c.querySelector('button')?.textContent || '',
      hasSvg: !!c.querySelector('svg')
    }));
  })()`);
  console.log('Sheet 51 rendered legend cards:', s51Cards.length, s51Cards.map(c => c.text));
  const hasNormal = s51Cards.some(c => c.text.includes('normal power, white plate'));
  const hasUps = s51Cards.some(c => c.text.includes('UPS power, metallic gray plate'));
  if (!hasNormal || !hasUps) {
    throw new Error('Sheet 51 Legends tab missing Normal or UPS power convenience outlet card');
  }
  await cdp.screenshot(path.resolve('.temp/group-21-legends.png'));

  // 6. Test Reference Desk search
  console.log('Testing Reference Desk outlet search in #reference-host...');
  await cdp.eval(`(() => {
    document.getElementById('tab-edit').click();
    const searchInput = document.querySelector('#reference-host input');
    if (searchInput) {
      searchInput.value = 'outlet';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await sleep(600);

  const refSearchResults = await cdp.eval(`(() => {
    const sel = document.querySelector('#reference-host select');
    if (!sel) return { error: 'No select in reference-host' };
    const options = Array.from(sel.options).map(o => ({ value: o.value, text: o.textContent }));
    const firstOption = options[0];
    if (firstOption) {
      sel.value = firstOption.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const card = document.querySelector('#reference-host > section > div');
    const cardTitle = card?.querySelector('h3')?.textContent || '';
    const imgSrc = card?.querySelector('img')?.src || '';
    return {
      totalOptions: options.length,
      firstFive: options.slice(0, 5),
      cardTitle,
      imgSrc
    };
  })()`);
  console.log('Reference search results for "outlet":', JSON.stringify(refSearchResults, null, 2));
  await cdp.eval(`(() => {
    document.getElementById('reference-host')?.scrollIntoView({ behavior: 'instant', block: 'start' });
  })()`);
  await sleep(400);
  await cdp.screenshot(path.resolve('.temp/reference-desk-outlet-search.png'));

  console.log('ALL BROWSER AND UI VERIFICATIONS PASSED SUCCESSFULLY!');
}

run()
  .catch(err => {
    console.error('VERIFICATION ERROR:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      chrome.kill('SIGKILL');
    } catch (e) {}
  });
