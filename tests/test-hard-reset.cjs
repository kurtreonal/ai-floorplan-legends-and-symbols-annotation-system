const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_PROFILE = path.resolve('.temp/test-hard-reset-profile');
fs.mkdirSync(TEMP_PROFILE, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=9244',
  '--user-data-dir=' + TEMP_PROFILE,
  'http://127.0.0.1:3000/'
]);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  await sleep(2500);
  const data = await new Promise((res, rej) => {
    http.get('http://127.0.0.1:9244/json', r => {
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
    if (r.exceptionDetails) {
      console.error('Eval error:', r.exceptionDetails);
    }
    return r.result?.value;
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await sleep(2000);

  console.log('1. Page loaded. Selecting sheet-01 and adding test annotation...');
  const addRes = await evaluate(`(() => {
    const sheet = window.ANNOTATION_DATA.sheets[0];
    const newAnno = {
      id: sheet.id + '-user-hardreset-test',
      layer: 'symbols',
      label: 'UNIQUE_HARD_RESET_TEST_SYMBOL',
      geometry: { type: 'bbox', coordinates: [150, 150, 250, 250] },
      review_state: 'corrected',
      method: 'human_manual_annotation'
    };
    sheet.annotations.push(newAnno);
    window.reviewWorkspace.persist();
    return {
      annoCount: sheet.annotations.length,
      hasAnno: sheet.annotations.some(a => a.label === 'UNIQUE_HARD_RESET_TEST_SYMBOL')
    };
  })()`);
  console.log('Added annotation result:', addRes);

  console.log('2. Waiting 500ms and checking storage...');
  await sleep(500);
  const storeCheck = await evaluate(`(() => {
    return {
      localStorageKeys: Object.keys(localStorage),
      vedSessionRaw: !!localStorage.getItem('ved_saved_session_v2'),
      editableReviewRaw: Object.keys(localStorage).filter(k => k.startsWith('ved-editable-review-v2')).length
    };
  })()`);
  console.log('Storage check:', storeCheck);

  console.log('3. Performing Page.reload({ ignoreCache: true }) (Ctrl+Shift+R)...');
  await send('Page.reload', { ignoreCache: true });
  await sleep(3000);

  console.log('4. Page reloaded. Checking if annotation exists...');
  const reloadCheck = await evaluate(`(() => {
    const sheet = window.ANNOTATION_DATA.sheets[0];
    const found = sheet.annotations.find(a => a.label === 'UNIQUE_HARD_RESET_TEST_SYMBOL');
    const statusText = document.getElementById('editor-status')?.textContent;
    const sessionStatus = document.getElementById('session-status')?.textContent;
    return {
      totalAnnotations: sheet.annotations.length,
      found: !!found,
      statusText,
      sessionStatus
    };
  })()`);
  console.log('After reload check:', reloadCheck);

  ws.close();
  chrome.kill();
}
run().catch(e => { console.error('Test run failed:', e); chrome.kill(); });
