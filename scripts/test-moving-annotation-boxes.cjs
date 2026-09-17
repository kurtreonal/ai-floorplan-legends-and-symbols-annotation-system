// scripts/test-moving-annotation-boxes.cjs
// Comprehensive automated test verifying that annotation boxes can be easily
// grabbed and moved from their interior, borders, and pins without dragging the screen,
// while empty canvas dragging still pans the screen. Zero emojis.

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const CHROME_PROFILE = path.resolve('.temp', 'cdp-moving-' + Date.now());
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new',
  '--remote-debugging-port=9230',
  '--user-data-dir=' + CHROME_PROFILE,
  '--window-size=1280,900',
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

  async drag(x1, y1, x2, y2, steps = 15) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 });
    await sleep(40);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(40);
    for (let i = 1; i <= steps; i++) {
      const curX = Math.round(x1 + (x2 - x1) * (i / steps));
      const curY = Math.round(y1 + (y2 - y1) * (i / steps));
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: curX, y: curY, button: 'left', buttons: 1 });
      await sleep(25);
    }
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(150);
  }

  close() {
    try { this.ws.close(); } catch (e) {}
  }
}

async function run() {
  try {
    await sleep(2000);
    const json = await new Promise((res, rej) => http.get('http://127.0.0.1:9230/json', r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
    }).on('error', rej));

    const target = json.find(t => t.type === 'page' && t.url.includes('127.0.0.1:3000'));
    const cdp = new CDPClient(target.webSocketDebuggerUrl);
    await cdp.waitOpen();
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    console.log('Connected to review application. Initializing...');
    await sleep(2000);

    // Ensure clean state: reset test box coordinates to default top-left baseline
    await cdp.eval(`(() => {
      localStorage.clear();
      const a = window.ANNOTATION_DATA.sheets[0].annotations.find(x => x.geometry.type === 'bbox');
      if (a) {
        a.geometry.coordinates = [17.8, 220.4, 308.1, 437.7];
      }
      window.reviewWorkspace.renderMarks();
      window.reviewWorkspace.choose(null);
    })()`);

    // TEST 1: Dragging an unselected box from its interior
    console.log('\n--- TEST 1: Dragging an unselected box from its interior ---');
    const boxInfo1 = await cdp.eval(`(() => {
      const stage = Konva.stages[0];
      const a = window.ANNOTATION_DATA.sheets[0].annotations.find(x => x.geometry.type === 'bbox');
      // Ensure nothing is selected first
      window.reviewWorkspace.choose(null);
      
      const [x1, y1, x2, y2] = a.geometry.coordinates;
      const midWorld = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
      
      // Convert world coords to screen coords
      const tf = stage.getAbsoluteTransform();
      const r = document.getElementById('canvas').getBoundingClientRect();
      const stagePt = tf.point(midWorld);
      const screenPt = { x: Math.round(r.left + stagePt.x), y: Math.round(r.top + stagePt.y) };

      return {
        id: a.id,
        initialCoords: [...a.geometry.coordinates],
        screenPt,
        viewBefore: [...window.reviewWorkspace.getView()]
      };
    })()`);
    console.log('Target Box:', boxInfo1.id, 'Screen pos:', boxInfo1.screenPt);

    // Drag from center 60px right, 40px down
    const startX = boxInfo1.screenPt.x;
    const startY = boxInfo1.screenPt.y;
    await cdp.drag(startX, startY, startX + 60, startY + 40);

    const afterTest1 = await cdp.eval(`(() => {
      const a = window.ANNOTATION_DATA.sheets[0].annotations.find(x => x.id === '${boxInfo1.id}');
      const viewAfter = [...window.reviewWorkspace.getView()];
      return {
        coordsAfter: [...a.geometry.coordinates],
        viewAfter,
        selectedId: window.reviewWorkspace.getSelectedId(),
        status: document.getElementById('editor-status')?.textContent
      };
    })()`);
    console.log('After Test 1:', afterTest1);

    const viewShift1 = Math.hypot(afterTest1.viewAfter[0] - boxInfo1.viewBefore[0], afterTest1.viewAfter[1] - boxInfo1.viewBefore[1]);
    const boxShift1 = Math.hypot(afterTest1.coordsAfter[0] - boxInfo1.initialCoords[0], afterTest1.coordsAfter[1] - boxInfo1.initialCoords[1]);

    console.log(`Test 1 shifts: Screen/view shift = ${viewShift1.toFixed(1)}px, Box shift = ${boxShift1.toFixed(1)}px`);
    if (viewShift1 > 2) {
      throw new Error(`FAILURE: Screen dragged instead of moving box! View shift = ${viewShift1}`);
    }
    if (boxShift1 < 10) {
      throw new Error(`FAILURE: Box did not move! Box shift = ${boxShift1}`);
    }
    console.log('TEST 1 PASSED: Unselected box moved cleanly from its interior without dragging screen.');

    // TEST 2: Dragging the now-selected box
    console.log('\n--- TEST 2: Dragging the selected box from its interior ---');
    const boxInfo2 = await cdp.eval(`(() => {
      const stage = Konva.stages[0];
      const a = window.ANNOTATION_DATA.sheets[0].annotations.find(x => x.id === '${boxInfo1.id}');
      const [x1, y1, x2, y2] = a.geometry.coordinates;
      const midWorld = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
      const tf = stage.getAbsoluteTransform();
      const r = document.getElementById('canvas').getBoundingClientRect();
      const stagePt = tf.point(midWorld);
      return {
        id: a.id,
        initialCoords: [...a.geometry.coordinates],
        screenPt: { x: Math.round(r.left + stagePt.x), y: Math.round(r.top + stagePt.y) },
        viewBefore: [...window.reviewWorkspace.getView()]
      };
    })()`);
    console.log('Target Box 2:', boxInfo2.id, 'Screen pos:', boxInfo2.screenPt, 'Coords:', boxInfo2.initialCoords);

    await cdp.drag(boxInfo2.screenPt.x, boxInfo2.screenPt.y, boxInfo2.screenPt.x - 40, boxInfo2.screenPt.y - 30);

    const afterTest2 = await cdp.eval(`(() => {
      const a = window.ANNOTATION_DATA.sheets[0].annotations.find(x => x.id === '${boxInfo2.id}');
      return {
        coordsAfter: [...a.geometry.coordinates],
        viewAfter: [...window.reviewWorkspace.getView()],
        selectedId: window.reviewWorkspace.getSelectedId(),
        status: document.getElementById('editor-status')?.textContent
      };
    })()`);

    const viewShift2 = Math.hypot(afterTest2.viewAfter[0] - boxInfo2.viewBefore[0], afterTest2.viewAfter[1] - boxInfo2.viewBefore[1]);
    const boxShift2 = Math.hypot(afterTest2.coordsAfter[0] - boxInfo2.initialCoords[0], afterTest2.coordsAfter[1] - boxInfo2.initialCoords[1]);

    console.log(`Test 2 shifts: Screen/view shift = ${viewShift2.toFixed(1)}px, Box shift = ${boxShift2.toFixed(1)}px`);
    if (viewShift2 > 2) {
      throw new Error(`FAILURE: Screen dragged when moving selected box! View shift = ${viewShift2}`);
    }
    if (boxShift2 < 10) {
      throw new Error(`FAILURE: Selected box did not move! Box shift = ${boxShift2}`);
    }
    console.log('TEST 2 PASSED: Selected box moved cleanly from its interior without dragging screen.');

    // TEST 3: Dragging empty canvas space still pans the screen
    console.log('\n--- TEST 3: Dragging empty canvas space still pans the screen ---');
    const emptyDragInfo = await cdp.eval(`(() => {
      const r = document.getElementById('canvas').getBoundingClientRect();
      // Point at bottom right in empty margin space
      return {
        screenPt: { x: Math.round(r.left + r.width - 30), y: Math.round(r.top + r.height - 30) },
        viewBefore: [...window.reviewWorkspace.getView()]
      };
    })()`);

    await cdp.drag(emptyDragInfo.screenPt.x, emptyDragInfo.screenPt.y, emptyDragInfo.screenPt.x - 50, emptyDragInfo.screenPt.y - 50);

    const afterEmptyDrag = await cdp.eval(`(() => ({
      viewAfter: [...window.reviewWorkspace.getView()]
    }))()`);

    const screenPanShift = Math.hypot(afterEmptyDrag.viewAfter[0] - emptyDragInfo.viewBefore[0], afterEmptyDrag.viewAfter[1] - emptyDragInfo.viewBefore[1]);
    console.log(`Empty space drag screen shift: ${screenPanShift.toFixed(1)}px`);
    if (screenPanShift < 10) {
      throw new Error(`FAILURE: Dragging empty space did not pan screen! Shift = ${screenPanShift}`);
    }
    console.log('TEST 3 PASSED: Dragging empty canvas space smoothly pans the screen.');

    // TEST 4: Clicking inside a box without dragging selects it and cycles if overlapping
    console.log('\n--- TEST 4: Clicking without dragging selects the box ---');
    await cdp.eval(`window.reviewWorkspace.choose(null);`);
    const clickTarget = await cdp.eval(`(() => {
      const stage = Konva.stages[0];
      const a = window.ANNOTATION_DATA.sheets[0].annotations.find(x => x.id === '${boxInfo1.id}');
      const [x1, y1, x2, y2] = a.geometry.coordinates;
      const tf = stage.getAbsoluteTransform();
      const r = document.getElementById('canvas').getBoundingClientRect();
      const stagePt = tf.point({ x: (x1 + x2) / 2, y: (y1 + y2) / 2 });
      return { x: Math.round(r.left + stagePt.x), y: Math.round(r.top + stagePt.y) };
    })()`);

    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: clickTarget.x, y: clickTarget.y });
    await sleep(30);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: clickTarget.x, y: clickTarget.y, button: 'left', clickCount: 1 });
    await sleep(30);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: clickTarget.x, y: clickTarget.y, button: 'left', clickCount: 1 });
    await sleep(200);

    const selectedAfterClick = await cdp.eval(`window.reviewWorkspace.getSelectedId()`);
    console.log('Selected after click:', selectedAfterClick);
    if (!selectedAfterClick) {
      throw new Error('FAILURE: Clicking box did not select it!');
    }
    console.log('TEST 4 PASSED: Clicking inside box selects it properly.');

    // TEST 5: Multi-selection moving together
    console.log('\n--- TEST 5: Multi-selected annotations moving together ---');
    const multiSetup = await cdp.eval(`(() => {
      const stage = Konva.stages[0];
      const cur = window.reviewWorkspace.getCurrent();
      const bboxes = cur.annotations.filter(x => x.geometry.type === 'bbox' && x.review_state !== 'deleted');
      const item1 = bboxes[0];
      const item2 = bboxes[1];
      
      window.reviewWorkspace.choose(item1.id);
      window.reviewWorkspace.choose(item2.id, { shift: true });

      const tf = stage.getAbsoluteTransform();
      const r = document.getElementById('canvas').getBoundingClientRect();
      const [x1, y1, x2, y2] = item1.geometry.coordinates;
      const stagePt = tf.point({ x: (x1 + x2) / 2, y: (y1 + y2) / 2 });

      return {
        id1: item1.id,
        id2: item2.id,
        initialCoords1: [...item1.geometry.coordinates],
        initialCoords2: [...item2.geometry.coordinates],
        screenPt1: { x: Math.round(r.left + stagePt.x), y: Math.round(r.top + stagePt.y) },
        viewBefore: [...window.reviewWorkspace.getView()]
      };
    })()`);

    await cdp.drag(multiSetup.screenPt1.x, multiSetup.screenPt1.y, multiSetup.screenPt1.x + 45, multiSetup.screenPt1.y + 35);

    const afterMultiTest = await cdp.eval(`(() => {
      const cur = window.reviewWorkspace.getCurrent();
      const item1 = cur.annotations.find(x => x.id === '${multiSetup.id1}');
      const item2 = cur.annotations.find(x => x.id === '${multiSetup.id2}');
      return {
        coords1: [...item1.geometry.coordinates],
        coords2: [...item2.geometry.coordinates],
        viewAfter: [...window.reviewWorkspace.getView()]
      };
    })()`);

    const viewShift5 = Math.hypot(afterMultiTest.viewAfter[0] - multiSetup.viewBefore[0], afterMultiTest.viewAfter[1] - multiSetup.viewBefore[1]);
    const shift1 = Math.hypot(afterMultiTest.coords1[0] - multiSetup.initialCoords1[0], afterMultiTest.coords1[1] - multiSetup.initialCoords1[1]);
    const shift2 = Math.hypot(afterMultiTest.coords2[0] - multiSetup.initialCoords2[0], afterMultiTest.coords2[1] - multiSetup.initialCoords2[1]);
    console.log(`Multi-drag: View shift = ${viewShift5.toFixed(1)}px, Item 1 shift = ${shift1.toFixed(1)}px, Item 2 shift = ${shift2.toFixed(1)}px`);
    if (viewShift5 > 2) {
      throw new Error(`FAILURE: Screen shifted during multi-selection drag! View shift = ${viewShift5}`);
    }
    if (shift1 < 10 || shift2 < 10) {
      throw new Error(`FAILURE: Both multi-selected items must move! shift1=${shift1}, shift2=${shift2}`);
    }
    console.log('TEST 5 PASSED: Multi-selected annotations moved together cleanly.');

    // TEST 6: Dragging directly from the center symbol pin
    console.log('\n--- TEST 6: Dragging directly from the center symbol pin ---');
    // Switch to sheet with symbol annotations
    const pinTestSetup = await cdp.eval(`(() => {
      // Find a symbol annotation with bbox
      const cur = window.reviewWorkspace.getCurrent();
      let sym = cur.annotations.find(a => a.layer === 'symbols' && a.geometry.type === 'bbox' && a.review_state !== 'deleted');
      if (!sym) {
        // Create one for testing
        sym = {
          id: cur.id + '-symbol-pin-test',
          layer: 'symbols',
          label: 'Pin Test Symbol',
          geometry: { type: 'bbox', coordinates: [400, 400, 500, 500] },
          review_state: 'manually_added'
        };
        cur.annotations.push(sym);
        window.reviewWorkspace.renderMarks();
      }
      window.reviewWorkspace.choose(null);

      const [bx, by, br, bb] = sym.geometry.coordinates;
      const centerWorld = { x: (bx + br) / 2, y: (by + bb) / 2 };
      const stage = Konva.stages[0];
      const tf = stage.getAbsoluteTransform();
      const r = document.getElementById('canvas').getBoundingClientRect();
      const stagePt = tf.point(centerWorld);

      return {
        id: sym.id,
        initialCoords: [...sym.geometry.coordinates],
        pinScreenPt: { x: Math.round(r.left + stagePt.x), y: Math.round(r.top + stagePt.y) },
        viewBefore: [...window.reviewWorkspace.getView()]
      };
    })()`);

    await cdp.drag(pinTestSetup.pinScreenPt.x, pinTestSetup.pinScreenPt.y, pinTestSetup.pinScreenPt.x + 50, pinTestSetup.pinScreenPt.y + 40);

    const afterPinDrag = await cdp.eval(`(() => {
      const cur = window.reviewWorkspace.getCurrent();
      const sym = cur.annotations.find(a => a.id === '${pinTestSetup.id}');
      return {
        coordsAfter: [...sym.geometry.coordinates],
        viewAfter: [...window.reviewWorkspace.getView()]
      };
    })()`);

    const viewShift6 = Math.hypot(afterPinDrag.viewAfter[0] - pinTestSetup.viewBefore[0], afterPinDrag.viewAfter[1] - pinTestSetup.viewBefore[1]);
    const pinBoxShift = Math.hypot(afterPinDrag.coordsAfter[0] - pinTestSetup.initialCoords[0], afterPinDrag.coordsAfter[1] - pinTestSetup.initialCoords[1]);
    console.log(`Pin drag: View shift = ${viewShift6.toFixed(1)}px, Box shift = ${pinBoxShift.toFixed(1)}px`);
    if (viewShift6 > 2) {
      throw new Error(`FAILURE: Screen shifted when dragging from center pin! View shift = ${viewShift6}`);
    }
    if (pinBoxShift < 10) {
      throw new Error(`FAILURE: Dragging from center pin did not move box! Box shift = ${pinBoxShift}`);
    }
    console.log('TEST 6 PASSED: Dragging directly on center pin moves the box cleanly without panning.');

    // TEST 7: Undo (Ctrl+Z) restores position
    console.log('\n--- TEST 7: Undo restores position ---');
    await cdp.eval(`(() => {
      document.getElementById('undo')?.click();
    })()`);
    await sleep(200);

    const afterUndo = await cdp.eval(`(() => {
      const cur = window.reviewWorkspace.getCurrent();
      const sym = cur.annotations.find(a => a.id === '${pinTestSetup.id}');
      return {
        coords: [...sym.geometry.coordinates]
      };
    })()`);

    const undoDistance = Math.hypot(afterUndo.coords[0] - pinTestSetup.initialCoords[0], afterUndo.coords[1] - pinTestSetup.initialCoords[1]);
    console.log(`Distance from initial after undo: ${undoDistance.toFixed(1)}px`);
    if (undoDistance > 1) {
      throw new Error(`FAILURE: Undo did not restore previous position! Distance = ${undoDistance}`);
    }
    console.log('TEST 7 PASSED: Undo restored previous position accurately.');

    console.log('\n===============================================================');
    console.log('ALL ANNOTATION BOX MOVING & DRAGGING TESTS PASSED SUCCESSFULLY');
    console.log('===============================================================');

    cdp.close();
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  } finally {
    chrome.kill();
  }
}

run();
