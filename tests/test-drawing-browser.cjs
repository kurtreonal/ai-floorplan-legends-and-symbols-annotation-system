// scripts/test-drawing-browser.cjs
// Automated end-to-end browser verification of drawing functions:
// - Draw box
// - Draw line
// - Draw boundary
// Uses Chrome headless + CDP via Node 22 native WebSocket and real CDP Input events.

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(__dirname, '..', '.temp', 'chrome-test-profile');
const SCREENSHOT_PATH = path.join(__dirname, '..', '.temp', 'drawing-test-result.png');

if (!fs.existsSync(path.dirname(TEMP_USER_DATA))) {
  fs.mkdirSync(path.dirname(TEMP_USER_DATA), { recursive: true });
}

async function sleep(ms) {
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
    this.events = [];
    this.ws.onmessage = msg => {
      const parsed = JSON.parse(msg.data);
      if (parsed.id && this.callbacks.has(parsed.id)) {
        const { resolve, reject } = this.callbacks.get(parsed.id);
        this.callbacks.delete(parsed.id);
        if (parsed.error) reject(parsed.error);
        else resolve(parsed.result);
      } else if (parsed.method) {
        this.events.push(parsed);
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

  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await sleep(20);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(30);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(20);
  }

  async drag(x1, y1, x2, y2, steps = 10) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 });
    await sleep(30);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 });
    await sleep(30);
    for (let i = 1; i <= steps; i++) {
      const curX = Math.round(x1 + (x2 - x1) * (i / steps));
      const curY = Math.round(y1 + (y2 - y1) * (i / steps));
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: curX, y: curY, button: 'left' });
      await sleep(20);
    }
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 });
    await sleep(50);
  }

  close() {
    try { this.ws.close(); } catch (e) {}
  }
}

