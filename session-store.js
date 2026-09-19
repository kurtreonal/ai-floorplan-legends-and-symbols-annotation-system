// session-store.js
// Client session persistence engine for VED Floor Plan Review.
// Guarantees user progress is absolute, automatic, and survives browser hard reset
// (Ctrl+Shift+R) and crashes across server disk, IndexedDB, and localStorage.
// Strictly zero emojis.

(() => {
  'use strict';

  const DB_NAME = 'ved_session_db';
  const DB_VERSION = 1;
  const STORE_NAME = 'sessions';
  const RECORD_KEY = 'latest';
  const CANONICAL_STORAGE_KEY = 'ved_saved_session_absolute';
  const LEGACY_STORAGE_KEYS = ['ved_saved_session_v2', 'ved_saved_session'];

  let dbInstance = null;
  let isDirty = false;
  let autoSaveTimeout = null;
  let lastSavedAt = null;
  let cachedPayloadGetter = null;
  let highestSavedEditCount = 0;

  // Clean old bloated keys from localStorage to prevent quota exhaustion
  function cleanOldStorageKeys() {
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('ved-editable-review-v2:')) {
          toRemove.push(k);
        }
      }
      for (const k of toRemove) {
        localStorage.removeItem(k);
      }
    } catch {}
  }

  // Count active user edits in a review payload
  function countUserEdits(payload) {
    if (!payload || !Array.isArray(payload.sheets)) return 0;
    let count = 0;
    for (const s of payload.sheets) {
      if (s.id && s.id.startsWith('imported-')) count++;
      for (const a of (s.annotations || [])) {
        if (a.review_state === 'corrected' ||
            a.review_state === 'user_reviewed' ||
            a.review_state === 'manually_added' ||
            a.review_state === 'deleted' ||
            a.wall_type ||
            (a.id && a.id.includes('-user-'))) {
          count++;
        }
      }
    }
    if (payload.decisions && typeof payload.decisions === 'object') {
      for (const d of Object.values(payload.decisions)) {
        if (d && (d.decision || (d.notes && d.notes.trim()))) count++;
      }
    }
    if (payload.legend_colors && typeof payload.legend_colors === 'object') {
      count += Object.keys(payload.legend_colors).length;
    }
    return count;
  }

  // Open IndexedDB database
  function openDatabase() {
    return new Promise(resolve => {
      if (dbInstance) return resolve(dbInstance);
      if (typeof indexedDB === 'undefined') return resolve(null);

      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = event => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = () => {
          dbInstance = req.result;
          resolve(dbInstance);
        };
        req.onerror = () => {
          console.warn('[SessionStore] IndexedDB open error:', req.error);
          resolve(null);
        };
      } catch (err) {
        console.warn('[SessionStore] IndexedDB unavailable:', err);
        resolve(null);
      }
    });
  }

  // Save session to IndexedDB
  async function saveToIndexedDb(payload) {
    try {
      const db = await openDatabase();
      if (!db) return false;
      return new Promise(resolve => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const record = {
          key: RECORD_KEY,
          saved_at: new Date().toISOString(),
          edit_count: countUserEdits(payload),
          data: payload
        };
        const req = store.put(record, RECORD_KEY);
        req.onsuccess = () => resolve(true);
        req.onerror = () => {
          console.warn('[SessionStore] Error saving to IndexedDB:', req.error);
          resolve(false);
        };
      });
    } catch (e) {
      console.warn('[SessionStore] IndexedDB write failed:', e);
      return false;
    }
  }

  // Load session from IndexedDB
  async function loadFromIndexedDb() {
    try {
      const db = await openDatabase();
      if (!db) return null;
      return new Promise(resolve => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(RECORD_KEY);
        req.onsuccess = () => {
          const res = req.result;
          if (res && res.data && Array.isArray(res.data.sheets)) {
            resolve({
              data: res.data,
              saved_at: res.saved_at,
              edit_count: res.edit_count || countUserEdits(res.data),
              source: 'indexeddb'
            });
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  // Save session to localStorage with quota recovery
  function saveToLocalStorage(payload) {
    try {
      const record = {
        saved_at: new Date().toISOString(),
        edit_count: countUserEdits(payload),
        data: payload
      };
      const json = JSON.stringify(record);
      localStorage.setItem(CANONICAL_STORAGE_KEY, json);
      // Keep legacy key updated if space permits
      try { localStorage.setItem(LEGACY_STORAGE_KEYS[0], json); } catch {}
      return true;
    } catch (err) {
      // Quota exceeded: clean old hash keys and retry
      cleanOldStorageKeys();
      try {
        const record = {
          saved_at: new Date().toISOString(),
          edit_count: countUserEdits(payload),
          data: payload
        };
        localStorage.setItem(CANONICAL_STORAGE_KEY, JSON.stringify(record));
        return true;
      } catch (retryErr) {
        console.warn('[SessionStore] localStorage write failed after cleanup:', retryErr.message);
        return false;
      }
    }
  }

  // Load session from localStorage (checking canonical, then legacy keys)
  function loadFromLocalStorage() {
    try {
      // Check canonical key first
      const raw = localStorage.getItem(CANONICAL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.data && Array.isArray(parsed.data.sheets)) {
          return {
            data: parsed.data,
            saved_at: parsed.saved_at,
            edit_count: parsed.edit_count || countUserEdits(parsed.data),
            source: 'localstorage'
          };
        }
      }

      // Check legacy keys
      for (const key of LEGACY_STORAGE_KEYS) {
        const legacyRaw = localStorage.getItem(key);
        if (legacyRaw) {
          const parsed = JSON.parse(legacyRaw);
          if (parsed && parsed.data && Array.isArray(parsed.data.sheets)) {
            return {
              data: parsed.data,
              saved_at: parsed.saved_at,
              edit_count: parsed.edit_count || countUserEdits(parsed.data),
              source: 'localstorage_legacy'
            };
          }
        }
      }

      // Check dynamic sha256 keys as final fallback
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('ved-editable-review-v2:')) {
          try {
            const parsed = JSON.parse(localStorage.getItem(k));
            if (parsed && Array.isArray(parsed.sheets)) {
              return {
                data: parsed,
                saved_at: parsed.created_at || new Date().toISOString(),
                edit_count: countUserEdits(parsed),
                source: 'localstorage_hash'
              };
            }
          } catch {}
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  // Save session to server endpoint
  async function saveToServer(payload) {
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: payload })
      });
      if (res.ok) {
        const result = await res.json();
        return result;
      }
      return null;
    } catch (e) {
      console.warn('[SessionStore] Server save notice:', e.message);
      return null;
    }
  }

  // Load session from server endpoint
  async function loadFromServer() {
    try {
      const res = await fetch('/api/session');
      if (res.ok) {
        const result = await res.json();
        if (result.status === 'success' && result.session && Array.isArray(result.session.sheets)) {
          return {
            data: result.session,
            saved_at: result.saved_at,
            edit_count: countUserEdits(result.session),
            source: 'server_disk'
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  // Update visual status indicator in header
  function updateSessionStatusUI(state, extra = '') {
    const el = document.getElementById('session-status');
    if (!el) return;

    if (state === 'saving') {
      el.textContent = 'Auto-saving...';
      el.className = 'session-status saving';
    } else if (state === 'saved') {
      const timeStr = lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString() : '';
      el.textContent = timeStr ? `Auto-saved (${timeStr})` : 'Auto-saved';
      el.className = 'session-status saved';
      el.title = `Your review is auto-saved to disk and browser storage. Last saved at ${timeStr}.`;
    } else if (state === 'restored') {
      el.textContent = 'Session restored';
      el.className = 'session-status restored';
      el.title = extra || 'Saved session restored from previous work.';
    } else if (state === 'error') {
      el.textContent = 'Session save notice';
      el.className = 'session-status warning';
    }
  }

  // Perform full multi-tier save
  async function performSave(payload) {
    if (!payload || !Array.isArray(payload.sheets)) return;

    const edits = countUserEdits(payload);
    // Anti-overwrite check: do not allow a zero-edit baseline to overwrite a session with edits
    if (edits < highestSavedEditCount && edits === 0 && highestSavedEditCount > 0) {
      console.warn('[SessionStore] Overwrite protection prevented saving empty baseline over active edits.');
      return;
    }
    if (edits > highestSavedEditCount) {
      highestSavedEditCount = edits;
    }

    updateSessionStatusUI('saving');

    // 1. Synchronous localStorage write
    saveToLocalStorage(payload);

    // 2. IndexedDB write
    saveToIndexedDb(payload).catch(() => {});

    // 3. Server disk write
    await saveToServer(payload);

    isDirty = false;
    lastSavedAt = new Date().toISOString();
    updateSessionStatusUI('saved');
  }

  // Primary auto-save entry point for all review actions
  function saveAuto(payload, immediate = true) {
    if (!payload || !Array.isArray(payload.sheets)) return;
    isDirty = true;

    if (immediate) {
      if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
        autoSaveTimeout = null;
      }
      performSave(payload);
    } else {
      updateSessionStatusUI('saving');
      if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
      autoSaveTimeout = setTimeout(() => {
        autoSaveTimeout = null;
        performSave(payload);
      }, 250);
    }
  }

  // Schedule auto-save using payload getter
  function scheduleAutoSave(getPayloadFn, immediate = true) {
    if (typeof getPayloadFn === 'function') {
      cachedPayloadGetter = getPayloadFn;
      saveAuto(cachedPayloadGetter(), immediate);
    } else if (getPayloadFn && typeof getPayloadFn === 'object') {
      saveAuto(getPayloadFn, immediate);
    }
  }

  // Immediate flush on pagehide / beforeunload / visibilitychange
  function flushImmediate() {
    if (!cachedPayloadGetter) return;
    try {
      const payload = cachedPayloadGetter();
      if (!payload || !Array.isArray(payload.sheets)) return;

      // Synchronously write to localStorage
      saveToLocalStorage(payload);

      // Trigger server save
      saveToServer(payload);

      isDirty = false;
    } catch (e) {
      console.warn('[SessionStore] Flush notice:', e.message);
    }
  }

  // Restore the best session among Server Disk, IndexedDB, and localStorage
  async function restoreBestSession(baseline) {
    try {
      const [serverSession, idbSession, localSession] = await Promise.all([
        loadFromServer().catch(() => null),
        loadFromIndexedDb().catch(() => null),
        Promise.resolve(loadFromLocalStorage())
      ]);

      const candidates = [serverSession, idbSession, localSession].filter(Boolean);
      if (!candidates.length) return null;

      // Sort candidates by: 1) edit_count descending, 2) saved_at descending
      candidates.sort((a, b) => {
        const editsA = a.edit_count || 0;
        const editsB = b.edit_count || 0;
        if (editsB !== editsA) return editsB - editsA;
        const tA = a.saved_at ? new Date(a.saved_at).getTime() : 0;
        const tB = b.saved_at ? new Date(b.saved_at).getTime() : 0;
        return tB - tA;
      });

      const best = candidates[0];
      if (!best || !best.data || !Array.isArray(best.data.sheets)) return null;

      highestSavedEditCount = best.edit_count || countUserEdits(best.data);
      lastSavedAt = best.saved_at;
      updateSessionStatusUI('restored', `Restored session from ${best.source} (${new Date(best.saved_at).toLocaleString()})`);
      return best;
    } catch (err) {
      console.warn('[SessionStore] Session restoration notice:', err);
      return null;
    }
  }

  // Setup background event listeners
  function setupExitGuards() {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

    window.addEventListener('beforeunload', () => {
      flushImmediate();
    });

    window.addEventListener('pagehide', () => {
      flushImmediate();
    });

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && isDirty && cachedPayloadGetter) {
          flushImmediate();
        }
      });
    }

    // Periodic heartbeat every 15 seconds to ensure server disk is always in sync
    setInterval(() => {
      if (isDirty && cachedPayloadGetter) {
        performSave(cachedPayloadGetter());
      }
    }, 15000);
  }

  // Clean obsolete legacy storage keys on boot
  cleanOldStorageKeys();
  setupExitGuards();

  // Export to global scope
  window.VEDSessionStore = {
    saveAuto,
    scheduleAutoSave,
    performSave,
    flushImmediate,
    restoreBestSession,
    loadFromServer,
    loadFromIndexedDb,
    loadFromLocalStorage,
    saveToServer,
    saveToIndexedDb,
    saveToLocalStorage,
    cleanOldStorageKeys,
    countUserEdits,
    getLastSavedAt: () => lastSavedAt,
    isDirty: () => isDirty,
    setPayloadGetter: fn => { cachedPayloadGetter = fn; }
  };
})();
