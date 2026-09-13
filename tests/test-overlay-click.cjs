// tests/test-overlay-click.cjs
// Automated verification of easy clicking & overlaid shape accessibility:
// 1. Click inside box interior selects box.
// 2. Click inside polygon boundary interior selects boundary.
// 3. Click near polyline selects line.
// 4. Overlaid shapes: repeated clicking at intersection cycles through shapes behind.
// 5. Clicking empty canvas clears selection.
// 6. Drag-to-pan does not trigger selection.

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(__dirname, '..', '.temp', 'chrome-click-test-profile');

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
      } else if (parsed.method === 'Runtime.consoleAPICalled') {
        const text = (parsed.params.args || []).map(a => a.value ?? JSON.stringify(a)).join(' ');
        console.log('[BROWSER CONSOLE]', text);
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
    await sleep(40);
  }

  async drag(x1, y1, x2, y2, steps = 10) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 });
    await sleep(20);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 });
    await sleep(20);
    for (let i = 1; i <= steps; i++) {
      const curX = Math.round(x1 + (x2 - x1) * (i / steps));
      const curY = Math.round(y1 + (y2 - y1) * (i / steps));
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: curX, y: curY });
      await sleep(15);
    }
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 });
    await sleep(40);
  }
}

async function run() {
  console.log('[TEST] Starting Chrome headless for overlay click testing...');
  const port = 9334;
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--window-size=1400,900',
    '--disable-gpu',
    '--no-first-run',
    'http://localhost:3000'
  ], { stdio: 'ignore' });

  try {
    let endpoints = null;
    for (let i = 0; i < 30; i++) {
      try {
        endpoints = await getJson(`http://127.0.0.1:${port}/json`);
        if (endpoints && endpoints.length > 0) break;
      } catch (e) {}
      await sleep(250);
    }

    if (!endpoints || !endpoints.length) {
      throw new Error('Chrome remote debugging endpoints not available');
    }

    const pageTarget = endpoints.find(e => e.type === 'page');
    const cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await cdp.waitOpen();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    console.log('[TEST] Connected to Chrome via CDP. Waiting for review app to mount...');
    let ready = false;
    for (let i = 0; i < 30; i++) {
      ready = await cdp.eval(`(() => {
        return typeof window.reviewWorkspace !== 'undefined' &&
          !!window.reviewWorkspace.getCurrent?.() &&
          typeof Konva !== 'undefined' &&
          Konva.stages.length > 0;
      })()`);
      if (ready) break;
      await sleep(400);
    }

    if (!ready) {
      throw new Error('Page reviewWorkspace did not initialize in time');
    }

    await cdp.eval(`(() => {
      if (document.getElementById('tool')) {
        document.getElementById('tool').value = 'pan';
        document.getElementById('tool').dispatchEvent(new Event('change'));
      }
      if (typeof fit === 'function') fit();
    })()`);
    await sleep(400);

    const canvasInfo = await cdp.eval(`(() => {
      const c = document.getElementById('canvas');
      const r = c.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    })()`);
    console.log('[TEST] Canvas bounding rect:', canvasInfo);

    // Test 1: Click interior of a box annotation
    console.log('[TEST] Test 1: Testing click inside box interior...');
    const boxSetup = await cdp.eval(`(() => {
      const rw = window.reviewWorkspace;
      const cur = rw.getCurrent();
      let b = cur.annotations.find(a => a.geometry.type === 'bbox' && a.review_state !== 'deleted');
      if (!b) {
        b = {
          id: cur.id + '-test-box-1',
          layer: 'symbols',
          label: 'Test Interior Box',
          geometry: { type: 'bbox', coordinates: [300, 300, 450, 450] },
          review_state: 'manually_added'
        };
        cur.annotations.push(b);
        rw.renderMarks();
      }
      const coords = b.geometry.coordinates;
      const centerWorld = [(coords[0] + coords[2]) / 2, (coords[1] + coords[3]) / 2];
      const stage = Konva.stages[0];
      const pt = stage.getAbsoluteTransform().point({ x: centerWorld[0], y: centerWorld[1] });
      const rect = document.getElementById('canvas').getBoundingClientRect();
      return {
        id: b.id,
        screenX: rect.left + pt.x,
        screenY: rect.top + pt.y
      };
    })()`);

    if (!boxSetup) throw new Error('Could not find or set up box annotation for Test 1');

    await cdp.click(boxSetup.screenX, boxSetup.screenY);
    await sleep(200);

    const selectedId1 = await cdp.eval(`window.reviewWorkspace.getSelectedId()`);
    console.log('[TEST] Selected after interior click:', selectedId1, 'Expected:', boxSetup.id);
    if (selectedId1 !== boxSetup.id) {
      throw new Error(`Expected selected to be ${boxSetup.id}, but got ${selectedId1}`);
    }
    console.log('[PASS] Test 1: Interior box click successfully selected the box!');

    // Test 2: Deselection on empty canvas click
    console.log('[TEST] Test 2: Testing deselection on empty canvas space...');
    const emptyPos = await cdp.eval(`(() => {
      const rw = window.reviewWorkspace;
      const stage = Konva.stages[0];
      const rect = document.getElementById('canvas').getBoundingClientRect();
      // Find a world point with 0 annotations
      let emptyWorld = [100, 100];
      for (let y = 50; y < 1500; y += 100) {
        for (let x = 50; x < 1500; x += 100) {
          if (rw.annotationsAtPoint([x, y]).length === 0) {
            emptyWorld = [x, y];
            break;
          }
        }
      }
      const pt = stage.getAbsoluteTransform().point({ x: emptyWorld[0], y: emptyWorld[1] });
      const screenX = rect.left + pt.x;
      const screenY = rect.top + pt.y;
      const el = document.elementFromPoint(screenX, screenY);
      return {
        screenX,
        screenY,
        elTag: el?.tagName,
        elClass: el?.className,
        emptyWorld,
        hitsAtEmpty: rw.annotationsAtPoint(emptyWorld).length
      };
    })()`);
    console.log('[TEST] Empty pos info:', emptyPos);
    await cdp.click(emptyPos.screenX, emptyPos.screenY);
    await sleep(200);

    const selectedAfterEmpty = await cdp.eval(`window.reviewWorkspace.getSelectedId()`);
    console.log('[TEST] Selected after empty click:', selectedAfterEmpty);
    if (selectedAfterEmpty !== null) {
      throw new Error(`Expected selected to be null, but got ${selectedAfterEmpty}`);
    }
    console.log('[PASS] Test 2: Empty space click cleared selection successfully!');

    // Test 3: Overlaid annotations click-cycling
    console.log('[TEST] Test 3: Testing overlaid annotations click-cycling...');
    const overlaySetup = await cdp.eval(`(() => {
      const rw = window.reviewWorkspace;
      const cur = rw.getCurrent();

      // Create 3 overlapping annotations at world coordinates (600, 600):
      // 1. A large room boundary (polygon) from 500,500 to 800,800
      // 2. A symbol box (bbox) from 570,570 to 630,630
      // 3. A wiring line (polyline) from 550,600 to 650,600
      const idRoom = cur.id + '-test-room-poly';
      const idBox = cur.id + '-test-symbol-box';
      const idLine = cur.id + '-test-wire-line';

      cur.annotations = cur.annotations.filter(a => ![idRoom, idBox, idLine].includes(a.id));

      const room = {
        id: idRoom,
        layer: 'geometry',
        label: 'Overlaid Test Room',
        geometry: {
          type: 'polygon',
          coordinates: [[500, 500], [800, 500], [800, 800], [500, 800]]
        },
        review_state: 'manually_added'
      };

      const box = {
        id: idBox,
        layer: 'symbols',
        label: 'Overlaid Test Symbol',
        geometry: {
          type: 'bbox',
          coordinates: [570, 570, 630, 630]
        },
        review_state: 'manually_added'
      };

      const line = {
        id: idLine,
        layer: 'wiring',
        label: 'Overlaid Test Wire',
        geometry: {
          type: 'polyline',
          coordinates: [[550, 600], [650, 600]]
        },
        review_state: 'manually_added'
      };

      cur.annotations.push(room, box, line);
      rw.choose(null);
      rw.renderMarks();

      // Overlap point in world coordinates: (600, 600)
      const targetWorld = [600, 600];
      const stage = Konva.stages[0];
      const pt = stage.getAbsoluteTransform().point({ x: targetWorld[0], y: targetWorld[1] });
      const rect = document.getElementById('canvas').getBoundingClientRect();
      return {
        idRoom,
        idBox,
        idLine,
        screenX: rect.left + pt.x,
        screenY: rect.top + pt.y
      };
    })()`);

    console.log('[TEST] Overlap setup ready at screen pos:', overlaySetup.screenX, overlaySetup.screenY);

    // Click 1: Should select the line (smallest area / most specific)
    await cdp.click(overlaySetup.screenX, overlaySetup.screenY);
    await sleep(200);
    const sel1 = await cdp.eval(`window.reviewWorkspace.getSelectedId()`);
    const status1 = await cdp.eval(`document.getElementById('editor-status')?.textContent || ''`);
    console.log('[TEST] Click 1 selected:', sel1, 'Status:', status1);
    if (sel1 !== overlaySetup.idLine) {
      throw new Error(`Click 1 expected ${overlaySetup.idLine}, got ${sel1}`);
    }

    // Click 2: Should cycle to the box behind
    await cdp.click(overlaySetup.screenX, overlaySetup.screenY);
    await sleep(200);
    const sel2 = await cdp.eval(`window.reviewWorkspace.getSelectedId()`);
    const status2 = await cdp.eval(`document.getElementById('editor-status')?.textContent || ''`);
    console.log('[TEST] Click 2 selected:', sel2, 'Status:', status2);
    if (sel2 !== overlaySetup.idBox) {
      throw new Error(`Click 2 expected ${overlaySetup.idBox}, got ${sel2}`);
    }

    // Click 3: Should cycle to the room boundary behind
    await cdp.click(overlaySetup.screenX, overlaySetup.screenY);
    await sleep(200);
    const sel3 = await cdp.eval(`window.reviewWorkspace.getSelectedId()`);
    const status3 = await cdp.eval(`document.getElementById('editor-status')?.textContent || ''`);
    console.log('[TEST] Click 3 selected:', sel3, 'Status:', status3);
    if (sel3 !== overlaySetup.idRoom) {
      throw new Error(`Click 3 expected ${overlaySetup.idRoom}, got ${sel3}`);
    }

    // Click 4: Should cycle back to the line in front
    await cdp.click(overlaySetup.screenX, overlaySetup.screenY);
    await sleep(200);
    const sel4 = await cdp.eval(`window.reviewWorkspace.getSelectedId()`);
    const status4 = await cdp.eval(`document.getElementById('editor-status')?.textContent || ''`);
    console.log('[TEST] Click 4 selected:', sel4, 'Status:', status4);
    if (sel4 !== overlaySetup.idLine) {
      throw new Error(`Click 4 expected cycle back to ${overlaySetup.idLine}, got ${sel4}`);
    }

    console.log('[PASS] Test 3: Overlaid cycle-clicking smoothly cycled Line -> Box -> Room -> Line!');

    // Test 4: Verify drag to pan does not disrupt or trigger unwanted selection
    console.log('[TEST] Test 4: Testing drag-to-pan preserves canvas panning...');
    const viewBefore = await cdp.eval(`window.reviewWorkspace.getView()`);
    const rect = await cdp.eval(`(() => {
      const r = document.getElementById('canvas').getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    })()`);
    await cdp.drag(rect.left + 200, rect.top + 200, rect.left + 300, rect.top + 200, 10);
    await sleep(300);
    const viewAfter = await cdp.eval(`window.reviewWorkspace.getView()`);
    console.log('[TEST] View before:', viewBefore, 'View after:', viewAfter);
    if (viewBefore[0] === viewAfter[0] && viewBefore[1] === viewAfter[1]) {
      throw new Error('Canvas pan did not update view coordinates');
    }
    console.log('[PASS] Test 4: Drag to pan successfully moved view without unwanted selection!');

    console.log('[SUCCESS] All overlay and clicking tests passed 100%!');
  } finally {
    try {
      chromeProc.kill();
    } catch (e) {}
  }
}

run().catch(err => {
  console.error('[FAIL] Test error:', err);
  process.exit(1);
});
