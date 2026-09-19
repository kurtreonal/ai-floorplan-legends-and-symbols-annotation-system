// tests/test-fullscreen-mode.cjs
// Automated CDP verification of workspace full screen mode.
// Strictly zero emojis.

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const PORT = 9231;
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_DIR = path.resolve('.temp/cdp-test-fullscreen');

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
    return res.result?.value;
  }
}

async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const data = await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${PORT}/json`, res => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => resolve(body));
        });
        req.on('error', reject);
      });
      const list = JSON.parse(data);
      const target = list.find(t => t.type === 'page' && t.url.includes('3000'));
      if (target && target.webSocketDebuggerUrl) return target.webSocketDebuggerUrl;
    } catch (e) {
      await sleep(250);
    }
  }
  throw new Error('Could not connect to Chrome DevTools endpoint');
}

async function run() {
  try {
    console.log('Connecting to Chrome...');
    const wsUrl = await getWsUrl();
    const client = new CDPClient(wsUrl);

    await new Promise((resolve, reject) => {
      client.ws.onopen = resolve;
      client.ws.onerror = reject;
    });

    await client.send('Page.enable');
    await client.send('DOM.enable');
    await client.send('Runtime.enable');

    console.log('Waiting for application page load...');
    await sleep(2500);

    // Check 1: Verify presence of fullscreen buttons
    console.log('\n--- Checking Fullscreen Mode UI Controls ---');
    const uiCheck = await client.eval(`(() => {
      const headerBtn = document.getElementById('btn-fullscreen');
      const canvasBtn = document.getElementById('canvas-fullscreen-btn');
      const pagebarBtn = document.getElementById('pagebar-fullscreen-btn');
      const sidebarToggleBtn = document.getElementById('btn-toggle-sidebar');
      const hasApi = typeof window.workspaceFullscreen === 'object';
      return {
        hasHeaderBtn: Boolean(headerBtn),
        headerBtnText: headerBtn?.textContent?.trim(),
        hasCanvasBtn: Boolean(canvasBtn),
        canvasBtnText: canvasBtn?.textContent?.trim(),
        hasPagebarBtn: Boolean(pagebarBtn),
        pagebarBtnText: pagebarBtn?.textContent?.trim(),
        hasSidebarToggle: Boolean(sidebarToggleBtn),
        hasApi,
        initialFullscreen: window.workspaceFullscreen?.isActive()
      };
    })()`);
    console.log('Fullscreen UI check result:', JSON.stringify(uiCheck, null, 2));

    assert.strictEqual(uiCheck.hasHeaderBtn, true, 'Header fullscreen button must exist');
    assert.strictEqual(uiCheck.hasCanvasBtn, true, 'Canvas view-tools fullscreen button must exist');
    assert.strictEqual(uiCheck.hasPagebarBtn, true, 'Pagebar fullscreen button must exist');
    assert.strictEqual(uiCheck.hasSidebarToggle, true, 'Sidebar toggle button must exist');
    assert.strictEqual(uiCheck.hasApi, true, 'window.workspaceFullscreen API must exist');
    assert.strictEqual(uiCheck.initialFullscreen, false, 'Initial state must not be fullscreen');

    // Check 2: Initial canvas dimensions in normal mode
    const normalDims = await client.eval(`(() => {
      const canvas = document.getElementById('canvas');
      const stage = window.reviewWorkspace?.getStage?.();
      const rect = canvas.getBoundingClientRect();
      return {
        canvasWidth: Math.round(rect.width),
        canvasHeight: Math.round(rect.height),
        stageWidth: stage ? Math.round(stage.width()) : null,
        stageHeight: stage ? Math.round(stage.height()) : null
      };
    })()`);
    console.log('Normal mode dimensions:', JSON.stringify(normalDims, null, 2));

    // Check 3: Trigger full screen mode via header button
    console.log('\n--- Entering Fullscreen Mode via Header Button ---');
    const fsEnterResult = await client.eval(`(() => {
      const btn = document.getElementById('btn-fullscreen');
      btn.click();
      return {
        isActive: window.workspaceFullscreen.isActive(),
        docHasClass: document.documentElement.classList.contains('workspace-fullscreen'),
        bodyHasClass: document.body.classList.contains('workspace-fullscreen'),
        headerBtnText: btn.textContent.trim(),
        canvasBtnText: document.getElementById('canvas-fullscreen-btn')?.textContent?.trim(),
        sidebarToggleHidden: document.getElementById('btn-toggle-sidebar')?.hidden
      };
    })()`);
    console.log('Enter fullscreen result:', JSON.stringify(fsEnterResult, null, 2));

    assert.strictEqual(fsEnterResult.isActive, true, 'Fullscreen must be active');
    assert.strictEqual(fsEnterResult.docHasClass, true, 'html must have workspace-fullscreen class');
    assert.strictEqual(fsEnterResult.headerBtnText, 'Exit full screen', 'Header button text must be Exit full screen');
    assert.strictEqual(fsEnterResult.canvasBtnText, 'Exit full screen', 'Canvas button text must be Exit full screen');
    assert.strictEqual(fsEnterResult.sidebarToggleHidden, false, 'Sidebar toggle button must be visible in fullscreen');

    // Wait for resize synchronization
    await sleep(400);

    // Check 4: Fullscreen canvas dimensions
    const fsDims = await client.eval(`(() => {
      const canvas = document.getElementById('canvas');
      const stage = window.reviewWorkspace?.getStage?.();
      const rect = canvas.getBoundingClientRect();
      return {
        canvasWidth: Math.round(rect.width),
        canvasHeight: Math.round(rect.height),
        stageWidth: stage ? Math.round(stage.width()) : null,
        stageHeight: stage ? Math.round(stage.height()) : null
      };
    })()`);
    console.log('Fullscreen dimensions:', JSON.stringify(fsDims, null, 2));

    assert(fsDims.canvasHeight > normalDims.canvasHeight, `Fullscreen canvas height (${fsDims.canvasHeight}) must be greater than normal height (${normalDims.canvasHeight})`);
    assert.strictEqual(fsDims.stageHeight, fsDims.canvasHeight, 'Konva stage height must match fullscreen canvas height');

    // Capture screenshot in split fullscreen mode
    const shotSplit = await client.send('Page.captureScreenshot', { format: 'png' });
    const shotSplitPath = path.resolve('.temp/test-fullscreen-split.png');
    fs.writeFileSync(shotSplitPath, Buffer.from(shotSplit.data, 'base64'));
    console.log('Saved fullscreen split screenshot:', shotSplitPath);

    // Check 5: Toggle sidebar collapse (Canvas-only mode)
    console.log('\n--- Collapsing Sidebar for 100% Canvas Mode ---');
    const collapseResult = await client.eval(`(() => {
      const toggle = document.getElementById('btn-toggle-sidebar');
      toggle.click();
      const grid = document.querySelector('.grid');
      const sidebar = document.querySelector('.sidebar');
      return {
        isCollapsed: grid.classList.contains('sidebar-collapsed'),
        toggleText: toggle.textContent.trim(),
        sidebarDisplay: window.getComputedStyle(sidebar).display
      };
    })()`);
    console.log('Collapse sidebar result:', JSON.stringify(collapseResult, null, 2));

    assert.strictEqual(collapseResult.isCollapsed, true, 'Grid must have sidebar-collapsed class');
    assert.strictEqual(collapseResult.toggleText, 'Show panel', 'Toggle text must be Show panel');
    assert.strictEqual(collapseResult.sidebarDisplay, 'none', 'Sidebar display must be none');

    await sleep(400);

    const canvasOnlyDims = await client.eval(`(() => {
      const canvas = document.getElementById('canvas');
      const stage = window.reviewWorkspace?.getStage?.();
      const rect = canvas.getBoundingClientRect();
      return {
        canvasWidth: Math.round(rect.width),
        stageWidth: stage ? Math.round(stage.width()) : null
      };
    })()`);
    console.log('Canvas-only full width dimensions:', JSON.stringify(canvasOnlyDims, null, 2));

    assert(canvasOnlyDims.canvasWidth > fsDims.canvasWidth, `Canvas width in canvas-only mode (${canvasOnlyDims.canvasWidth}) must be wider than split mode (${fsDims.canvasWidth})`);
    assert.strictEqual(canvasOnlyDims.stageWidth, canvasOnlyDims.canvasWidth, 'Konva stage must resize to 100% canvas width');

    // Capture screenshot in canvas-only fullscreen mode
    const shotCanvas = await client.send('Page.captureScreenshot', { format: 'png' });
    const shotCanvasPath = path.resolve('.temp/test-fullscreen-canvas-only.png');
    fs.writeFileSync(shotCanvasPath, Buffer.from(shotCanvas.data, 'base64'));
    console.log('Saved fullscreen canvas-only screenshot:', shotCanvasPath);

    // Check 6: Restore sidebar
    console.log('\n--- Restoring Sidebar ---');
    await client.eval(`document.getElementById('btn-toggle-sidebar')?.click()`);
    await sleep(200);

    // Check 7: Exit fullscreen via canvas view-tools button
    console.log('\n--- Exiting Fullscreen Mode via Canvas Button ---');
    const exitResult = await client.eval(`(() => {
      const btn = document.getElementById('canvas-fullscreen-btn');
      btn.click();
      return {
        isActive: window.workspaceFullscreen.isActive(),
        docHasClass: document.documentElement.classList.contains('workspace-fullscreen'),
        headerBtnText: document.getElementById('btn-fullscreen')?.textContent?.trim(),
        canvasBtnText: btn.textContent.trim(),
        sidebarToggleHidden: document.getElementById('btn-toggle-sidebar')?.hidden
      };
    })()`);
    console.log('Exit fullscreen result:', JSON.stringify(exitResult, null, 2));

    assert.strictEqual(exitResult.isActive, false, 'Fullscreen must not be active');
    assert.strictEqual(exitResult.docHasClass, false, 'html must not have workspace-fullscreen class');
    assert.strictEqual(exitResult.headerBtnText, 'Full screen', 'Header button must revert to Full screen');
    assert.strictEqual(exitResult.canvasBtnText, 'Full screen', 'Canvas button must revert to Full screen');
    assert.strictEqual(exitResult.sidebarToggleHidden, true, 'Sidebar toggle must be hidden outside fullscreen');

    // Check 8: Test keyboard shortcut Shift+F
    console.log('\n--- Testing Keyboard Shortcut Shift+F ---');
    const shortcutEnter = await client.eval(`(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', shiftKey: true, bubbles: true }));
      return {
        isActive: window.workspaceFullscreen.isActive()
      };
    })()`);
    console.log('Shortcut Shift+F enter result:', JSON.stringify(shortcutEnter));
    assert.strictEqual(shortcutEnter.isActive, true, 'Shift+F must enter fullscreen');

    // Check 9: Test keyboard shortcut Escape
    console.log('\n--- Testing Keyboard Shortcut Escape ---');
    const shortcutExit = await client.eval(`(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return {
        isActive: window.workspaceFullscreen.isActive()
      };
    })()`);
    console.log('Shortcut Escape exit result:', JSON.stringify(shortcutExit));
    assert.strictEqual(shortcutExit.isActive, false, 'Escape must exit fullscreen');

    console.log('\n================================================================');
    console.log('ALL TESTS FOR FULL SCREEN WORKSPACE MODE PASSED!');
    console.log('================================================================\n');
  } finally {
    chrome.kill('SIGTERM');
  }
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
