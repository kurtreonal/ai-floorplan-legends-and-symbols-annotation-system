// test-saved-session.cjs
// Test suite for VED Saved Session System (Server and Client Persistence)
// Zero emojis in output.

const fs = require('fs');
const path = require('path');
const http = require('http');
const server = require('../server.cjs');

const TEST_PORT = 3101;
const ROOT_DIR = path.resolve(__dirname, '..');
const SESSION_FILE = path.join(ROOT_DIR, 'data', 'saved-session.json');
const BACKUP_FILE = path.join(ROOT_DIR, 'data', 'saved-session.backup.json');

async function runSessionTests() {
  console.log('================================================================');
  console.log('VED Saved Session System - Verification Test Suite');
  console.log('================================================================\n');

  // Clean up any pre-existing session file for clean test run
  try { if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE); } catch {}
  try { if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE); } catch {}

  server.listen(TEST_PORT, '127.0.0.1', async () => {
    try {
      // 1. Initial check: No session saved yet
      console.log('--- Test 1: Initial GET /api/session when clean ---');
      const getClean = await fetch(`http://127.0.0.1:${TEST_PORT}/api/session`);
      const cleanData = await getClean.json();
      if (cleanData.status !== 'none') {
        throw new Error(`Expected status 'none', got '${cleanData.status}'`);
      }
      console.log('Confirmed: Clean state returns status: none.\n');

      // 2. Initial status check
      console.log('--- Test 2: GET /api/status reports has_saved_session: false ---');
      const statusRes1 = await fetch(`http://127.0.0.1:${TEST_PORT}/api/status`);
      const statusData1 = await statusRes1.json();
      if (statusData1.has_saved_session !== false) {
        throw new Error(`Expected has_saved_session: false, got ${statusData1.has_saved_session}`);
      }
      console.log('Confirmed: Status reports has_saved_session: false.\n');

      // 3. Save a session payload via POST /api/session
      console.log('--- Test 3: POST /api/session to persist review progress ---');
      const mockSession = {
        schema: 'ved-editable-review-v2',
        created_at: new Date().toISOString(),
        decisions: { 'sheet-01': 'candidate_after_corrections' },
        legend_colors: { 'sheet-01:L01': '#B8F23D' },
        sheets: [
          {
            id: 'sheet-01',
            source_sha256: 'mock-sha-01',
            annotations: [
              {
                id: 'sheet-01-user-001',
                layer: 'symbols',
                label: 'Test Verified Receptacle',
                geometry: { type: 'bbox', coordinates: [100, 100, 200, 200] },
                review_state: 'corrected'
              }
            ]
          }
        ]
      };

      const postRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: mockSession })
      });
      if (!postRes.ok) throw new Error(`POST /api/session returned ${postRes.status}`);
      const postData = await postRes.json();
      if (postData.status !== 'success' || postData.sheets_count !== 1 || postData.annotations_count !== 1) {
        throw new Error(`Unexpected POST response: ${JSON.stringify(postData)}`);
      }
      console.log(`Session saved: ${postData.sheets_count} sheet, ${postData.annotations_count} annotation.`);

      // Verify file exists on disk
      if (!fs.existsSync(SESSION_FILE)) {
        throw new Error(`Expected saved-session.json to exist on disk at ${SESSION_FILE}`);
      }
      const diskContent = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      if (diskContent.sheets[0].annotations[0].label !== 'Test Verified Receptacle') {
        throw new Error('Disk file content mismatch');
      }
      console.log('Confirmed: Atomic disk write succeeded and verified.\n');

      // 4. GET /api/session after save
      console.log('--- Test 4: GET /api/session to retrieve saved progress ---');
      const getSaved = await fetch(`http://127.0.0.1:${TEST_PORT}/api/session`);
      const savedData = await getSaved.json();
      if (savedData.status !== 'success' || !savedData.session || !savedData.saved_at) {
        throw new Error(`Expected success with session and saved_at, got ${JSON.stringify(savedData)}`);
      }
      if (savedData.session.sheets[0].annotations[0].id !== 'sheet-01-user-001') {
        throw new Error('Retrieved session content mismatch');
      }
      console.log(`Confirmed: Retrieved saved session saved_at: ${savedData.saved_at}.\n`);

      // 5. GET /api/status now reports has_saved_session: true
      console.log('--- Test 5: GET /api/status reports has_saved_session: true ---');
      const statusRes2 = await fetch(`http://127.0.0.1:${TEST_PORT}/api/status`);
      const statusData2 = await statusRes2.json();
      if (statusData2.has_saved_session !== true) {
        throw new Error(`Expected has_saved_session: true, got ${statusData2.has_saved_session}`);
      }
      console.log('Confirmed: Status reports has_saved_session: true.\n');

      // 6. Second save creates backup file
      console.log('--- Test 6: Second save generates backup file ---');
      const mockSession2 = {
        ...mockSession,
        sheets: [
          {
            id: 'sheet-01',
            source_sha256: 'mock-sha-01',
            annotations: [
              ...mockSession.sheets[0].annotations,
              {
                id: 'sheet-01-user-002',
                layer: 'symbols',
                label: 'Second Switch',
                geometry: { type: 'bbox', coordinates: [300, 300, 400, 400] },
                review_state: 'needs_review'
              }
            ]
          }
        ]
      };
      await fetch(`http://127.0.0.1:${TEST_PORT}/api/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: mockSession2 })
      });
      if (!fs.existsSync(BACKUP_FILE)) {
        throw new Error(`Expected backup file ${BACKUP_FILE} to exist`);
      }
      const backupData = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
      if (backupData.sheets[0].annotations.length !== 1) {
        throw new Error(`Expected backup to have 1 annotation, got ${backupData.sheets[0].annotations.length}`);
      }
      console.log('Confirmed: Prior session preserved in saved-session.backup.json.\n');

      // 7. DELETE /api/session clears saved session
      console.log('--- Test 7: DELETE /api/session to reset saved session ---');
      const delRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/session`, { method: 'DELETE' });
      const delData = await delRes.json();
      if (delData.status !== 'success') {
        throw new Error(`Expected status success on delete, got ${delData.status}`);
      }
      if (fs.existsSync(SESSION_FILE)) {
        throw new Error('Expected SESSION_FILE to be removed');
      }
      const getAfterDel = await fetch(`http://127.0.0.1:${TEST_PORT}/api/session`);
      const afterDelData = await getAfterDel.json();
      if (afterDelData.status !== 'none') {
        throw new Error('Expected status none after delete');
      }
      console.log('Confirmed: Session successfully cleared and status reset.\n');

      console.log('================================================================');
      console.log('ALL SAVED SESSION TESTS PASSED SUCCESSFULLY');
      console.log('================================================================');
    } catch (err) {
      console.error('Test error:', err);
      process.exitCode = 1;
    } finally {
      server.close(() => {
        // Clean up test files if any remain
        try { if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE); } catch {}
        try { if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE); } catch {}
      });
    }
  });
}

runSessionTests();
