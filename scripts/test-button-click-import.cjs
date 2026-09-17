// scripts/test-button-click-import.cjs
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new',
  '--remote-debugging-port=9227',
  '--user-data-dir=' + path.resolve('.temp/cdp-test-btn-click'),
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

  async eval(expression, userGesture = false) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture
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
    const json = await new Promise((res, rej) => http.get('http://127.0.0.1:9227/json', r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
    }).on('error', rej));

    const target = json.find(t => t.type === 'page' && t.url.includes('127.0.0.1:3000'));
    const cdp = new CDPClient(target.webSocketDebuggerUrl);
    await cdp.waitOpen();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');

    await sleep(2000);

    // Set up file chooser interceptor
    await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true });

    let fileChooserOpened = false;
    const testFile = path.resolve('images', 'sheet-54.jpg');

    cdp.ws.addEventListener('message', async msg => {
      const parsed = JSON.parse(msg.data);
      if (parsed.method === 'Page.fileChooserOpened') {
        fileChooserOpened = true;
        console.log('Intercepted file chooser dialog! Node ID:', parsed.params.backendNodeId);
        try {
          await cdp.send('DOM.setFileInputFiles', {
            files: [testFile],
            backendNodeId: parsed.params.backendNodeId
          });
          console.log('DOM.setFileInputFiles dispatched successfully.');
        } catch (e) {
          console.error('Error setting file input files:', e.message);
        }
      }
    });

    console.log('Simulating user click on "Import floor plan" button...');
    const clickResult = await cdp.eval(`(() => {
      const label = document.querySelector('.dataset-import');
      if (!label) return 'not_found';
      label.click();
      return 'clicked';
    })()`, true);

    console.log('Click invocation result:', clickResult);
    await sleep(3000);

    console.log('Was file chooser opened and intercepted?', fileChooserOpened);

    const postImportState = await cdp.eval(`(() => {
      const current = window.reviewWorkspace?.getCurrent?.();
      return {
        status: document.getElementById('editor-status')?.textContent,
        currentId: current?.id,
        currentGroup: current?.group,
        currentTitle: current?.title,
        sheetType: current?.sheet_type,
        stageHasImage: !!window.Konva?.stages?.[0]?.findOne('Image')
      };
    })()`);

    console.log('Post-import state:', JSON.stringify(postImportState, null, 2));

    if (postImportState.currentId?.startsWith('imported-') && postImportState.stageHasImage) {
      console.log('SUCCESS 1: Initial import via button click succeeded.');
    } else {
      console.error('FAILURE: Initial import state unexpected.');
      process.exit(1);
    }

    // Test immediate second import of the EXACT same file
    console.log('\nTesting immediate second click to import the exact same file...');
    fileChooserOpened = false;
    await cdp.eval(`(() => {
      document.querySelector('.dataset-import')?.click();
    })()`, true);
    await sleep(3000);

    console.log('Was file chooser opened on second click?', fileChooserOpened);
    const secondImportState = await cdp.eval(`(() => {
      const current = window.reviewWorkspace?.getCurrent?.();
      return {
        status: document.getElementById('editor-status')?.textContent,
        currentId: current?.id,
        currentGroup: current?.group,
        sheetsCount: window.ANNOTATION_DATA?.sheets?.length
      };
    })()`);
    console.log('Second import state:', JSON.stringify(secondImportState, null, 2));

    if (secondImportState.currentGroup === 30 && secondImportState.sheetsCount === 69) {
      console.log('SUCCESS 2: Second import of same file succeeded cleanly!');
    } else {
      console.error('FAILURE: Second import failed to create expected group or sheet.');
      process.exit(1);
    }

    cdp.close();
  } catch (e) {
    console.error('Test error:', e);
    process.exit(1);
  } finally {
    chrome.kill();
  }
}

run();
