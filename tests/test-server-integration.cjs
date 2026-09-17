// test-server-integration.cjs
// Integration test for VED local server and auto-annotation endpoints. Zero emojis.

const http = require('http');
const server = require('../server.cjs');

const TEST_PORT = 3099;

server.listen(TEST_PORT, '127.0.0.1', async () => {
  console.log(`Test server running on http://127.0.0.1:${TEST_PORT}/`);

  try {
    // 1. Test GET /api/status
    console.log('Testing GET /api/status...');
    const statusRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/status`);
    const statusData = await statusRes.json();
    console.log('Status response:', statusData);
    if (statusData.status !== 'online') throw new Error('Status check failed');
    if (statusData.model !== 'gemini-3.8-flash') {
      throw new Error(`Expected model gemini-3.8-flash, got ${statusData.model}`);
    }
    console.log('Status check passed: gemini-3.8-flash confirmed.');

    // 2. Test GET /review.html
    console.log('Testing GET /review.html...');
    const htmlRes = await fetch(`http://127.0.0.1:${TEST_PORT}/review.html`);
    const htmlText = await htmlRes.text();
    if (!htmlText.includes('btn-auto-annotate')) throw new Error('Auto annotate button missing in HTML');
    if (!htmlText.includes('accept-all-auto')) throw new Error('Accept all auto button missing in HTML');
    if (!htmlText.includes('reject-all-auto')) throw new Error('Reject all auto button missing in HTML');
    console.log('HTML check passed: btn-auto-annotate, accept-all-auto, and reject-all-auto found.');

    // 3. Test POST /api/auto-annotate without key (Truthful path)
    console.log('Testing POST /api/auto-annotate (truthful without key)...');
    const origKey = process.env.GEMINI_API_KEY;
    const origGroq = process.env.GROQ_API_KEY;
    const origYolo = process.env.ENABLE_LOCAL_YOLO;
    process.env.DISABLE_ENV_LOAD = 'true';
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;
    process.env.ENABLE_LOCAL_YOLO = 'false';
    try {
      const truthfulRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/auto-annotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet_id: 'sheet-45', current_annotations: [] })
      });
      const truthfulData = await truthfulRes.json();
      console.log('Truthful response status:', truthfulData.status);
      if (truthfulData.status !== 'api_key_missing') {
        throw new Error(`Expected api_key_missing, got ${truthfulData.status}`);
      }
    } finally {
      delete process.env.DISABLE_ENV_LOAD;
      if (origKey) process.env.GEMINI_API_KEY = origKey;
      if (origGroq) process.env.GROQ_API_KEY = origGroq;
      if (origYolo !== undefined) process.env.ENABLE_LOCAL_YOLO = origYolo;
      else delete process.env.ENABLE_LOCAL_YOLO;
    }
    console.log('Truthful missing-key check passed.');

    // 4. Test POST /api/auto-annotate with fixture option
    console.log('Testing POST /api/auto-annotate with fixture option...');
    const fixtureRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/auto-annotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet_id: 'sheet-45', current_annotations: [], options: { fixture: true } })
    });
    const fixtureData = await fixtureRes.json();
    console.log('sheet-45 fixture response count:', fixtureData.count);
    if (fixtureData.count !== 3) {
      throw new Error(`Expected 3 annotations for sheet-45 fixture, got ${fixtureData.count}`);
    }
    console.log('Fixture proposal check passed.');

    // 5. Test POST /api/auto-annotate for legend sheet-47
    console.log('Testing POST /api/auto-annotate for legend sheet-47...');
    const legendRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/auto-annotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet_id: 'sheet-47', current_annotations: [] })
    });
    const legendData = await legendRes.json();
    console.log('sheet-47 auto-annotate status:', legendData.status);
    if (legendData.status !== 'references_only') {
      throw new Error('Expected references_only status for legend sheet');
    }
    console.log('Legend reference check passed.');

    console.log('\nAll server integration tests PASSED successfully!');
  } catch (err) {
    console.error('Integration test failed:', err);
    process.exitCode = 1;
  } finally {
    server.close(() => {
      console.log('Test server closed.');
    });
  }
});
