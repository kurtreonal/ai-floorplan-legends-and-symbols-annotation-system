const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_PROFILE = path.resolve('.temp/test-session-absolute-profile');
fs.mkdirSync(TEMP_PROFILE, { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function launchBrowser() {
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--remote-debugging-port=9255',
    '--user-data-dir=' + TEMP_PROFILE,
    'http://127.0.0.1:3000/'
  ]);
  await sleep(2500);

  const data = await new Promise((res, rej) => {
    http.get('http://127.0.0.1:9255/json', r => {
      let b = ''; r.on('data', c => b += c); r.on('end', () => res(JSON.parse(b)));
    }).on('error', rej);
  });
  const page = data.find(t => t.type === 'page' && t.url.includes('3000'));
  if (!page) throw new Error('Page not found');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let id = 1;
  const cbs = new Map();
  ws.onmessage = m => {
    const p = JSON.parse(m.data);
    if (p.id && cbs.has(p.id)) {
      const cb = cbs.get(p.id); cbs.delete(p.id);
      if (p.error) cb.reject(p.error); else cb.resolve(p.result);
    }
  };
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const mid = id++;
      cbs.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  }
  async function evaluate(expression) {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) console.error('Eval error:', r.exceptionDetails);
    return r.result?.value;
  }

  await send('Page.enable');
  await send('Runtime.enable');
  return { chrome, ws, send, evaluate };
}

async function run() {
  console.log('--- TEST: Session Absolute Persistence ---');
  let session = await launchBrowser();

  console.log('Step 1: Verify initial page loaded');
  await sleep(2000);
  const initialCount = await session.evaluate(`window.ANNOTATION_DATA.sheets[0].annotations.length`);
  console.log('Initial sheet-01 annotation count:', initialCount);

  console.log('Step 2: Add multiple edits across different actions without clicking save button');
  const editRes = await session.evaluate(`(() => {
    const sheet = window.ANNOTATION_DATA.sheets[0];
    // 1. Add user annotation
    sheet.annotations.push({
      id: sheet.id + '-user-auto-test-1',
      layer: 'symbols',
      label: 'USER_EDIT_1',
      geometry: { type: 'bbox', coordinates: [100, 100, 200, 200] },
      review_state: 'corrected',
      method: 'human_manual_annotation'
    });
    // 2. Add wall type annotation
    sheet.annotations.push({
      id: sheet.id + '-user-auto-test-wall',
      layer: 'geometry',
      label: 'CHB 150mm - 150mm Concrete Hollow Block exterior wall',
      wall_type: 'chb_150',
      note: '150mm Concrete Hollow Block exterior wall',
      geometry: { type: 'line', coordinates: [[300, 300], [400, 300]] },
      review_state: 'corrected'
    });
    // 3. Mark existing annotation as reviewed
    sheet.annotations[0].review_state = 'user_reviewed';

    // Trigger auto-save
    window.reviewWorkspace.persist();

    return {
      totalAnnotations: sheet.annotations.length,
      hasUser1: sheet.annotations.some(a => a.label === 'USER_EDIT_1'),
      hasWall: sheet.annotations.some(a => a.wall_type === 'chb_150'),
      reviewed0: sheet.annotations[0].review_state
    };
  })()`);
  console.log('Edit result:', editRes);

  console.log('Step 3: Wait 800ms for immediate multi-tier storage flush');
  await sleep(800);

  console.log('Step 4: Hard reset browser with cache bypass (Ctrl+Shift+R)');
  await session.send('Page.reload', { ignoreCache: true });
  await sleep(3000);

  const afterHardReset = await session.evaluate(`(() => {
    const sheet = window.ANNOTATION_DATA.sheets[0];
    return {
      totalAnnotations: sheet.annotations.length,
      hasUser1: sheet.annotations.some(a => a.label === 'USER_EDIT_1'),
      hasWall: sheet.annotations.some(a => a.wall_type === 'chb_150'),
      reviewed0: sheet.annotations[0].review_state,
      statusText: document.getElementById('editor-status')?.textContent,
      sessionStatus: document.getElementById('session-status')?.textContent
    };
  })()`);
  console.log('After Hard Reset result:', afterHardReset);

  if (!afterHardReset.hasUser1 || !afterHardReset.hasWall || afterHardReset.reviewed0 !== 'user_reviewed') {
    throw new Error('Hard reset failed to preserve edits!');
  }
  console.log('Pass: All edits survived hard reset (Ctrl+Shift+R).');

  console.log('Step 5: Test localStorage wiped -> server disk recovery');
  await session.evaluate(`localStorage.clear(); sessionStorage.clear();`);
  await session.send('Page.reload', { ignoreCache: true });
  await sleep(3000);

  const afterStorageWipe = await session.evaluate(`(() => {
    const sheet = window.ANNOTATION_DATA.sheets[0];
    return {
      totalAnnotations: sheet.annotations.length,
      hasUser1: sheet.annotations.some(a => a.label === 'USER_EDIT_1'),
      hasWall: sheet.annotations.some(a => a.wall_type === 'chb_150'),
      reviewed0: sheet.annotations[0].review_state,
      sessionStatus: document.getElementById('session-status')?.textContent
    };
  })()`);
  console.log('After localStorage wipe result:', afterStorageWipe);

  if (!afterStorageWipe.hasUser1 || !afterStorageWipe.hasWall) {
    throw new Error('Server disk recovery failed after local storage wipe!');
  }
  console.log('Pass: Progress recovered from server disk even after local storage wipe.');

  session.ws.close();
  session.chrome.kill();
  console.log('All session persistence tests passed successfully.');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