async function run() {
  console.log('Starting headless Chrome...');
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
    'http://127.0.0.1:3000/review.html'
  ], { stdio: 'ignore' });

  try {
    let targets = null;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      try {
        targets = await getJson('http://127.0.0.1:9222/json');
        if (targets && targets.length > 0) break;
      } catch (e) {}
    }

    if (!targets || !targets.length) {
      throw new Error('Could not connect to Chrome DevTools Protocol');
    }

    const pageTarget = targets.find(t => t.type === 'page' && t.url.includes('3000')) || targets[0];
    console.log('Connected to target:', pageTarget.title || pageTarget.url);

    const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.waitOpen();

    await client.send('Runtime.enable');
    await client.send('Page.enable');
    await client.send('DOM.enable');

    console.log('Waiting for stage and data to initialize...');
    let ready = false;
    for (let i = 0; i < 20; i++) {
      ready = await client.eval(`
        typeof window.reviewWorkspace !== 'undefined' &&
        !!window.reviewWorkspace.getCurrent?.() &&
        typeof Konva !== 'undefined' &&
        Konva.stages.length > 0
      `);
      if (ready) break;
      await sleep(500);
    }

    if (!ready) {
      throw new Error('Page did not initialize in time');
    }

    console.log('Page initialized successfully.');

    // 1. Initial State Check
    const initialCount = await client.eval(`window.reviewWorkspace.getCurrent().annotations.length`);
    console.log(`Initial annotations on active sheet: ${initialCount}`);

    // Get canvas bounding box
    const canvasRect = await client.eval(`
      (() => {
        const r = document.getElementById('canvas').getBoundingClientRect();
        return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
      })()
    `);
    console.log('Canvas Rect:', canvasRect);

    // 2. Test "Draw box"
    console.log('\n--- Testing Draw Box ---');
    await client.eval(`
      document.getElementById('tool').value = 'box';
      document.getElementById('tool').dispatchEvent(new Event('change'));
    `);
    const boxStatus = await client.eval(`document.getElementById('editor-status').textContent`);
    console.log('Status after selecting Draw box:', boxStatus);

    const boxStartX = canvasRect.left + Math.round(canvasRect.width * 0.4);
    const boxStartY = canvasRect.top + Math.round(canvasRect.height * 0.4);
    const boxEndX = boxStartX + 100;
    const boxEndY = boxStartY + 80;

    console.log(`Dragging box from (${boxStartX}, ${boxStartY}) to (${boxEndX}, ${boxEndY})...`);
    await client.drag(boxStartX, boxStartY, boxEndX, boxEndY);
    await sleep(200);

    const boxResult = await client.eval(`
      (() => {
        const current = window.reviewWorkspace.getCurrent();
        const latest = current.annotations[current.annotations.length - 1];
        return {
          totalCount: current.annotations.length,
          latestType: latest?.geometry?.type,
          latestCoords: latest?.geometry?.coordinates,
          latestId: latest?.id
        };
      })()
    `);
    console.log('Draw box result:', boxResult);
    if (boxResult.totalCount !== initialCount + 1 || boxResult.latestType !== 'bbox') {
      throw new Error(`Box creation failed! Expected bbox, got ${JSON.stringify(boxResult)}`);
    }
    console.log('Draw box test: PASSED (New bounding box annotation created and added to list)');

    // 3. Test "Draw line"
    console.log('\n--- Testing Draw Line ---');
    await client.eval(`
      document.getElementById('tool').value = 'polyline';
      document.getElementById('tool').dispatchEvent(new Event('change'));
    `);
    const lineStatus = await client.eval(`document.getElementById('editor-status').textContent`);
    console.log('Status after selecting Draw line:', lineStatus);

    const lineP1 = { x: canvasRect.left + 150, y: canvasRect.top + 150 };
    const lineP2 = { x: lineP1.x + 90, y: lineP1.y + 60 };
    const lineP3 = { x: lineP2.x + 90, y: lineP2.y - 30 };

    console.log('Clicking line points...');
    await client.click(lineP1.x, lineP1.y);
    const p1_len = await client.eval(`window.reviewWorkspace.getDrawing().length`);
    console.log('After P1, drawing length:', p1_len, await client.eval(`document.getElementById('editor-status').textContent`));
    await sleep(400);

    await client.click(lineP2.x, lineP2.y);
    const p2_len = await client.eval(`window.reviewWorkspace.getDrawing().length`);
    console.log('After P2, drawing length:', p2_len, await client.eval(`document.getElementById('editor-status').textContent`));
    await sleep(400);

    await client.click(lineP3.x, lineP3.y);
    const p3_len = await client.eval(`window.reviewWorkspace.getDrawing().length`);
    console.log('After P3, drawing length:', p3_len, await client.eval(`document.getElementById('editor-status').textContent`));
    await sleep(400);

    console.log('Clicking Finish drawing button...');
    await client.eval(`document.getElementById('finish').click();`);
    await sleep(200);

    const lineResult = await client.eval(`
      (() => {
        const current = window.reviewWorkspace.getCurrent();
        const latest = current.annotations[current.annotations.length - 1];
        return {
          totalCount: current.annotations.length,
          latestType: latest?.geometry?.type,
          pointCount: latest?.geometry?.coordinates?.length,
          latestCoords: latest?.geometry?.coordinates,
          latestId: latest?.id
        };
      })()
    `);
    console.log('Draw line result:', lineResult);
    if (lineResult.totalCount !== initialCount + 2 || lineResult.latestType !== 'polyline' || lineResult.pointCount !== 3) {
      throw new Error(`Line creation failed! Expected polyline with 3 points, got ${JSON.stringify(lineResult)}`);
    }
    console.log('Draw line test: PASSED (New polyline annotation created with 3 vertices)');

    // 4. Test "Draw boundary"
    console.log('\n--- Testing Draw Boundary ---');
    await client.eval(`
      document.getElementById('tool').value = 'polygon';
      document.getElementById('tool').dispatchEvent(new Event('change'));
    `);
    const boundaryStatus = await client.eval(`document.getElementById('editor-status').textContent`);
    console.log('Status after selecting Draw boundary:', boundaryStatus);

    const polyP1 = { x: canvasRect.left + Math.round(canvasRect.width * 0.6), y: canvasRect.top + Math.round(canvasRect.height * 0.2) };
    const polyP2 = { x: polyP1.x + 100, y: polyP1.y };
    const polyP3 = { x: polyP1.x + 100, y: polyP1.y + 80 };
    const polyP4 = { x: polyP1.x, y: polyP1.y + 80 };

    console.log('Clicking 4 boundary points...');
    await client.click(polyP1.x, polyP1.y);
    await sleep(350);
    await client.click(polyP2.x, polyP2.y);
    await sleep(350);
    await client.click(polyP3.x, polyP3.y);
    await sleep(350);
    await client.click(polyP4.x, polyP4.y);
    await sleep(350);

    console.log('Clicking Finish drawing button...');
    await client.eval(`document.getElementById('finish').click();`);
    await sleep(200);

    const boundaryResult = await client.eval(`
      (() => {
        const current = window.reviewWorkspace.getCurrent();
        const latest = current.annotations[current.annotations.length - 1];
        return {
          totalCount: current.annotations.length,
          latestType: latest?.geometry?.type,
          pointCount: latest?.geometry?.coordinates?.length,
          latestCoords: latest?.geometry?.coordinates,
          latestId: latest?.id
        };
      })()
    `);
    console.log('Draw boundary result:', boundaryResult);
    if (boundaryResult.totalCount !== initialCount + 3 || boundaryResult.latestType !== 'polygon' || boundaryResult.pointCount !== 4) {
      throw new Error(`Boundary creation failed! Expected polygon with 4 points, got ${JSON.stringify(boundaryResult)}`);
    }
    console.log('Draw boundary test: PASSED (New closed polygon annotation created with 4 vertices)');

    // 5. Test polygon auto-closure by clicking near start point
    console.log('\n--- Testing Boundary Auto-Closure on Starting Point ---');
    await client.eval(`
      document.getElementById('tool').value = 'polygon';
      document.getElementById('tool').dispatchEvent(new Event('change'));
    `);

    const freshRect = await client.eval(`
      (() => {
        const r = document.getElementById('canvas').getBoundingClientRect();
        return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
      })()
    `);
    const closeP1 = { x: freshRect.left + 400, y: freshRect.top + 150 };
    const closeP2 = { x: closeP1.x + 90, y: closeP1.y };
    const closeP3 = { x: closeP1.x + 45, y: closeP1.y + 70 };

    const elAtClose = await client.eval(`
      (() => {
        const el = document.elementFromPoint(${closeP1.x}, ${closeP1.y});
        return { tag: el?.tagName, id: el?.id, className: el?.className };
      })()
    `);
    console.log('Element at closeP1:', elAtClose);

    console.log('Clicking 3 triangle points...');
    await client.click(closeP1.x, closeP1.y);
    console.log('T1 drawing len:', await client.eval(`window.reviewWorkspace.getDrawing().length`), await client.eval(`document.getElementById('editor-status').textContent`));
    await sleep(350);
    await client.click(closeP2.x, closeP2.y);
    console.log('T2 drawing len:', await client.eval(`window.reviewWorkspace.getDrawing().length`), await client.eval(`document.getElementById('editor-status').textContent`));
    await sleep(350);
    await client.click(closeP3.x, closeP3.y);
    console.log('T3 drawing len:', await client.eval(`window.reviewWorkspace.getDrawing().length`), await client.eval(`document.getElementById('editor-status').textContent`));
    await sleep(350);

    console.log('Clicking on start point to close loop...');
    await client.click(closeP1.x, closeP1.y);
    console.log('T4 drawing len:', await client.eval(`window.reviewWorkspace.getDrawing().length`), await client.eval(`document.getElementById('editor-status').textContent`));
    await sleep(300);

    const autoCloseResult = await client.eval(`
      (() => {
        const current = window.reviewWorkspace.getCurrent();
        const latest = current.annotations[current.annotations.length - 1];
        return {
          totalCount: current.annotations.length,
          latestType: latest?.geometry?.type,
          pointCount: latest?.geometry?.coordinates?.length,
          latestCoords: latest?.geometry?.coordinates,
          latestId: latest?.id
        };
      })()
    `);
    console.log('Auto-closure result:', autoCloseResult);
    if (autoCloseResult.totalCount !== initialCount + 4 || autoCloseResult.latestType !== 'polygon' || autoCloseResult.pointCount !== 3) {
      throw new Error(`Auto-closure polygon failed! Got ${JSON.stringify(autoCloseResult)}`);
    }
    console.log('Boundary auto-closure test: PASSED (Closed loop formed automatically upon clicking starting point)');

    // 6. Capture screenshot of the working workbench with newly drawn annotations
    console.log('\nCapturing screenshot of workbench...');
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
    console.log(`Screenshot saved to ${SCREENSHOT_PATH} (${(screenshot.data.length / 1024).toFixed(1)} KB)`);

    client.close();
    console.log('\n======================================================');
    console.log('ALL DRAWING TESTS (BOX, LINE, BOUNDARY) PASSED 100%!');
    console.log('======================================================');
  } finally {
    try {
      chrome.kill();
    } catch (e) {}
  }
}

run().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
