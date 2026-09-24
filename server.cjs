// server.cjs
// Local lightweight HTTP server for VED Floor-Plan Review app & Auto-Annotation API
// Zero external npm dependencies.

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const readiness = require('./dataset-readiness.cjs');
const datasetReviews = require('./dataset-review-store.cjs');
const datasetPredictions = require('./dataset-predictions.cjs');


// Automatically load .env file if present (supported natively in Node 20.6+)
const envPath = path.join(__dirname, '.env');
if (typeof process.loadEnvFile === 'function' && fs.existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch (err) {
    console.warn('[Server] Could not load .env file:', err.message);
  }
}

const { runAutoAnnotation, isYoloAvailable, getYoloModelPath } = require('./auto-annotate.cjs');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ROOT_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.cjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf'
};

function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(payload);
}

function serveStatic(req, res, pathname) {
  if (pathname.split('/').some(part => part.startsWith('.')) || /^\/(node_modules|models|training_dataset|backups|data\/dataset-review|data\/dataset-predictions)(\/|$)/.test(pathname) || /\.(cjs|py)$/i.test(pathname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden'); return;
  }
  let filePath = path.join(ROOT_DIR, pathname === '/' ? 'review.html' : pathname);

  // If file not found in root, check data/ directory (e.g. starting-progress.json)
  if (!fs.existsSync(filePath)) {
    const dataSubPath = path.join(ROOT_DIR, 'data', pathname.replace(/^\//, ''));
    if (fs.existsSync(dataSubPath)) {
      filePath = dataSubPath;
    }
  }

  // Security check: prevent path traversal
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache'
    });

    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const host = req.headers.host || '';
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ||
      (req.headers.origin && req.headers.origin !== `http://${host}`)) {
    sendJson(res, 403, { error: 'Local same-origin access required' }); return;
  }
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // API Status endpoint
  if (pathname === '/api/status' && req.method === 'GET') {
    const hasYolo = typeof isYoloAvailable === 'function' && isYoloAvailable();
    const sessionPath = path.join(ROOT_DIR, 'data', 'saved-session.json');
    sendJson(res, 200, {
      status: 'online',
      has_gemini_api_key: false,
      has_groq_api_key: false,
      has_local_yolo: hasYolo,
      has_saved_session: fs.existsSync(sessionPath),
      primary_detector: hasYolo ? 'local_yolo (VED custom symbols)' : 'local_model_unavailable',
      local_only: true,
      yolo_models: hasYolo ? [path.basename(getYoloModelPath())] : [],
      model: hasYolo ? 'local_yolo' : null,
      model_hopping: false,
      workspace: 'VED-floor-plan-review-portable-2.0'
    });
    return;
  }

  // API Saved Session endpoints (Automatic progress preservation)
  const sessionPath = path.join(ROOT_DIR, 'data', 'saved-session.json');
  const sessionBackupPath = path.join(ROOT_DIR, 'data', 'saved-session.backup.json');
  const sessionSnapshotsDir = path.join(ROOT_DIR, 'data', 'sessions');
  const reviewDirectory = path.join(ROOT_DIR, 'data', 'dataset-review');

  if (pathname === '/api/dataset-predictions' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 8 * 1024 * 1024) req.destroy(); });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
        const references = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data', 'approved-references.json'), 'utf8'));
        const catalog = readiness.catalogOf(references);
        const history = datasetReviews.readHistory(reviewDirectory);
        const sealed = datasetReviews.sealedPages(history);
        for (const sheet of payload.sheets) if (sheet.split === 'sealed_test') sealed.add(sheet.id);
        const report = readiness.audit(payload, catalog, await readiness.sourceIndex(ROOT_DIR), sealed);
        for (const page of report.pages) {
          page.review = datasetReviews.pageReview(history, payload.sheets.find(s => s.id === page.id), catalog.version);
          page.sealed_test = sealed.has(page.id);
        }
        const record = datasetPredictions.preparePredictions(JSON.parse(body), payload, catalog, report);
        sendJson(res, 200, datasetPredictions.persistPredictions(path.join(ROOT_DIR, 'data', 'dataset-predictions'), record));
      } catch (error) { sendJson(res, 422, { error: error.code ? 'Prediction import failed; no truth changed' : error.message }); }
    });
    return;
  }

  if (pathname === '/api/dataset-review' && req.method === 'POST') {
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
      sendJson(res, 403, { error: 'Same-origin local review required' }); return;
    }
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 16384) req.destroy();
    });
    req.on('end', () => {
      try {
        const request = JSON.parse(body);
        const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
        const sheet = session.sheets.find(s => s.id === request.page_id);
        if (!sheet) throw Error('Unknown page');
        const references = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data', 'approved-references.json'), 'utf8'));
        const record = datasetReviews.appendReview(reviewDirectory, sheet, request, readiness.catalogOf(references).version);
        sendJson(res, 200, { status: 'recorded_local_attestation', hash: record.hash, training_approved: false });
      } catch (error) {
        sendJson(res, 409, { error: error.code ? 'Review could not be persisted; no approval granted' : error.message });
      }
    });
    return;
  }

  if (['/api/dataset-readiness', '/api/dataset-symbol-candidates'].includes(pathname) && req.method === 'GET') {
    (async () => {
      try {
        if (fs.statSync(sessionPath).size > 32 * 1024 * 1024) throw Error('Session exceeds audit size limit');
        const sessionBytes = fs.readFileSync(sessionPath);
        const payload = JSON.parse(sessionBytes.toString('utf8'));
        const references = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data', 'approved-references.json'), 'utf8'));
        const catalog = readiness.catalogOf(references);
        const history = datasetReviews.readHistory(reviewDirectory);
        const sealed = datasetReviews.sealedPages(history);
        for (const sheet of payload.sheets) if (sheet.split === 'sealed_test') sealed.add(sheet.id);
        const report = readiness.audit(payload, catalog, await readiness.sourceIndex(ROOT_DIR), sealed);
        report.review_head = history.at(-1)?.hash || null;
        for (const page of report.pages) {
          page.review = datasetReviews.pageReview(history, payload.sheets.find(s => s.id === page.id), report.catalog_version);
          page.sealed_test = sealed.has(page.id);
        }
        report.proposed_class_coverage = readiness.proposedClassCoverage(report, catalog);
        if (pathname === '/api/dataset-symbol-candidates') {
          sendJson(res, 200, readiness.symbolCandidates(payload, report, catalog, readiness.digest(sessionBytes)));
          return;
        }
        report.legend_previews = Object.fromEntries(catalog.entries.map(entry => [entry.id, {
          label: entry.label,
          examples: entry.examples.flatMap(example => {
            const page = report.pages.find(p => p.id === example.source_sheet_id);
            const box = example.geometry?.coordinates;
            if (!page?.source_verified || page.sealed_test || !readiness.validBox({ geometry: example.geometry }, page)) return [];
            return [{ image_url: page.image_url, box, page_id: page.id }];
          }).slice(0, 2),
        }]));
        sendJson(res, 200, report);
      } catch {
        sendJson(res, 422, { error: 'Readiness audit unavailable. Check saved session and local reference integrity.' });
      }
    })();
    return;
  }

  function countUserEdits(session) {
    if (!session || !Array.isArray(session.sheets)) return 0;
    let count = 0;
    for (const s of session.sheets) {
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
    if (session.decisions && typeof session.decisions === 'object') {
      for (const d of Object.values(session.decisions)) {
        if (d && (d.decision || (d.notes && d.notes.trim()))) count++;
      }
    }
    if (session.legend_colors && typeof session.legend_colors === 'object') {
      count += Object.keys(session.legend_colors).length;
    }
    return count;
  }

  if (pathname === '/api/session') {
    if (req.method === 'GET') {
      if (fs.existsSync(sessionPath)) {
        try {
          const stats = fs.statSync(sessionPath);
          const raw = fs.readFileSync(sessionPath, 'utf8');
          const data = JSON.parse(raw);
          const edits = countUserEdits(data);
          sendJson(res, 200, {
            status: 'success',
            saved_at: stats.mtime.toISOString(),
            session: data,
            edit_count: edits
          });
          return;
        } catch (e) {
          sendJson(res, 500, { status: 'error', error: 'Failed to read saved session: ' + e.message });
          return;
        }
      }
      sendJson(res, 200, { status: 'none', message: 'No saved session found.' });
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 50 * 1024 * 1024) {
          res.writeHead(413, { 'Content-Type': 'text/plain' });
          res.end('Payload Too Large');
          req.destroy();
        }
      });

      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const sessionData = payload.session || payload;
          if (!sessionData || !Array.isArray(sessionData.sheets)) {
            sendJson(res, 400, { status: 'error', error: 'Invalid session payload. Missing sheets array.' });
            return;
          }

          const dataDir = path.join(ROOT_DIR, 'data');
          if (!fs.existsSync(dataDir)) {
            try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}
          }
          if (!fs.existsSync(sessionSnapshotsDir)) {
            try { fs.mkdirSync(sessionSnapshotsDir, { recursive: true }); } catch {}
          }

          const incomingEdits = countUserEdits(sessionData);

          // Overwrite protection: If an on-disk session has edits, and incoming has 0 edits,
          // protect the user's progress and return the existing session.
          if (fs.existsSync(sessionPath)) {
            try {
              const existingRaw = fs.readFileSync(sessionPath, 'utf8');
              const existingData = JSON.parse(existingRaw);
              const existingEdits = countUserEdits(existingData);
              if (existingEdits > 0 && incomingEdits === 0) {
                console.warn(`[Session Protection] Refused overwrite of active session (${existingEdits} edits) with empty baseline.`);
                const existingStats = fs.statSync(sessionPath);
                sendJson(res, 200, {
                  status: 'protected',
                  message: 'Existing session with progress was preserved.',
                  saved_at: existingStats.mtime.toISOString(),
                  session: existingData,
                  edit_count: existingEdits
                });
                return;
              }
            } catch (inspectErr) {
              console.warn('[Session Protection] Existing session inspection notice:', inspectErr.message);
            }
          }

          // Atomic write: write to temp file first, then rename
          const tmpPath = path.join(dataDir, `saved-session-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.tmp`);
          fs.writeFileSync(tmpPath, JSON.stringify(sessionData, null, 2), 'utf8');

          // Keep prior session as backup if it exists
          if (fs.existsSync(sessionPath)) {
            try { fs.copyFileSync(sessionPath, sessionBackupPath); } catch {}
          }

          fs.renameSync(tmpPath, sessionPath);

          // Rolling snapshots: write timestamped snapshot and prune beyond 20
          try {
            const snapshotPath = path.join(sessionSnapshotsDir, `session-${Date.now()}.json`);
            fs.copyFileSync(sessionPath, snapshotPath);
            const snapshots = fs.readdirSync(sessionSnapshotsDir).filter(f => f.startsWith('session-') && f.endsWith('.json')).sort();
            if (snapshots.length > 20) {
              for (let i = 0; i < snapshots.length - 20; i++) {
                try { fs.unlinkSync(path.join(sessionSnapshotsDir, snapshots[i])); } catch {}
              }
            }
          } catch {}

          const totalAnnotations = sessionData.sheets.reduce((sum, s) => sum + (s.annotations?.length || 0), 0);

          sendJson(res, 200, {
            status: 'success',
            message: 'Session saved successfully.',
            saved_at: new Date().toISOString(),
            sheets_count: sessionData.sheets.length,
            annotations_count: totalAnnotations,
            edit_count: incomingEdits
          });
        } catch (e) {
          console.error('[Session Save] Error saving session:', e);
          sendJson(res, 500, { status: 'error', error: e.message });
        }
      });
      return;
    }

    if (req.method === 'DELETE') {
      try {
        if (fs.existsSync(sessionPath)) {
          fs.unlinkSync(sessionPath);
        }
        if (fs.existsSync(sessionBackupPath)) {
          fs.unlinkSync(sessionBackupPath);
        }
        sendJson(res, 200, { status: 'success', message: 'Saved session cleared.' });
      } catch (e) {
        sendJson(res, 500, { status: 'error', error: e.message });
      }
      return;
    }
  }

  // API Auto-Annotation endpoint
  if (pathname === '/api/auto-annotate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) { // 50MB limit
        res.writeHead(413, { 'Content-Type': 'text/plain' });
        res.end('Payload Too Large');
        req.destroy();
      }
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const sheetId = payload.sheet_id;
        const currentAnnotations = payload.current_annotations || [];
        const options = payload.options || {};
        const sheetMeta = payload.sheet_meta || null;

        if (!sheetId) {
          sendJson(res, 400, { error: 'Missing required field: sheet_id' });
          return;
        }

        const reviews = datasetReviews.readHistory(reviewDirectory);
        const saved = fs.existsSync(sessionPath) ? JSON.parse(fs.readFileSync(sessionPath, 'utf8')) : null;
        if (saved?.sheets?.find(s => s.id === sheetId)?.split === 'sealed_test') {
          sendJson(res, 409, { error: 'Sealed-test source excluded', code: 'SEALED_TEST_EXCLUDED' }); return;
        }
        const grouping = new Map();
        for (const record of reviews.filter(r => r.action === 'project_proposal')) grouping.set(record.page_id, record.value);
        const proposed = grouping.get(sheetId);
        const sealedProjects = new Set([...grouping.values()].filter(v => v.split === 'sealed_test').map(v => v.project));
        if (sheetMeta?.split === 'sealed_test' || proposed?.split === 'sealed_test' || sealedProjects.has(proposed?.project)) {
          sendJson(res, 409, { error: 'Sealed-test sources are excluded from automatic proposals', code: 'SEALED_TEST_EXCLUDED' }); return;
        }

        console.log(`[Auto-Annotate] Received request for sheet: ${sheetId}`);
        const annotateEngine = (delete require.cache[require.resolve('./auto-annotate.cjs')], require('./auto-annotate.cjs'));
        const result = await annotateEngine.runAutoAnnotation(sheetId, currentAnnotations, options, sheetMeta);
        console.log(`[Auto-Annotate] Generated ${result.annotations?.length || 0} proposals for ${sheetId}`);
        sendJson(res, 200, result);
      } catch (error) {
        console.error('[Auto-Annotate] Error processing request:', error);
        if (error.retryAfter) res.setHeader('Retry-After', error.retryAfter);
        sendJson(res, error.statusCode || 500, {
          error: error.message,
          code: error.code || 'auto_annotation_failed'
        });
      }
    });
    return;
  }

  // API Export Training Data endpoint (images, YOLO .txt labels, dataset.yaml)
  if (pathname === '/api/export-training-data' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 100 * 1024 * 1024) {
        res.writeHead(413, { 'Content-Type': 'text/plain' });
        res.end('Payload Too Large');
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        const reqData = JSON.parse(body || '{}');
        let reviewPayload = reqData.payload;
        if (!reviewPayload || !Array.isArray(reviewPayload.sheets)) {
          const defaultPath = fs.existsSync(path.join(ROOT_DIR, 'data', 'labeled-review.json'))
            ? path.join(ROOT_DIR, 'data', 'labeled-review.json')
            : path.join(ROOT_DIR, 'data', 'starting-progress.json');
          if (fs.existsSync(defaultPath)) {
            reviewPayload = JSON.parse(fs.readFileSync(defaultPath, 'utf8'));
          } else {
            sendJson(res, 400, { error: 'No review payload provided and baseline data not found.' });
            return;
          }
        }

        const { exportYoloDataset } = require('./scripts/export-yolo-dataset.cjs');
        const outputDir = reqData.outputDir || path.join(ROOT_DIR, 'training_dataset');
        const summary = exportYoloDataset(reviewPayload, { outputDir });

        sendJson(res, 200, {
          status: 'success',
          summary,
          message: `Saved ${summary.total_bounding_boxes} labels across ${summary.total_sheets} sheets to ${outputDir}`
        });
      } catch (error) {
        if (error.code !== 'DATASET_NOT_READY') console.error('[Export Training Data] Export failed.');
        sendJson(res, error.code === 'DATASET_NOT_READY' ? 409 : 500, { error: error.message, code: error.code });
      }
    });
    return;
  }

  // Serve static assets
  if (req.method === 'GET') {
    serveStatic(req, res, pathname);
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain' });
  res.end('Method Not Allowed');
});

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`VED Review & Auto-Annotation Server running at http://127.0.0.1:${PORT}/`);
    console.log(`Custom VED YOLO available: ${isYoloAvailable()} (${path.basename(getYoloModelPath())})`);
    console.log('Local-only annotation: hosted providers and automatic training are disabled.');
  });
}

module.exports = server;
