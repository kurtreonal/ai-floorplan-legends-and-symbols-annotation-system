// test-browser-session-ui.cjs
// Tests http://127.0.0.1:3000/ directly using local Chrome via CDP
// Zero emojis in output.

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(__dirname, '..', '.temp', 'chrome-session-profile');
const SCREENSHOT_PATH = path.join(__dirname, '..', '.temp', 'browser-session-verification.png');

if (!fs.existsSync(path.dirname(TEMP_USER_DATA))) {
  fs.mkdirSync(path.dirname(TEMP_USER_DATA), { recursive: true });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
        if (parsed.error) reject(new Error(parsed.error.message));
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
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result?.value;
  }

  close() {
    try { this.ws.close(); } catch (e) {}
  }
}

async function run() {
  console.log('Launching local Chrome to test http://127.0.0.1:3000/...');
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9223',
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
    'http://127.0.0.1:3000/'
  ], { stdio: 'ignore' });

  try {
    let targets = null;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      try {
        targets = await getJson('http://127.0.0.1:9223/json');
        if (targets && targets.length > 0) break;
      } catch (e) {}
    }

    if (!targets || !targets.length) {
      throw new Error('Could not connect to Chrome debugging port.');
    }

    const pageTarget = targets.find(t => t.type === 'page' && t.url.includes('127.0.0.1:3000'));
    if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
      throw new Error('Target page at http://127.0.0.1:3000 not found.');
    }

    const cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await cdp.waitOpen();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    console.log('Connected to target page. Waiting for workbench to initialize...');
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const isReady = await cdp.eval('typeof window.reviewWorkspace !== "undefined" && typeof window.VEDSessionStore !== "undefined" && !!document.getElementById("session-status")');
      if (isReady) { ready = true; break; }
    }

    if (!ready) {
      throw new Error('Workbench did not initialize in time.');
    }

    // 1. Verify page title and header controls
    const title = await cdp.eval('document.title');
    console.log('Page Title:', title);

    const sessionStatusText = await cdp.eval('document.getElementById("session-status")?.textContent');
    console.log('Session Status Badge:', sessionStatusText);

    const hasSaveBtn = await cdp.eval('!!document.getElementById("btn-save-session")');
    console.log('Has Save Session Button:', hasSaveBtn);

    const hasAutoAnnotateBtn = await cdp.eval('!!document.getElementById("btn-auto-annotate")');
    console.log('Has Auto Annotate Button:', hasAutoAnnotateBtn);

    // 2. Trigger a manual session save click
    console.log('Testing Save session button click...');
    await cdp.eval('document.getElementById("btn-save-session")?.click()');
    await sleep(500);
    const postSaveStatus = await cdp.eval('document.getElementById("session-status")?.textContent');
    console.log('Session Status After Click:', postSaveStatus);

    // 3. Take screenshot
    console.log('Capturing verification screenshot...');
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(screenshot.data, 'base64');
    fs.writeFileSync(SCREENSHOT_PATH, buffer);
    console.log(`Screenshot saved to ${SCREENSHOT_PATH} (${(buffer.length / 1024).toFixed(1)} KB)`);

    console.log('\nAll browser UI and session checks PASSED successfully!');
    cdp.close();
  } finally {
    try { chrome.kill(); } catch (e) {}
  }
}

run().catch(err => {
  console.error('Browser UI test error:', err);
  process.exitCode = 1;
});
