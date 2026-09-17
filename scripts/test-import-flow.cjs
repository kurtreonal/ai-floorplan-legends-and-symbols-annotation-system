// scripts/test-import-flow.cjs
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new',
  '--remote-debugging-port=9226',
  '--user-data-dir=' + path.resolve('.temp/cdp-test-import-flow'),
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
        console.log('[Browser Console]', type, text);
        if (type === 'error') this.errors.push(text);
      } else if (parsed.method === 'Runtime.exceptionThrown') {
        const text = parsed.params.exceptionDetails.exception?.description || parsed.params.exceptionDetails.text;
        console.error('[Browser Exception]', text);
        this.errors.push(text);
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
  try {
    await sleep(2000);
    const json = await new Promise((res, rej) => http.get('http://127.0.0.1:9226/json', r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
    }).on('error', rej));

    const target = json.find(t => t.type === 'page' && t.url.includes('127.0.0.1:3000'));
    const cdp = new CDPClient(target.webSocketDebuggerUrl);
    await cdp.waitOpen();
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Runtime.enable');

    console.log('Page loaded, waiting for initial render...');
    await sleep(2000);

    const initial = await cdp.eval(`(() => ({
      sheets: window.ANNOTATION_DATA?.sheets?.length,
      groups: window.ANNOTATION_DATA?.counts?.groups,
      status: document.getElementById('editor-status')?.textContent,
      current: window.reviewWorkspace?.getCurrent?.()?.id
    }))()`);
    console.log('Initial state:', initial);

    // Step 1: Import a floor plan image
    console.log('\n--- STEP 1: Import floor plan image ---');
    const doc = await cdp.send('DOM.getDocument');
    const importInputNode = await cdp.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: '.dataset-import input'
    });
    const testImg = path.resolve('images', 'sheet-53.jpg');

    await cdp.send('DOM.setFileInputFiles', { files: [testImg], nodeId: importInputNode.nodeId });
    await sleep(2500);

    const afterImport1 = await cdp.eval(`(() => ({
      sheets: window.ANNOTATION_DATA?.sheets?.length,
      groups: window.ANNOTATION_DATA?.counts?.groups,
      status: document.getElementById('editor-status')?.textContent,
      currentId: window.reviewWorkspace?.getCurrent?.()?.id,
      currentGroup: window.reviewWorkspace?.getCurrent?.()?.group,
      groupVal: document.getElementById('group')?.value,
      sheetVal: document.getElementById('sheet')?.value,
      inputValue: document.querySelector('.dataset-import input')?.value
    }))()`);
    console.log('After import 1:', afterImport1);

    // Step 2: Test re-importing the SAME file immediately
    console.log('\n--- STEP 2: Re-import same file ---');
    await cdp.send('DOM.setFileInputFiles', { files: [testImg], nodeId: importInputNode.nodeId });
    await sleep(2500);

    const afterImport2 = await cdp.eval(`(() => ({
      sheets: window.ANNOTATION_DATA?.sheets?.length,
      groups: window.ANNOTATION_DATA?.counts?.groups,
      status: document.getElementById('editor-status')?.textContent,
      currentId: window.reviewWorkspace?.getCurrent?.()?.id
    }))()`);
    console.log('After import 2:', afterImport2);

    // Step 3: Trigger Save Session
    console.log('\n--- STEP 3: Save Session ---');
    const saveResult = await cdp.eval(`(async () => {
      document.getElementById('btn-save-session')?.click();
      await new Promise(r => setTimeout(r, 1000));
      return {
        status: document.getElementById('editor-status')?.textContent,
        sessionStatus: document.getElementById('session-status')?.textContent
      };
    })()`);
    console.log('Save result:', saveResult);

    // Step 4: Reload page and check session restoration
    console.log('\n--- STEP 4: Reload page and test restoration ---');
    await cdp.send('Page.reload');
    await sleep(3500);

    const afterReload = await cdp.eval(`(() => ({
      sheets: window.ANNOTATION_DATA?.sheets?.length,
      groups: window.ANNOTATION_DATA?.counts?.groups,
      status: document.getElementById('editor-status')?.textContent,
      sessionStatus: document.getElementById('session-status')?.textContent,
      currentId: window.reviewWorkspace?.getCurrent?.()?.id,
      allSheetsCount: document.querySelectorAll('#all-sheets tr')?.length
    }))()`);
    console.log('After reload:', afterReload);

    console.log('\nTotal browser errors caught:', cdp.errors.length);
    if (cdp.errors.length > 0) {
      console.log('Errors:', cdp.errors);
    }

    cdp.close();
  } catch (err) {
    console.error('Fatal test error:', err);
  } finally {
    chrome.kill();
  }
}

run();
