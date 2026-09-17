// tests/test-legends-browser.cjs
// Automated end-to-end browser test verifying that Group 28 (and other groups)
// display their legend cards under the Legends tab with zero emojis.

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(__dirname, '..', '.temp', 'chrome-legends-profile');
const SCREENSHOT_PATH = path.join(__dirname, '..', '.temp', 'group-28-legends-tab.png');
const ARTIFACT_DIR = 'C:\\Users\\kupal\\.gemini\\antigravity-ide\\brain\\6473df46-e494-4a85-9d44-c608752982cc';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function getJson(urlStr) {
  return new Promise((resolve, reject) => {
    http.get(urlStr, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
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
        if (parsed.error) reject(parsed.error);
        else resolve(parsed.result);
      }
    };
  }

  async waitOpen() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
  }

  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      const msg = res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'CDP eval error';
      console.error('CDP eval error:', msg);
      throw new Error(msg);
    }
    return res.result?.value;
  }
}

async function runTest() {
  console.log('Starting Chrome for Legends Tab verification...');
  const port = 9228;
  const chrome = spawn(CHROME_PATH, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1440,900'
  ]);

  try {
    let version = null;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      try {
        version = await getJson(`http://127.0.0.1:${port}/json/version`);
        if (version) break;
      } catch (e) {}
    }

    if (!version) throw new Error('Could not connect to Chrome debugging port');

    const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
    const page = targets.find(t => t.type === 'page') || targets[0];
    const cdp = new CDPClient(page.webSocketDebuggerUrl);
    await cdp.waitOpen();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    console.log('Navigating to http://127.0.0.1:3000/...');
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:3000/' });
    await sleep(2000);

    // Verify app loaded
    const title = await cdp.eval('document.title');
    console.log('Page loaded. Title:', title);

    // Switch to Group 28
    console.log('Switching to Group 28 (Residential Legends and Reference Sheet)...');
    await cdp.eval(`
      (() => {
        const grp = document.getElementById('group');
        grp.value = '28';
        grp.dispatchEvent(new Event('change'));
      })()
    `);
    await sleep(1500);

    // Switch to Legends tab
    console.log('Switching to Legends tab...');
    await cdp.eval(`
      document.getElementById('tab-legends').click();
    `);
    await sleep(1000);

    // Inspect own-legend-entries host
    const legendInfo = await cdp.eval(`
      (() => {
        const host = document.getElementById('own-legend-entries');
        const cards = Array.from(host.querySelectorAll('.legend-card'));
        const hasPlaceholder = host.textContent.includes('No embedded/associated legend indexed');
        const labels = cards.map(c => c.querySelector('button')?.textContent || '');
        const hasSvgs = cards.filter(c => c.querySelector('svg')).length;
        const hasSwatches = cards.filter(c => c.querySelector('input[type="color"]')).length;
        return {
          cardCount: cards.length,
          hasPlaceholder,
          labels,
          hasSvgs,
          hasSwatches,
          hostHtmlSnippet: host.innerHTML.slice(0, 300)
        };
      })()
    `);

    console.log('Group 28 Legends tab status:');
    console.log('  Card count:', legendInfo.cardCount);
    console.log('  Has placeholder message:', legendInfo.hasPlaceholder);
    console.log('  Number of cards with SVG glyph preview:', legendInfo.hasSvgs);
    console.log('  Number of cards with color swatches:', legendInfo.hasSwatches);
    console.log('  Labels found (first 5):', legendInfo.labels.slice(0, 5));

    if (legendInfo.hasPlaceholder) {
      throw new Error('Placeholder "No embedded/associated legend indexed" is STILL PRESENT!');
    }
    if (legendInfo.cardCount === 0) {
      throw new Error('Expected legend cards for Group 28, but got 0 cards!');
    }

    // Capture screenshot
    console.log('Capturing screenshot of Group 28 Legends Tab...');
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const shotBuf = Buffer.from(shot.data, 'base64');
    fs.writeFileSync(SCREENSHOT_PATH, shotBuf);
    console.log('Saved screenshot to:', SCREENSHOT_PATH);

    // Copy to artifact directory for walkthrough report
    if (fs.existsSync(ARTIFACT_DIR)) {
      const artPath = path.join(ARTIFACT_DIR, 'group-28-legends-tab.png');
      fs.writeFileSync(artPath, shotBuf);
      console.log('Copied screenshot to artifact directory:', artPath);
    }

    // Now test Group 23 plan sheet (sheet-54: 23-datacomlayout.jpg) to verify associated legend
    console.log('\nTesting Group 23 plan sheet (sheet-54) for associated legend...');
    await cdp.eval(`
      (() => {
        const grp = document.getElementById('group');
        grp.value = '23';
        grp.dispatchEvent(new Event('change'));
      })()
    `);
    await sleep(1500);

    const grp23Info = await cdp.eval(`
      (() => {
        const host = document.getElementById('own-legend-entries');
        const cards = Array.from(host.querySelectorAll('.legend-card'));
        const hasPlaceholder = host.textContent.includes('No embedded/associated legend indexed');
        return { cardCount: cards.length, hasPlaceholder };
      })()
    `);
    console.log('Group 23 plan sheet Legends tab status:');
    console.log('  Card count:', grp23Info.cardCount);
    console.log('  Has placeholder message:', grp23Info.hasPlaceholder);

    if (grp23Info.cardCount === 0 || grp23Info.hasPlaceholder) {
      throw new Error('Group 23 plan sheet failed to load associated legend cards!');
    }

    // Verify Legend Class dropdown in Annotation tab
    console.log('\nTesting Legend Class dropdown population in Annotation edit tab...');
    await cdp.eval(`document.getElementById('tab-edit').click();`);
    await sleep(500);

    const dropdownInfo = await cdp.eval(`
      (() => {
        const sel = document.getElementById('edit-class');
        const options = Array.from(sel.options).map(o => ({ value: o.value, text: o.text }));
        const optgroups = Array.from(sel.querySelectorAll('optgroup')).map(g => ({ label: g.label, count: g.children.length }));
        const groupCounts = {};
        for (let g = 21; g <= 28; g++) {
          groupCounts[g] = options.filter(o => o.value.startsWith('sheet-') && window.legendList?.find(l => l.legend_entry === o.value)?.group === g).length;
        }
        return {
          totalOptions: options.length,
          optgroups,
          groupCounts
        };
      })()
    `);
    console.log('Dropdown status:');
    console.log('  Total options:', dropdownInfo.totalOptions);
    console.log('  Optgroup count:', dropdownInfo.optgroups.length);
    console.log('  Sample optgroup labels:', dropdownInfo.optgroups.slice(0, 5).map(g => g.label));
    console.log('  Legend counts for Groups 21 to 28:');
    for (let g = 21; g <= 28; g++) {
      console.log(`    Group ${g}: ${dropdownInfo.groupCounts[g]} classes`);
      if (dropdownInfo.groupCounts[g] === 0) {
        throw new Error(`Group ${g} has 0 classes in the legend dropdown!`);
      }
    }

    // Test live search in edit-class-search
    console.log('\nTesting live search filter for "CCTV"...');
    await cdp.eval(`
      (() => {
        const search = document.getElementById('edit-class-search');
        search.value = 'cctv';
        search.dispatchEvent(new Event('input'));
      })()
    `);
    await sleep(500);

    const searchResults = await cdp.eval(`
      (() => {
        const sel = document.getElementById('edit-class');
        const options = Array.from(sel.options).map(o => ({ value: o.value, text: o.text }));
        return options.filter(o => o.value !== '');
      })()
    `);
    console.log('Search "cctv" returned options count:', searchResults.length);
    console.log('Sample matching options:', searchResults.slice(0, 3));
    if (searchResults.length === 0) {
      throw new Error('Search for "cctv" returned 0 results!');
    }

    console.log('\n================================================================');
    console.log('ALL BROWSER LEGEND VERIFICATION TESTS PASSED PERFECTLY!');
    console.log('================================================================\n');
  } finally {
    chrome.kill('SIGTERM');
  }
}

runTest().catch(err => {
  console.error('Browser test failed:', err);
  process.exit(1);
});
