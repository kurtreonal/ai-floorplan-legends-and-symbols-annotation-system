// session-store.js
// Client session persistence engine for VED Floor Plan Review.
// Guarantees user progress is saved across server disk, browser IndexedDB,
// and localStorage. Zero emojis.

(() => {
  'use strict';

  const DB_NAME = 'ved_session_db';
  const DB_VERSION = 1;
  const STORE_NAME = 'sessions';
  const RECORD_KEY = 'latest';
  const LOCAL_STORAGE_KEY = 'ved_saved_session_v2';

  let dbInstance = null;
  let isDirty = false;
  let autoSaveTimeout = null;
  let lastSavedAt = null;
  let cachedPayloadGetter = null;

  // Open IndexedDB database
  function openDatabase() {
    return new Promise((resolve, reject) => {
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
          if (res && res.data) {
            resolve({ data: res.data, saved_at: res.saved_at });
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

  // Save session to localStorage with error handling for quota
  function saveToLocalStorage(payload) {
    try {
      const record = {
        saved_at: new Date().toISOString(),
        data: payload
      };
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(record));
      return true;
    } catch (err) {
      console.warn('[SessionStore] localStorage write failed (likely quota exceeded):', err.message);
      return false;
    }
  }

  // Load session from localStorage
  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.data) {
        return { data: parsed.data, saved_at: parsed.saved_at };
      }
      if (parsed && Array.isArray(parsed.sheets)) {
        return { data: parsed, saved_at: parsed.created_at || new Date().toISOString() };
      }
      return null;
    } catch {
      return null;
    }
  }

  // Save session to server
  async function saveToServer(payload) {
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: payload }),
        keepalive: true
      });
      if (res.ok) {
        const result = await res.json();
        return result;
      }
      return null;
    } catch (e) {
      console.warn('[SessionStore] Server session save notice:', e.message);
      return null;
    }
  }

  // Load session from server
  async function loadFromServer() {
    try {
      const res = await fetch('/api/session');
      if (res.ok) {
        const result = await res.json();
        if (result.status === 'success' && result.session) {
          return { data: result.session, saved_at: result.saved_at };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  // Send beacon on page exit (guaranteed delivery by browser even during unload)
  function sendBeaconToServer(payload) {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([JSON.stringify({ session: payload })], { type: 'application/json' });
        navigator.sendBeacon('/api/session', blob);
      }
    } catch (e) {
      console.warn('[SessionStore] Beacon save notice:', e.message);
    }
  }

  // Update visual status indicators in UI
  function updateSessionStatusUI(state, extra = '') {
    const el = document.getElementById('session-status');
    if (!el) return;

    if (state === 'saving') {
      el.textContent = 'Saving session...';
      el.className = 'session-status saving';
    } else if (state === 'saved') {
      const timeStr = lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString() : '';
      el.textContent = timeStr ? `Session saved (${timeStr})` : 'Session saved';
      el.className = 'session-status saved';
      el.title = `Your progress is saved to disk and browser storage. Last saved at ${timeStr}.`;
    } else if (state === 'restored') {
      el.textContent = 'Session restored';
      el.className = 'session-status restored';
      el.title = extra || 'Saved session restored from previous work.';
    } else if (state === 'error') {
      el.textContent = 'Session save warning';
      el.className = 'session-status warning';
    }
  }

  // Perform full multi-tier save
  async function performSave(payload) {
    if (!payload || !Array.isArray(payload.sheets)) return;
    updateSessionStatusUI('saving');

    // 1. IndexedDB (primary local storage)
    await saveToIndexedDb(payload);

    // 2. localStorage (fallback local storage)
    saveToLocalStorage(payload);

    // 3. Server disk storage (portable server persistence)
    await saveToServer(payload);

    isDirty = false;
    lastSavedAt = new Date().toISOString();
    updateSessionStatusUI('saved');
  }

  // Schedule debounced auto-save
  function scheduleAutoSave(getPayloadFn) {
    if (typeof getPayloadFn === 'function') {
      cachedPayloadGetter = getPayloadFn;
    }
    isDirty = true;
    updateSessionStatusUI('saving');

    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
    }

    autoSaveTimeout = setTimeout(() => {
      autoSaveTimeout = null;
      if (cachedPayloadGetter) {
        const payload = cachedPayloadGetter();
        performSave(payload);
      }
    }, 1500);
  }

  // Immediate synchronous flush (called on unload / close)
  function flushImmediate() {
    if (!cachedPayloadGetter) return;
    try {
      const payload = cachedPayloadGetter();
      if (!payload || !Array.isArray(payload.sheets)) return;

      // Local storage write
      saveToLocalStorage(payload);

      // Server beacon write
      sendBeaconToServer(payload);

      isDirty = false;
    } catch (e) {
      console.warn('[SessionStore] Unload flush notice:', e.message);
    }
  }

  // Smart session loader: selects the freshest valid session among Server, IndexedDB, and localStorage
  async function restoreBestSession(baseline) {
    try {
      const [serverSession, idbSession, localSession] = await Promise.all([
        loadFromServer().catch(() => null),
        loadFromIndexedDb().catch(() => null),
        Promise.resolve(loadFromLocalStorage())
      ]);

      const candidates = [serverSession, idbSession, localSession].filter(Boolean);
      if (!candidates.length) return null;

      // Sort by saved_at descending to find the newest session
      candidates.sort((a, b) => {
        const tA = a.saved_at ? new Date(a.saved_at).getTime() : 0;
        const tB = b.saved_at ? new Date(b.saved_at).getTime() : 0;
        return tB - tA;
      });

      const best = candidates[0];
      if (!best || !best.data || !Array.isArray(best.data.sheets)) return null;

      lastSavedAt = best.saved_at;
      updateSessionStatusUI('restored', `Restored session from ${new Date(best.saved_at).toLocaleString()}`);
      return best;
    } catch (err) {
      console.warn('[SessionStore] Session restoration error:', err);
      return null;
    }
  }

  // Setup background listeners for page exit, tab switch, and periodic heartbeat
  function setupExitGuards() {
    window.addEventListener('beforeunload', () => {
      flushImmediate();
    });

    window.addEventListener('pagehide', () => {
      flushImmediate();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && isDirty && cachedPayloadGetter) {
        const payload = cachedPayloadGetter();
        performSave(payload);
      }
    });

    // Heartbeat every 20 seconds: if edits were made, ensure saved to server & disk
    setInterval(() => {
      if (isDirty && cachedPayloadGetter) {
        const payload = cachedPayloadGetter();
        performSave(payload);
      }
    }, 20000);
  }

  // Initialize guards immediately
  setupExitGuards();

  // Export to global scope
  window.VEDSessionStore = {
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
    getLastSavedAt: () => lastSavedAt,
    isDirty: () => isDirty,
    setPayloadGetter: fn => { cachedPayloadGetter = fn; }
  };
})();
