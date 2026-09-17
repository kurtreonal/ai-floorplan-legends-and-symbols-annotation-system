// auto-annotate.cjs
// Automatic symbol annotation engine for VED portable review workspace
// Implements GEMINI-SYMBOL-DETECTION-HANDOFF.md and GEMINI-SYMBOL-DETECTION-PROMPT.txt
// Uses custom VED YOLO weights, with existing cloud fallbacks, overlapping tiles and reference examples.

const fs = require('fs');
const path = require('path');
const os = require('os');
const child_process = require('child_process');

// Automatically load .env file if present
const envPath = path.join(__dirname, '.env');
if (!process.env.DISABLE_ENV_LOAD && typeof process.loadEnvFile === 'function' && fs.existsSync(envPath)) {
  try { process.loadEnvFile(envPath); } catch {}
}

const crypto = require('crypto');
const sharp = require('sharp');
const AnnotationCore = require('./editor-core.js');

const referencesPathCandidate1 = path.join(__dirname, 'data', 'approved-references.json');
const referencesPathCandidate2 = path.join(__dirname, 'approved-references.json');
const referencesPath = fs.existsSync(referencesPathCandidate1) ? referencesPathCandidate1 : referencesPathCandidate2;

const promptPathCandidate1 = path.join(__dirname, 'docs', 'GEMINI-SYMBOL-DETECTION-PROMPT.txt');
const promptPathCandidate2 = path.join(__dirname, 'GEMINI-SYMBOL-DETECTION-PROMPT.txt');
const promptPathCandidate3 = path.join(__dirname, '..', '..', 'GEMINI-SYMBOL-DETECTION-PROMPT.txt');
let promptPath = promptPathCandidate1;
if (!fs.existsSync(promptPath) && fs.existsSync(promptPathCandidate2)) promptPath = promptPathCandidate2;
if (!fs.existsSync(promptPath) && fs.existsSync(promptPathCandidate3)) promptPath = promptPathCandidate3;

let cachedReferenceData = null;
let cachedReferenceMtime = 0;

function loadReferences(forceReload = false) {
  if (!fs.existsSync(referencesPath)) return null;
  const stat = fs.statSync(referencesPath);
  if (forceReload || !cachedReferenceData || stat.mtimeMs !== cachedReferenceMtime) {
    cachedReferenceData = JSON.parse(fs.readFileSync(referencesPath, 'utf8'));
    cachedReferenceMtime = stat.mtimeMs;
  }
  return cachedReferenceData;
}

function loadSystemPrompt() {
  if (fs.existsSync(promptPath)) {
    return fs.readFileSync(promptPath, 'utf8');
  }
  return 'You detect missing symbols in a VED floor-plan drawing using approved workspace examples.';
}

// Convert 0-1000 normalized [ymin, xmin, ymax, xmax] to [xmin, ymin, xmax, ymax] in sheet pixels
function convertBoxToSheetPixels(box_2d, width, height) {
  const [ymin, xmin, ymax, xmax] = box_2d;
  const pxMinX = Math.max(0, Math.min(width, Math.round((xmin * width) / 1000.0)));
  const pxMinY = Math.max(0, Math.min(height, Math.round((ymin * height) / 1000.0)));
  const pxMaxX = Math.max(0, Math.min(width, Math.round((xmax * width) / 1000.0)));
  const pxMaxY = Math.max(0, Math.min(height, Math.round((ymax * height) / 1000.0)));
  return [pxMinX, pxMinY, pxMaxX, pxMaxY];
}

// Convert tile-relative 0-1000 box [ymin, xmin, ymax, xmax] to full sheet pixel coordinates
function convertTileBoxToSheetPixels(box_2d, tile) {
  const [ymin, xmin, ymax, xmax] = box_2d;
  const pxMinX = Math.round(tile.x0 + (xmin * tile.w) / 1000.0);
  const pxMinY = Math.round(tile.y0 + (ymin * tile.h) / 1000.0);
  const pxMaxX = Math.round(tile.x0 + (xmax * tile.w) / 1000.0);
  const pxMaxY = Math.round(tile.y0 + (ymax * tile.h) / 1000.0);
  return [pxMinX, pxMinY, pxMaxX, pxMaxY];
}

// Generate overlapping tiles for large drawings
function generateOverlappingTiles(width, height, tileSize = 1024, overlap = 200) {
  if (width <= 1200 && height <= 1200) {
    return [{ id: 'tile-r0c0', x0: 0, y0: 0, x1: width, y1: height, w: width, h: height }];
  }
  const step = Math.max(100, tileSize - overlap);
  const tiles = [];
  let col = 0;
  for (let x = 0; x < width; x += step) {
    let x0 = x;
    let x1 = Math.min(width, x0 + tileSize);
    if (x1 - x0 < tileSize && x0 > 0) {
      x0 = Math.max(0, width - tileSize);
      x1 = width;
    }
    let row = 0;
    for (let y = 0; y < height; y += step) {
      let y0 = y;
      let y1 = Math.min(height, y0 + tileSize);
      if (y1 - y0 < tileSize && y0 > 0) {
        y0 = Math.max(0, height - tileSize);
        y1 = height;
      }
      tiles.push({
        id: `tile-r${row}c${col}`,
        x0, y0, x1, y1,
        w: x1 - x0,
        h: y1 - y0
      });
      row++;
      if (y1 >= height) break;
    }
    col++;
    if (x1 >= width) break;
  }
  return tiles;
}

// Check IoU between two bounding boxes [xmin, ymin, xmax, ymax]
function computeIoU(b1, b2) {
  const xA = Math.max(b1[0], b2[0]);
  const yA = Math.max(b1[1], b2[1]);
  const xB = Math.min(b1[2], b2[2]);
  const yB = Math.min(b1[3], b2[3]);
  const interW = Math.max(0, xB - xA);
  const interH = Math.max(0, yB - yA);
  const interArea = interW * interH;
  const area1 = (b1[2] - b1[0]) * (b1[3] - b1[1]);
  const area2 = (b2[2] - b2[0]) * (b2[3] - b2[1]);
  const union = area1 + area2 - interArea;
  return union > 0 ? interArea / union : 0;
}

// Check containment ratio of b1 in b2
function computeContainment(b1, b2) {
  const xA = Math.max(b1[0], b2[0]);
  const yA = Math.max(b1[1], b2[1]);
  const xB = Math.min(b1[2], b2[2]);
  const yB = Math.min(b1[3], b2[3]);
  const interW = Math.max(0, xB - xA);
  const interH = Math.max(0, yB - yA);
  const interArea = interW * interH;
  const area1 = (b1[2] - b1[0]) * (b1[3] - b1[1]);
  return area1 > 0 ? interArea / area1 : 0;
}

// Build 4x4 contact sheets of 256x256 cells using Sharp
// Up to 4 contact sheets (total 64 reference cells max)
async function buildContactSheets(referenceItems) {
  const contactSheets = [];
  const manifestReferences = [];
  const itemsPerSheet = 16;
  const maxSheets = 4;
  const totalItems = Math.min(referenceItems.length, itemsPerSheet * maxSheets);

  for (let sIdx = 0; sIdx < maxSheets; sIdx++) {
    const start = sIdx * itemsPerSheet;
    if (start >= totalItems) break;
    const end = Math.min(totalItems, start + itemsPerSheet);
    const sheetItems = referenceItems.slice(start, end);

    const sheetId = `refs-${sIdx}`;
    const composites = [];

    for (let i = 0; i < sheetItems.length; i++) {
      const item = sheetItems[i];
      const r = Math.floor(i / 4);
      const c = i % 4;
      const cellLeft = c * 256;
      const cellTop = r * 256;
      const token = `REF-${String(start + i + 1).padStart(2, '0')}`;

      // Crop and resize sample glyph
      let cropBuffer = null;
      try {
        if (item.source_buffer) {
          const w = Math.max(1, Math.round(item.geometry.coordinates[2] - item.geometry.coordinates[0]));
          const h = Math.max(1, Math.round(item.geometry.coordinates[3] - item.geometry.coordinates[1]));
          const l = Math.max(0, Math.round(item.geometry.coordinates[0]));
          const t = Math.max(0, Math.round(item.geometry.coordinates[1]));
          cropBuffer = await sharp(item.source_buffer)
            .extract({ left: l, top: t, width: w, height: h })
            .resize(236, 236, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
            .png()
            .toBuffer();
        }
      } catch (err) {
        // Fallback placeholder if crop failed
      }

      if (cropBuffer) {
        composites.push({ input: cropBuffer, left: cellLeft + 10, top: cellTop + 10 });
      }

      // Token label badge
      const tokenBadgeSvg = Buffer.from(
        `<svg width="68" height="20"><rect width="68" height="20" rx="3" fill="#0f172a"/><text x="6" y="14" fill="#f8fafc" font-size="11" font-weight="bold" font-family="sans-serif">${token}</text></svg>`
      );
      composites.push({ input: tokenBadgeSvg, left: cellLeft + 6, top: cellTop + 6 });

      manifestReferences.push({
        reference_id: item.reference_id || token,
        token: token,
        contact_sheet: sheetId,
        cell: `r${r}c${c}`,
        legend_entry: item.legend_entry || null,
        label: item.label || 'Reference example',
        role: item.role || 'approved_example',
        source_sheet_id: item.source_sheet_id
      });
    }

    // Grid divider lines
    const gridSvg = Buffer.from(
      `<svg width="1024" height="1024">
        <line x1="256" y1="0" x2="256" y2="1024" stroke="#cbd5e1" stroke-width="1"/>
        <line x1="512" y1="0" x2="512" y2="1024" stroke="#cbd5e1" stroke-width="1"/>
        <line x1="768" y1="0" x2="768" y2="1024" stroke="#cbd5e1" stroke-width="1"/>
        <line x1="0" y1="256" x2="1024" y2="256" stroke="#cbd5e1" stroke-width="1"/>
        <line x1="0" y1="512" x2="1024" y2="512" stroke="#cbd5e1" stroke-width="1"/>
        <line x1="0" y1="768" x2="1024" y2="768" stroke="#cbd5e1" stroke-width="1"/>
      </svg>`
    );
    composites.push({ input: gridSvg, left: 0, top: 0 });

    const contactBuffer = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: { r: 255, g: 255, b: 255 } }
    }).composite(composites).png().toBuffer();

    contactSheets.push({
      id: sheetId,
      mime_type: 'image/png',
      data: contactBuffer.toString('base64')
    });
  }

  return { contactSheets, manifestReferences };
}

// Candidate models ordered for automatic model hopping & resilient fallback
const DEFAULT_CANDIDATE_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-latest'
];

let lastSuccessfulTargetLabel = null;
// Per-model cooldowns survive across tiles and runs until the server restarts.
const targetCooldowns = new Map();
function targetKey(target) {
  const credential = crypto.createHash('sha256').update(target.apiKey || '').digest('hex');
  return `${target.provider}:${target.model}:${credential}`;
}
function cooldownRemaining(target) {
  const key = targetKey(target);
  const until = targetCooldowns.get(key) || 0;
  if (until <= Date.now()) { targetCooldowns.delete(key); return 0; }
  return until - Date.now();
}
function parseResetDuration(value) {
  if (!value) return 0;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value) * 1000;
  let ms = 0;
  const matches = [...value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)];
  if (matches.map(m => m[0]).join('') !== value) return 0;
  for (const [, number, unit] of matches) ms += Number(number) * ({ms:1,s:1000,m:60000,h:3600000,d:86400000}[unit]);
  return ms;
}
async function providerError(target, res) {
  const body = await res.json().catch(() => ({}));
  const detail = body.error || {};
  const error = new Error(`${target.label} [${res.status}]: ${detail.message || res.statusText || 'Provider request failed'}`);
  error.statusCode = res.status;
  error.code = detail.code || detail.status || 'provider_error';
  error.failedGeneration = detail.failed_generation;
  const retry = res.headers.get('retry-after');
  let delay = retry ? (/^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 0;
  if (!Number.isFinite(delay)) delay = 0;
  for (const bucket of ['tokens', 'requests']) {
    if (res.headers.get(`x-ratelimit-remaining-${bucket}`) === '0') {
      delay = Math.max(delay, parseResetDuration(res.headers.get(`x-ratelimit-reset-${bucket}`)));
    }
  }
  // No reset supplied: pause a model for 60s (Groq), 5m for Gemini quota errors.
  error.retryAfterMs = Math.max(1000, delay || (target.provider === 'gemini' ? 300000 : 60000));
  return error;
}

function getCandidateModels() {
  const envModels = process.env.GEMINI_MODELS || process.env.GEMINI_MODEL;
  if (envModels) {
    const custom = envModels.split(',').map(s => s.trim()).filter(Boolean);
    const combined = [...custom];
    for (const m of DEFAULT_CANDIDATE_MODELS) {
      if (!combined.includes(m)) combined.push(m);
    }
    return combined;
  }
  return [...DEFAULT_CANDIDATE_MODELS];
}

// Python 3.11 environment resolver for local YOLO
let cachedPythonCmd = null;

function resolvePythonCommand() {
  if (cachedPythonCmd) return cachedPythonCmd;

  if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
    cachedPythonCmd = { cmd: process.env.PYTHON_PATH, args: [] };
    return cachedPythonCmd;
  }

  const py311Path = 'C:\\Users\\kupal\\AppData\\Local\\Programs\\Python\\Python311\\python.exe';
  if (fs.existsSync(py311Path)) {
    cachedPythonCmd = { cmd: py311Path, args: [] };
    return cachedPythonCmd;
  }

  try {
    const res = child_process.spawnSync('py', ['-3.11', '--version'], { encoding: 'utf8', timeout: 3000 });
    if (res.status === 0) {
      cachedPythonCmd = { cmd: 'py', args: ['-3.11'] };
      return cachedPythonCmd;
    }
  } catch {}

  try {
    const res = child_process.spawnSync('python', ['--version'], { encoding: 'utf8', timeout: 3000 });
    if (res.status === 0) {
      cachedPythonCmd = { cmd: 'python', args: [] };
      return cachedPythonCmd;
    }
  } catch {}

  return null;
}

function getYoloModelPath() {
  return path.resolve(__dirname, process.env.YOLO_MODEL_PATH || 'models/ved-symbols.pt');
}

function isYoloAvailable() {
  const py = resolvePythonCommand();
  if (!py) return false;
  const scriptPath = path.join(__dirname, 'yolo_detect.py');
  if (!fs.existsSync(scriptPath)) return false;
  return fs.existsSync(getYoloModelPath());
}

// Builds the prioritized list of provider targets:
// 1. Primary: Custom VED symbol weights (generic COCO weights are training initialization only)
// 2. Cloud Primary: Gemini 3.8 Flash (if GEMINI_API_KEY is configured)
// 3. Cloud Vision Fallback: Groq Qwen 3.8 (if GROQ_API_KEY is configured)
// 4. Groq Model Fallback: Groq Qwen 3.6 (if Qwen 3.8 fails or is unavailable)
// 5. Cloud Gemini Fallbacks: Gemini other models (3.7, 3.6, 3.5, 3.5-lite, flash-latest)
function getCandidateTargets(options = {}) {
  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const groqModel = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';
  const groqFallbackModel = process.env.GROQ_FALLBACK_MODEL || 'qwen/qwen3.6-27b';
  const enableLocalYolo = process.env.ENABLE_LOCAL_YOLO !== 'false';

  const targets = [];

  // Selective overrides if requested in options
  if (options.useYoloOnly || process.env.YOLO_ONLY === 'true') {
    if (isYoloAvailable()) {
      targets.push({ provider: 'local_yolo', model: getYoloModelPath(), label: 'local/ved-symbols' });
    }
    return targets;
  }

  if (options.useGroqOnly && groqKey && groqKey.trim()) {
    targets.push({
      provider: 'groq',
      model: groqModel.trim(),
      label: `groq/${groqModel.trim()}`,
      apiKey: groqKey.trim()
    });
    if (groqFallbackModel && groqFallbackModel.trim() !== groqModel.trim()) {
      targets.push({
        provider: 'groq',
        model: groqFallbackModel.trim(),
        label: `groq/${groqFallbackModel.trim()}`,
        apiKey: groqKey.trim()
      });
    }
    return targets;
  }

  if (options.useGeminiOnly && geminiKey && geminiKey.trim()) {
    const candidateModels = getCandidateModels();
    for (const m of candidateModels) {
      targets.push({
        provider: 'gemini',
        model: m,
        label: m,
        apiKey: geminiKey.trim()
      });
    }
    return targets;
  }

  // --- STANDARD PRIORITIZED HIERARCHY ---

  // Use weights fine-tuned on VED symbols, not generic COCO object detectors.
  if (enableLocalYolo && isYoloAvailable()) {
    targets.push({
      provider: 'local_yolo',
      model: getYoloModelPath(),
      label: 'local/ved-symbols'
    });
  }

  // 2. Cloud Primary: Gemini 3.8 Flash
  if (geminiKey && geminiKey.trim()) {
    targets.push({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      label: 'gemini-3.8-flash',
      apiKey: geminiKey.trim()
    });
  }

  // 3. Groq Qwen 3.8 (Hop to Qwen 3.8 if 3.8 Flash fails or is tried)
  if (groqKey && groqKey.trim()) {
    targets.push({
      provider: 'groq',
      model: groqModel.trim(),
      label: `groq/${groqModel.trim()}`,
      apiKey: groqKey.trim()
    });

    // 4. Groq Qwen 3.6 fallback (Hop to 3.6 if 3.8 fails or is unavailable)
    if (groqFallbackModel && groqFallbackModel.trim() !== groqModel.trim()) {
      targets.push({
        provider: 'groq',
        model: groqFallbackModel.trim(),
        label: `groq/${groqFallbackModel.trim()}`,
        apiKey: groqKey.trim()
      });
    }
  }

  // 5. Fallback Gemini Models (Hop to other Gemini models if needed)
  if (geminiKey && geminiKey.trim()) {
    const geminiFallbacks = [
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-flash-latest'
    ];
    for (const m of geminiFallbacks) {
      targets.push({
        provider: 'gemini',
        model: m,
        label: m,
        apiKey: geminiKey.trim()
      });
    }
  }

  return targets;
}

function getCandidateTargetsForAttempt(options = {}) {
  const base = getCandidateTargets(options);
  const yoloTargets = base.filter(t => t.provider === 'local_yolo');
  const groqTargets = base.filter(t => t.provider === 'groq');
  const geminiTargets = base.filter(t => t.provider === 'gemini');
  // In the mixed mode, try the primary Gemini once, then Qwen 3.8 -> 3.6.
  // Do not fan out into five more paid Gemini models after the Qwen pair fails.
  const gemini = groqTargets.length ? geminiTargets.slice(0, 1) : geminiTargets;
  const preferGroq = groqTargets.some(t => t.label === lastSuccessfulTargetLabel || cooldownRemaining(t) > 0);
  const clouds = preferGroq ? [...groqTargets, ...gemini] : [...gemini, ...groqTargets];
  return [...yoloTargets, ...clouds];
}

// Robust JSON extraction supporting raw JSON, markdown codeblocks, and reasoning tags
function extractJson(text) {
  if (!text) throw new Error('Empty text response from model.');
  let trimmed = text.trim();
  // Strip reasoning tags from thinking models like Qwen 3.6 (<think>...</think>)
  trimmed = trimmed.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) {
      return JSON.parse(fenceMatch[1].trim());
    }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
    throw e;
  }
}

function validateGroqDetection(parsed) {
  if (!parsed || parsed.status !== 'ok' || !Array.isArray(parsed.annotations)) {
    throw new Error('Qwen returned an invalid detection object.');
  }
  for (const annotation of parsed.annotations) {
    if (annotation && !annotation.layer) annotation.layer = 'symbols';
    const box = annotation?.box_2d;
    if (typeof annotation?.label !== 'string' || !annotation.label.trim() || annotation.label.length > 1000 ||
        !['symbols', 'unresolved'].includes(annotation.layer) || !Array.isArray(box) || box.length !== 4 ||
        !box.every(n => Number.isFinite(n) && n >= 0 && n <= 1000) || box[0] >= box[2] || box[1] >= box[3]) {
      throw new Error('Qwen returned invalid symbol labels or coordinates.');
    }
  }
  return parsed;
}

// Executes a single vision request against local YOLO, Gemini, or Groq
async function executeTargetRequest(target, requestContext, timeoutMs, isLastTarget = false) {
  const { manifest, systemInstruction, responseSchema, targetBase64, contactSheets } = requestContext;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (target.provider === 'gemini') {
      const parts = [
        { text: `JSON Manifest:\n${JSON.stringify(manifest, null, 2)}` },
        { inline_data: { mime_type: 'image/png', data: targetBase64 } }
      ];
      for (const cs of contactSheets) {
        parts.push({ inline_data: { mime_type: cs.mime_type, data: cs.data } });
      }
      const requestBody = {
        contents: [{ parts }],
        system_instruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          response_mime_type: 'application/json',
          response_schema: responseSchema
        }
      };

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${target.model}:generateContent`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': target.apiKey
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!res.ok) {
        throw await providerError(target, res);
      }

      const data = await res.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      const parsed = extractJson(rawText);
      return { data, rawText, parsedResponse: parsed, modelUsed: target.label };
    }

    if (target.provider === 'groq') {
      // Optimize image format and resolution to fit safely within Groq's 7000 ITPM & payload limits
      const targetJpegBuf = await sharp(Buffer.from(targetBase64, 'base64'))
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer();

      const refLabels = (manifest.references || []).slice(0, 15).map(r => r.label || r.reference_id);
      const groqSystemPrompt = 'You are an architectural symbol detector. Identify visible symbols in the floor plan tile. Return only one complete JSON object: {"status":"ok","annotations":[{"label":"short label","layer":"symbols","box_2d":[ymin,xmin,ymax,xmax]}]}. Coordinates are normalized 0-1000. Use short labels. No explanations, reasoning tags, markdown, or extra fields. An empty annotations array is valid when no symbols are visible. Always close every array and object.';

      const userContent = [
        {
          type: 'text',
          text: `Tile: ${manifest.tile_id}. Candidate symbols to detect: ${refLabels.join(', ') || 'receptacle, switch, light, panel, furniture'}.\nOutput strictly JSON.`
        },
        {
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${targetJpegBuf.toString('base64')}` }
        }
      ];

      const groqPayload = {
        model: target.model,
        messages: [
          { role: 'system', content: groqSystemPrompt },
          { role: 'user', content: userContent }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: parseInt(process.env.GROQ_MAX_TOKENS || '800', 10)
      };
      // Both configured Qwen models support disabling reasoning. This keeps the
      // existing output-token budget for JSON rather than spending it on thinking.
      if (/qwen3\.(?:6|8)-/.test(target.model)) {
        groqPayload.reasoning_effort = 'none';
        groqPayload.reasoning_format = 'hidden';
      }

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${target.apiKey}`
        },
        body: JSON.stringify(groqPayload),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!res.ok) {
        const error = await providerError(target, res);
        // Recover only complete, validated JSON already returned by the provider.
        // Never spend another request repairing malformed or truncated output.
        if (res.status === 400 && error.code === 'json_validate_failed' && typeof error.failedGeneration === 'string') {
          try {
            const parsed = validateGroqDetection(extractJson(error.failedGeneration));
            return { data: { recovered_from_error: true }, rawText: JSON.stringify(parsed), parsedResponse: parsed, modelUsed: target.label };
          } catch {}
        }
        throw error;
      }

      const data = await res.json();
      if (data.choices?.[0]?.finish_reason !== 'stop') {
        throw new Error(`${target.label}: incomplete output (${data.choices?.[0]?.finish_reason || 'missing finish reason'}). No automatic paid retry.`);
      }
      const rawText = data.choices?.[0]?.message?.content;
      const parsed = validateGroqDetection(extractJson(rawText));
      return { data, rawText, parsedResponse: parsed, modelUsed: target.label };
    }

    if (target.provider === 'local_yolo') {
      const pyCmd = resolvePythonCommand();
      if (!pyCmd) {
        throw new Error('Python 3.11 with Ultralytics is not available for local YOLO inference.');
      }

      const tmpDir = path.join(__dirname, '.temp');
      if (!fs.existsSync(tmpDir)) {
        try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}
      }
      const tmpPath = path.join(tmpDir, `yolo-tile-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`);
      fs.writeFileSync(tmpPath, Buffer.from(targetBase64, 'base64'));

      try {
        const scriptPath = path.join(__dirname, 'yolo_detect.py');
        const confThreshold = process.env.YOLO_CONF || '0.20';
        const spawnArgs = [...pyCmd.args, scriptPath, '--image', tmpPath, '--model', target.model, '--conf', confThreshold];

        const proc = child_process.spawnSync(pyCmd.cmd, spawnArgs, {
          encoding: 'utf8',
          timeout: Math.min(timeoutMs, 30000),
          cwd: __dirname
        });

        if (proc.error) {
          throw proc.error;
        }

        if (proc.status !== 0) {
          const errStderr = (proc.stderr || '').trim();
          throw new Error(`${target.label} exited with code ${proc.status}: ${errStderr}`);
        }

        let parsedOutput = null;
        try {
          parsedOutput = JSON.parse(proc.stdout.trim());
        } catch (parseErr) {
          throw new Error(`${target.label} output parsing error: ${proc.stdout}`);
        }

        if (parsedOutput.status === 'error') {
          throw new Error(`${target.label} reported error: ${parsedOutput.error}`);
        }

        const detections = parsedOutput.detections || [];
        if (detections.length === 0) {
          // A completed custom-model inference with no boxes is a valid result.
          // Do not spend cloud tokens merely because this tile is empty.
          {
            return {
              data: parsedOutput,
              rawText: JSON.stringify(parsedOutput),
              parsedResponse: {
                status: 'ok',
                request_id: manifest.request_id,
                sheet_id: manifest.sheet_id,
                tile_id: manifest.tile_id,
                message: 'No symbols detected.',
                annotations: []
              },
              modelUsed: target.label
            };
          }
        }

        const annotations = detections.map(d => ({
          reference_id: null,
          legend_entry: null,
          label: d.label,
          layer: 'symbols',
          box_2d: d.box_2d,
          match_quality: d.confidence >= 0.5 ? 'strong' : 'tentative',
          evidence: d.evidence || `YOLO ${target.model} detection (${d.confidence})`,
          truncated: false
        }));

        return {
          data: parsedOutput,
          rawText: JSON.stringify(parsedOutput),
          parsedResponse: {
            status: 'ok',
            request_id: manifest.request_id,
            sheet_id: manifest.sheet_id,
            tile_id: manifest.tile_id,
            message: `Detected ${annotations.length} symbols via local YOLO (${target.model}).`,
            annotations
          },
          modelUsed: target.label
        };
      } finally {
        try {
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch {}
      }
    }

    throw new Error(`Unsupported provider: ${target.provider}`);
  } finally {
    clearTimeout(timer);
  }
}

// Single fallback pass: custom YOLO -> configured cloud providers.
async function callMultiProviderWithModelHopping(requestContext, tileId, options = {}) {
  const candidateTargets = getCandidateTargetsForAttempt(options);
  if (!candidateTargets.length) {
    throw new Error('No AI providers configured. Set GEMINI_API_KEY and/or GROQ_API_KEY in .env, or ensure local YOLO models are present.');
  }

  const configuredTimeout = Number(process.env.GEMINI_TIMEOUT_MS || 90000);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 90000;
  const lastGroq = candidateTargets.filter(t => t.provider === 'groq').at(-1);
  let lastError = null;
  let overallAttempt = 0;

  // One pass only: never repeat paid requests through GEMINI_MAX_ROUNDS.
  for (let i = 0; i < candidateTargets.length; i++) {
    const target = candidateTargets[i];
    const remaining = cooldownRemaining(target);
    if (remaining > 0) {
      console.log('[Auto-Annotate] Skipping ' + target.label + ' during cooldown (' + Math.ceil(remaining / 1000) + 's remaining).');
      if (target === lastGroq) break;
      continue;
    }
    overallAttempt++;
    const isLastTarget = candidateTargets.every(t => t.provider === 'local_yolo') && i === candidateTargets.length - 1;
    console.log('[Auto-Annotate] Calling ' + target.label + ' for ' + tileId + ' (Attempt ' + overallAttempt + ', single pass)...');
    try {
      const result = await executeTargetRequest(target, requestContext, timeoutMs, isLastTarget);
      if (target.provider !== 'local_yolo') lastSuccessfulTargetLabel = target.label;
      console.log('[Auto-Annotate] Generation succeeded with ' + target.label + ' on ' + tileId + '!');
      return result;
    } catch (error) {
      lastError = error;
      if (lastSuccessfulTargetLabel === target.label) lastSuccessfulTargetLabel = null;
      if (error.statusCode === 429) {
        targetCooldowns.set(targetKey(target), Date.now() + error.retryAfterMs);
        console.warn('[Auto-Annotate] ' + target.label + ' reached its limit; paused for ' + Math.ceil(error.retryAfterMs / 1000) + 's.');
      } else {
        console.warn('[Auto-Annotate] ' + target.label + ' failed (' + String(error.message || 'Request failed').slice(0, 120) + ').');
      }
      // Qwen 3.6 is the final cloud fallback: do not fan out or start more rounds.
      if (target === lastGroq) break;
    }
  }

  const cooling = candidateTargets.map(t => cooldownRemaining(t)).filter(ms => ms > 0);
  const finalError = new Error('Detection stopped after one fallback pass on ' + tileId + '. No repeated paid attempts. ' + (lastError?.message || 'Available models are cooling down.'));
  finalError.statusCode = lastError?.statusCode === 429 || (!lastError && cooling.length) ? 429 : 503;
  finalError.code = finalError.statusCode === 429 ? 'model_rate_limited' : 'all_models_unavailable';
  if (cooling.length) finalError.retryAfter = String(Math.ceil(Math.min(...cooling) / 1000));
  throw finalError;
}

// Runs local YOLO model on a single cropped tile image at zero token cost
function runYoloOnTile(targetBase64, tile, options = {}) {
  const pyCmd = resolvePythonCommand();
  if (!pyCmd) {
    return { status: 'unavailable', error: 'Python 3.11 not found', detections: [] };
  }
  const modelPath = options.yoloModel || getYoloModelPath();
  if (!fs.existsSync(modelPath)) {
    return { status: 'unavailable', error: 'YOLO model file not found', detections: [] };
  }

  const tmpDir = path.join(__dirname, '.temp');
  if (!fs.existsSync(tmpDir)) {
    try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}
  }
  const tmpPath = path.join(tmpDir, `yolo-tile-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`);
  fs.writeFileSync(tmpPath, Buffer.from(targetBase64, 'base64'));

  try {
    const scriptPath = path.join(__dirname, 'yolo_detect.py');
    const confThreshold = options.yoloConf || process.env.YOLO_CONF || '0.15';
    const spawnArgs = [...pyCmd.args, scriptPath, '--image', tmpPath, '--model', modelPath, '--conf', String(confThreshold)];

    const proc = child_process.spawnSync(pyCmd.cmd, spawnArgs, {
      encoding: 'utf8',
      timeout: 30000,
      cwd: __dirname
    });

    if (proc.error) {
      return { status: 'error', error: proc.error.message, detections: [] };
    }
    if (proc.status !== 0) {
      return { status: 'error', error: (proc.stderr || '').trim(), detections: [] };
    }

    const parsed = JSON.parse(proc.stdout.trim());
    return {
      status: parsed.status || 'ok',
      detections: parsed.detections || [],
      model: path.basename(modelPath)
    };
  } catch (err) {
    return { status: 'error', error: err.message, detections: [] };
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
  }
}

// Standard symbol label mapping for architectural and electrical plans
const STANDARD_SYMBOL_MAPPING = {
  'receptacle_duplex': 'Duplex 3-prong power outlet',
  'duplex_3_prong_power_outlet': 'Duplex 3-prong power outlet',
  'duplex_power_outlet': 'Duplex 3-prong power outlet',
  'duplex_outlet': 'Duplex 3-prong power outlet',
  'duplex': 'Duplex 3-prong power outlet',
  'c.o.': 'Duplex 3-prong power outlet',
  'co': 'Duplex 3-prong power outlet',
  'wall_fan': 'Wall fan',
  'wf': 'Wall fan',
  'air_conditioning_unit': 'Air conditioning unit',
  '1.50 acu': 'Air conditioning unit',
  'acu': 'Air conditioning unit',
  'circuit_homerun': 'Circuit homerun',
  'homerun': 'Circuit homerun',
  'panelboard': 'Panelboard',
  'mdp': 'Panelboard'
};

function normalizeSymbolLabel(raw) {
  if (!raw) return 'Candidate device';
  const clean = String(raw).toLowerCase().trim().replace(/[-_]/g, ' ');

  if (clean.includes('air conditioning') || clean.includes('acu') || /\b1\.50\s*acu\b/.test(clean)) {
    return 'Air conditioning unit';
  }
  if (clean.includes('wall fan') || /\bwf\b/.test(clean)) {
    return 'Wall fan';
  }
  if (clean.includes('circuit homerun') || clean.includes('homerun')) {
    return 'Circuit homerun';
  }
  if (clean.includes('panelboard') || /\bmdp\b/.test(clean) || clean.includes('panel')) {
    return 'Panelboard';
  }
  if (clean.includes('duplex') || clean.includes('receptacle') || /\bc\.?o\.?\b/.test(clean) || clean.includes('power outlet') || clean.includes('convenience outlet')) {
    return 'Duplex 3-prong power outlet';
  }
  return raw;
}

function computeBoxDistance(b1, b2) {
  const c1y = (b1[0] + b1[2]) / 2;
  const c1x = (b1[1] + b1[3]) / 2;
  const c2y = (b2[0] + b2[2]) / 2;
  const c2x = (b2[1] + b2[3]) / 2;
  return Math.hypot(c1y - c2y, c1x - c2x);
}

// Multi-Model Electrical Symbol Detector & Arbiter (Gemini + Qwen):
// Uses Gemini (gemini-3.6-flash / 3.8-flash) and Groq Qwen (qwen3.8-27b) to detect
// all electrical symbols (duplex C.O., wall fan WF, air conditioner ACU, panelboard, circuit homerun)
// and arbitrate what to detect and what to reject (pruning door swings and false homeruns).
// Sends single tile image with zero contact sheets (<85% token usage).
async function improveDetectionsWithApi(targetBase64, tile, yoloDetections = [], candidateClasses = [], sheetId, options = {}) {
  const priors = (yoloDetections || []).map((d, i) => ({
    id: `c${i + 1}`,
    box_2d: d.box_2d,
    tentative_label: d.label,
    confidence: d.confidence
  }));

  const systemInstruction = `You are an expert electrical blueprint symbol detector and arbiter.
Your mission is to detect all genuine electrical symbols in this floor plan tile image with normalized 0-1000 bounding boxes [ymin, xmin, ymax, xmax].

IMPORTANT ELECTRICAL SYMBOL CLASSES TO DETECT:
1. "receptacle_duplex": Duplex convenience outlet (small circle with 2 prongs or hash marks crossing through it, or labeled 'C.O.'). Detect every single C.O. outlet!
2. "wall_fan": Wall fan (circle containing 'WF' letters). Detect all WF circles!
3. "air_conditioning_unit": Air conditioning unit (circle containing a solid black triangular wedge pointer, labeled '1.50 ACU' or 'ACU').
4. "circuit_homerun": True circuit homerun (thick curved arc terminating directly at a panelboard tag circle like '4 / MDP' or '2 / MDP').
5. "panelboard": Distribution panel tag circle (such as '4 / MDP' or '2 / MDP').

STRICT REJECTION RULES - Decide what is NOT an electrical symbol:
- Architectural door swings (quarter-circle arcs with radial door lines) are NOT circuit homeruns. DISCARD them!
- Dimension lines, wall lines, room boundary markers, and grid numbers (like 1, 2, 3, 4) MUST NOT be detected as symbols.
- Title block text, sheet scales (e.g. 'SCALE 1:75'), and drawing titles (e.g. 'GROUND FLOOR POWER LAYOUT', '1/E-8') MUST NOT be detected.
- Never detect empty margins or white space outside the building walls.
- Bounding boxes must tightly fit around each symbol glyph (~20-35 pixels).

Return strictly valid JSON:
{"status":"ok","annotations":[{"label":"string","legend_entry":"string or null","layer":"symbols","box_2d":[ymin,xmin,ymax,xmax],"match_quality":"strong"|"tentative","evidence":"string","truncated":false}]}`;

  const userPrompt = `Tile ID: ${tile.id}.
Pre-detected candidate symbols from YOLO:
${JSON.stringify(priors, null, 2)}

Legend catalog definitions:
${JSON.stringify((candidateClasses || []).slice(0, 30), null, 2)}

Instructions:
1. Detect all visible electrical symbols on this tile within the building interior walls: specifically all C.O. duplex convenience outlets, all WF wall fans, all 1.50 ACU air conditioners, all panelboard circles, and true circuit homeruns.
2. DISCARD candidates in margins (grid bubbles 1, 2, 3, 4, dimension lines), door swings, wall lines, and title block text ('GROUND FLOOR POWER LAYOUT', '1/E-8', 'SCALE 1:75').
3. Classify ONLY true curved arcs connecting to panelboard circles as circuit_homerun. Reject door swings.
4. Tightly fit [ymin, xmin, ymax, xmax] around the electrical symbol glyph.
Output strictly valid JSON.`;

  const timeoutMs = 45000;
  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  if (!geminiKey && !groqKey) {
    throw new Error('No detection API key configured (GEMINI_API_KEY or GROQ_API_KEY required).');
  }

  // Sub-routine: Gemini detection
  async function runGeminiCall() {
    if (!geminiKey || !geminiKey.trim() || options.useGroqOnly) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const modelsToTry = [
      'gemini-3.5-flash',
      'gemini-flash-latest',
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.8-flash'
    ];
    try {
      for (const model of modelsToTry) {
        try {
          const parts = [
            { text: userPrompt },
            { inline_data: { mime_type: 'image/png', data: targetBase64 } }
          ];
          const requestBody = {
            contents: [{ parts }],
            system_instruction: { parts: [{ text: systemInstruction }] },
            generationConfig: {
              response_mime_type: 'application/json',
              temperature: 0.1
            }
          };
          const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
          let res = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': geminiKey.trim()
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
          });

          if (res.status === 503) {
            console.warn(`[Auto-Annotate] Gemini ${model} returned 503 demand spike. Retrying after 1.5s...`);
            await new Promise(r => setTimeout(r, 1500));
            res = await fetch(apiUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': geminiKey.trim()
              },
              body: JSON.stringify(requestBody),
              signal: controller.signal
            });
          }

          if (res.ok) {
            const data = await res.json();
            const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            const parsed = extractJson(rawText);
            if (parsed && Array.isArray(parsed.annotations)) {
              return { annotations: parsed.annotations, modelUsed: model };
            } else {
              console.warn(`[Auto-Annotate] Gemini ${model} response did not contain annotations array:`, rawText?.slice(0, 200));
            }
          } else {
            const errText = await res.text();
            console.warn(`[Auto-Annotate] Gemini ${model} HTTP error ${res.status}:`, errText.slice(0, 200));
          }
        } catch (err) {
          console.warn(`[Auto-Annotate] Gemini ${model} exception:`, err.message);
          if (err.name === 'AbortError') break;
        }
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Sub-routine: Groq Qwen detection
  async function runGroqCall() {
    if (!groqKey || !groqKey.trim() || options.useGeminiOnly) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const targetJpegBuf = await sharp(Buffer.from(targetBase64, 'base64'))
        .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();

      const groqModel = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';
      const groqSystemPrompt = `You are an expert electrical blueprint symbol detector.
Detect all visible electrical symbols on this tile within the building interior walls.
Important classes:
- "receptacle_duplex": All C.O. duplex convenience outlets (circle with 2 parallel prongs or hash marks).
- "wall_fan": All WF circles (circle with 'WF' letters).
- "air_conditioning_unit": All ACU air conditioners (circle with solid black triangle pointer).
- "panelboard": MDP panel circles (e.g. '4 / MDP', '2 / MDP').
- "circuit_homerun": True curved homerun arcs terminating at panel circles. (Do NOT detect door swings or wall lines!).

STRICT EXCLUSIONS:
- Do NOT detect grid numbers (1, 2, 3, 4) or dimension lines in margins.
- Do NOT detect title block text ('GROUND FLOOR POWER LAYOUT', '1/E-8', 'SCALE 1:75').
- Do NOT detect door swings.
Return strictly JSON: {"status":"ok","annotations":[{"label":"string","layer":"symbols","box_2d":[ymin,xmin,ymax,xmax]}]}`;

      const groqUserPrompt = `Candidate hints: ${JSON.stringify(priors.map(p => ({ label: p.tentative_label, box_2d: p.box_2d })))}\nDetect every C.O. duplex outlet, WF wall fan, 1.50 ACU, and true homerun arc. Discard door swings, title text, and margin markers.`;

      const groqPayload = {
        model: groqModel,
        messages: [
          { role: 'system', content: groqSystemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: groqUserPrompt },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${targetJpegBuf.toString('base64')}` } }
            ]
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 800,
        reasoning_format: 'hidden'
      };

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey.trim()}`
        },
        body: JSON.stringify(groqPayload),
        signal: controller.signal
      });

      if (res.ok) {
        const data = await res.json();
        const rawText = data.choices?.[0]?.message?.content;
        const parsed = validateGroqDetection(extractJson(rawText));
        if (parsed && Array.isArray(parsed.annotations)) {
          return { annotations: parsed.annotations, modelUsed: groqModel };
        }
      }
      return null;
    } catch (err) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  const runDual = !options.useGroqOnly && !options.useGeminiOnly && !!geminiKey && !!groqKey;
  let geminiResult = null;
  let groqResult = null;

  if (runDual) {
    const [gRes, qRes] = await Promise.allSettled([runGeminiCall(), runGroqCall()]);
    geminiResult = gRes.status === 'fulfilled' ? gRes.value : null;
    groqResult = qRes.status === 'fulfilled' ? qRes.value : null;
  } else if (geminiKey && !options.useGroqOnly) {
    geminiResult = await runGeminiCall();
  } else {
    groqResult = await runGroqCall();
  }

  if (!geminiResult && !groqResult) {
    throw new Error('No API detector returned a valid response');
  }

  // Combined Decision & Arbitration Logic
  const rawList = [];
  const primaryAnnotations = geminiResult?.annotations || groqResult?.annotations || [];
  const secondaryAnnotations = geminiResult && groqResult ? groqResult.annotations : [];
  const primaryModel = geminiResult ? geminiResult.modelUsed : groqResult.modelUsed;
  const secondaryModel = geminiResult && groqResult ? groqResult.modelUsed : null;

  for (const ann of primaryAnnotations) {
    const normLabel = normalizeSymbolLabel(ann.label);
    rawList.push({
      ...ann,
      label: normLabel,
      verified_by: [primaryModel]
    });
  }

  for (const sAnn of secondaryAnnotations) {
    const sNorm = normalizeSymbolLabel(sAnn.label);
    const box = sAnn.box_2d;
    if (!box || box.length !== 4) continue;
    const matchIdx = rawList.findIndex(c => {
      const iou = computeIoU(c.box_2d, box);
      const dist = computeBoxDistance(c.box_2d, box);
      return (c.label === sNorm && (iou > 0.20 || dist < 120)) || iou > 0.35 || dist < 50;
    });

    if (matchIdx >= 0) {
      rawList[matchIdx].verified_by.push(secondaryModel);
      rawList[matchIdx].match_quality = 'strong';
    } else if (!geminiResult) {
      // If Gemini was unavailable, accept secondary proposals only if inside building interior
      const [ymin, xmin, ymax, xmax] = box;
      const isMargin = xmin < 120 || xmax > 970 || ymin < 50 || ymax > 870;
      if (!isMargin) {
        rawList.push({
          ...sAnn,
          label: sNorm,
          verified_by: [secondaryModel],
          match_quality: 'tentative'
        });
      }
    }
  }

  // Prune false circuit homeruns:
  // True homeruns connect to panelboards. If an item is labeled 'Circuit homerun' but does not connect to an MDP panel
  // or was tagged as a door swing/wiring line, prune it.
  const panelCircles = rawList.filter(a => a.label === 'Panelboard');
  const filteredAnnotations = [];
  const panelHomerunSeen = new Set();

  for (const item of rawList) {
    if (item.label === 'Circuit homerun') {
      const nearestPanel = panelCircles.find(p => computeBoxDistance(item.box_2d, p.box_2d) < 160);
      const ev = (item.evidence || '').toLowerCase();
      const mentionsPanel = ev.includes('panel') || ev.includes('mdp') || ev.includes('curved arc');
      const mentionsDoor = ev.includes('door') || ev.includes('swing') || ev.includes('dimension');

      if (mentionsDoor) {
        // Explicitly rejected door swing
        continue;
      }
      if (!nearestPanel && !mentionsPanel) {
        // False homerun not connecting to any panel circle
        continue;
      }

      // Deduplicate if multiple models propose a homerun for the same panel
      if (nearestPanel) {
        const panelKey = `${Math.round(nearestPanel.box_2d[0] / 150)},${Math.round(nearestPanel.box_2d[1] / 150)}`;
        if (panelHomerunSeen.has(panelKey)) {
          continue;
        }
        panelHomerunSeen.add(panelKey);
      }
    }
    filteredAnnotations.push(item);
  }

  const modelUsedDesc = geminiResult && groqResult
    ? `${geminiResult.modelUsed} + ${groqResult.modelUsed} (dual-arbiter)`
    : (geminiResult ? `${geminiResult.modelUsed} (detector)` : `${groqResult.modelUsed} (detector)`);

  return {
    parsedResponse: {
      status: 'ok',
      annotations: filteredAnnotations
    },
    modelUsed: modelUsedDesc
  };
}

// Main auto-annotation execution function
async function runAutoAnnotation(sheetId, currentAnnotations = [], options = {}, sheetMeta = null) {
  const ref = loadReferences();
  if (!ref) {
    throw new Error('Approved reference data not loaded. Run prepare-approved-data.cjs first.');
  }

  let sheet = ref.sheets.find(s => s.id === sheetId);
  if (!sheet && sheetMeta) {
    sheet = sheetMeta;
  }
  if (!sheet) {
    throw new Error(`Sheet ${sheetId} not found in workspace.`);
  }

  // Multi-role rule: Legend reference sheets are not annotated
  if (sheet.sheet_type === 'legend_reference') {
    return {
      sheet_id: sheetId,
      status: 'references_only',
      message: 'Legend references received; no floor-plan image was supplied.',
      annotations: [],
      count: 0
    };
  }

  // Handle fixture / demo mode
  if (options.fixture) {
    const verifiedPayloadPath = fs.existsSync(path.join(__dirname, 'data', 'output_payload.json'))
      ? path.join(__dirname, 'data', 'output_payload.json')
      : path.join(__dirname, 'output_payload.json');
    let fallbackMap = new Map();
    if (fs.existsSync(verifiedPayloadPath)) {
      try {
        const vData = JSON.parse(fs.readFileSync(verifiedPayloadPath, 'utf8'));
        for (const ann of vData.annotations || []) {
          if (!fallbackMap.has(ann.sheet_id)) fallbackMap.set(ann.sheet_id, []);
          fallbackMap.get(ann.sheet_id).push(ann);
        }
      } catch {}
    }
    const fixtureProposals = fallbackMap.get(sheetId) || [];
    const validAnnotations = fixtureProposals.filter(p => {
      const [ymin, xmin, ymax, xmax] = p.box_2d || [];
      return ymin < ymax && xmin < xmax;
    }).map((p, idx) => {
      const sheetPixels = convertBoxToSheetPixels(p.box_2d, sheet.width, sheet.height);
      return {
        id: `${sheetId}-ai-${idx + 1}`,
        layer: p.layer || 'symbols',
        label: p.label || 'Candidate device',
        geometry: { type: 'bbox', coordinates: sheetPixels },
        legend_entry: p.legend_entry || null,
        review_state: 'needs_review',
        method: 'auto_annotation_gemini',
        class_state: p.legend_entry ? 'proposed_legend_mapping' : 'unresolved',
        note: p.evidence || 'Approved fixture proposal',
        created_at: new Date().toISOString()
      };
    });

    return {
      sheet_id: sheetId,
      status: 'success',
      mode: 'fixture',
      count: validAnnotations.length,
      annotations: validAnnotations
    };
  }

  if (!getCandidateTargets(options).length) {
    return {
      sheet_id: sheetId,
      status: 'api_key_missing',
      message: 'No detection engine is available. GEMINI_API_KEY or GROQ_API_KEY is not configured and local YOLO is unavailable.',
      count: 0,
      annotations: []
    };
  }

  // Read the sheet target image
  let imageBuffer = null;
  if (sheet.image && sheet.image.startsWith('data:')) {
    const match = sheet.image.match(/^data:([^;]+);base64,(.*)$/);
    if (match) {
      imageBuffer = Buffer.from(match[2], 'base64');
    } else {
      throw new Error('Invalid image data format.');
    }
  } else {
    const imagePath = path.join(__dirname, sheet.image);
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Sheet image file not found: ${imagePath}`);
    }
    imageBuffer = fs.readFileSync(imagePath);
  }

  // Gather reference samples: associated legends + drawing embedded legends
  const candidateRefItems = [];
  const associatedLegendIds = new Set(sheet.associated_legend_ids || []);

  for (const s of ref.sheets) {
    if (associatedLegendIds.has(s.id) || s.id === sheet.id) {
      const srcPath = path.join(__dirname, s.image);
      let sBuf = null;
      if (fs.existsSync(srcPath)) {
        try { sBuf = fs.readFileSync(srcPath); } catch {}
      }
      for (const ann of s.annotations || []) {
        if (ann.layer === 'legend' && ann.geometry && ann.geometry.type === 'bbox') {
          candidateRefItems.push({
            reference_id: ann.legend_entry || `ref-${s.id}-${ann.id}`,
            legend_entry: ann.legend_entry || null,
            label: ann.label,
            source_sheet_id: s.id,
            geometry: ann.geometry,
            role: 'legend_definition',
            source_buffer: sBuf
          });
        }
      }
    }
  }

  // Also include general catalog items if capacity remains
  if (candidateRefItems.length < 32 && ref.legend_catalog) {
    for (const cat of ref.legend_catalog) {
      if (candidateRefItems.some(c => c.legend_entry === cat.legend_entry)) continue;
      const ex = cat.examples && cat.examples[0];
      if (ex && ex.geometry) {
        const srcPath = path.join(__dirname, `images/${ex.source_sheet_id}.jpg`);
        let sBuf = null;
        if (fs.existsSync(srcPath)) {
          try { sBuf = fs.readFileSync(srcPath); } catch {}
        }
        candidateRefItems.push({
          reference_id: cat.legend_entry,
          legend_entry: cat.legend_entry,
          label: cat.label,
          source_sheet_id: ex.source_sheet_id,
          geometry: ex.geometry,
          role: 'approved_example',
          source_buffer: sBuf
        });
        if (candidateRefItems.length >= 48) break;
      }
    }
  }

  // Build contact sheets using Sharp (max 4 sheets, max 16 items each)
  const { contactSheets, manifestReferences } = await buildContactSheets(candidateRefItems);
  const candidateClasses = (manifestReferences || []).map(r => ({
    legend_entry: r.legend_entry || r.reference_id,
    label: r.label
  })).filter((c, idx, arr) => arr.findIndex(x => x.legend_entry === c.legend_entry) === idx);

  // Standard electrical symbol classes for floor plans without pre-associated legend sheets
  const standardElectricalClasses = [
    { legend_entry: 'receptacle_duplex', label: 'Duplex 3-prong power outlet' },
    { legend_entry: 'wall_fan', label: 'Wall fan' },
    { legend_entry: 'air_conditioning_unit', label: 'Air conditioning unit' },
    { legend_entry: 'circuit_homerun', label: 'Circuit homerun' },
    { legend_entry: 'panelboard', label: 'Panelboard' }
  ];
  if (!sheet.associated_legend_ids || sheet.associated_legend_ids.length === 0 || sheet.id.startsWith('imported-') || candidateClasses.length === 0) {
    candidateClasses.unshift(...standardElectricalClasses);
  }

  // Generate overlapping tiles (1024x1024 with 200px overlap)
  const tiles = generateOverlappingTiles(sheet.width, sheet.height, 1024, 200);

  // Excluded regions (e.g. embedded legend panels, title blocks)
  const excludedRegions = (currentAnnotations || [])
    .filter(a => (a.layer === 'regions' || (a.layer === 'legend' && a.geometry)) && a.review_state !== 'deleted')
    .map(a => a.geometry.coordinates);

  // Deleted symbols for suppression
  const deletedSymbols = (currentAnnotations || [])
    .filter(a => a.review_state === 'deleted' && a.geometry && a.geometry.type === 'bbox' && a.layer === 'symbols')
    .map(a => a.geometry.coordinates);

  // Existing active symbols
  const existingSymbols = (currentAnnotations || [])
    .filter(a => a.review_state !== 'deleted' && a.geometry && a.geometry.type === 'bbox' && a.layer === 'symbols')
    .map(a => a.geometry.coordinates);

  const rawTileProposals = [];
  const systemInstruction = loadSystemPrompt();

  // Structured response schema
  const responseSchema = {
    type: 'OBJECT',
    properties: {
      status: { type: 'STRING', enum: ['ok', 'references_only', 'input_error'] },
      request_id: { type: 'STRING' },
      sheet_id: { type: 'STRING' },
      tile_id: { type: 'STRING' },
      message: { type: 'STRING' },
      annotations: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            reference_id: { type: 'STRING', nullable: true },
            legend_entry: { type: 'STRING', nullable: true },
            label: { type: 'STRING' },
            layer: { type: 'STRING', enum: ['symbols', 'unresolved'] },
            box_2d: {
              type: 'ARRAY',
              items: { type: 'INTEGER' },
              description: '[ymin, xmin, ymax, xmax] in 0-1000 scale'
            },
            match_quality: { type: 'STRING', enum: ['strong', 'tentative', 'unresolved'] },
            evidence: { type: 'STRING' },
            truncated: { type: 'BOOLEAN' }
          },
          required: ['reference_id', 'legend_entry', 'label', 'layer', 'box_2d', 'match_quality', 'evidence', 'truncated']
        }
      }
    },
    required: ['status', 'request_id', 'sheet_id', 'tile_id', 'message', 'annotations']
  };

  let lastUsedModel = 'gemini-3.8-flash';

  for (const tile of tiles) {
    // Crop target tile buffer
    const tileBuffer = await sharp(imageBuffer)
      .extract({ left: tile.x0, top: tile.y0, width: tile.w, height: tile.h })
      .png()
      .toBuffer();

    const targetBase64 = tileBuffer.toString('base64');
    const requestId = `${sheetId}-${tile.id}-${Date.now()}`;

    // Convert exclusions, deletions, and existing symbols into tile-relative 0-1000 coordinates
    const toTileCoords = (coords) => {
      const [xmin, ymin, xmax, ymax] = coords;
      if (xmax < tile.x0 || xmin > tile.x1 || ymax < tile.y0 || ymin > tile.y1) return null;
      const tXmin = Math.max(0, Math.min(1000, Math.round(((xmin - tile.x0) * 1000) / tile.w)));
      const tYmin = Math.max(0, Math.min(1000, Math.round(((ymin - tile.y0) * 1000) / tile.h)));
      const tXmax = Math.max(0, Math.min(1000, Math.round(((xmax - tile.x0) * 1000) / tile.w)));
      const tYmax = Math.max(0, Math.min(1000, Math.round(((ymax - tile.y0) * 1000) / tile.h)));
      if (tXmax <= tXmin || tYmax <= tYmin) return null;
      return [tYmin, tXmin, tYmax, tXmax];
    };

    const tileExisting = existingSymbols.map(toTileCoords).filter(Boolean);
    const tileDeleted = deletedSymbols.map(toTileCoords).filter(Boolean);
    const tileExcluded = excludedRegions.map(toTileCoords).filter(Boolean);

    const manifest = {
      request_id: requestId,
      sheet_id: sheetId,
      source_sha256: sheet.sha256,
      sheet_type: sheet.sheet_type || 'plan',
      target_image_id: 'target-0',
      tile_id: tile.id,
      coordinate_system: 'target_image_yxyx_0_1000',
      images: [
        { image_id: 'target-0', role: 'target' },
        ...contactSheets.map(c => ({ image_id: c.id, role: 'references' }))
      ],
      references: manifestReferences,
      existing_symbols: tileExisting,
      deleted_symbols: tileDeleted,
      excluded_regions: tileExcluded
    };

    const requestContext = {
      manifest,
      systemInstruction,
      responseSchema,
      targetBase64,
      contactSheets
    };

    let parsedAnnotations = [];
    let modelUsed = lastUsedModel;

    const useLocalYolo = isYoloAvailable() && process.env.ENABLE_LOCAL_YOLO !== 'false' && !options.useCloudOnly;
    const hasApiKey = !!process.env.GEMINI_API_KEY || !!process.env.GROQ_API_KEY;

    if (useLocalYolo) {
      console.log(`[Auto-Annotate] Running local YOLO candidate detection on ${tile.id}...`);
      const yoloRes = runYoloOnTile(targetBase64, tile, options);
      const yoloDetections = yoloRes.detections || [];
      console.log(`[Auto-Annotate] YOLO found ${yoloDetections.length} candidate symbols on ${tile.id} (0 tokens used).`);

      if (yoloDetections.length === 0 && (!hasApiKey || options.useYoloOnly)) {
        // Empty tile in YOLO-only mode or without API keys: skip API call completely
        console.log(`[Auto-Annotate] Skipping empty tile ${tile.id} (YOLO-only mode).`);
        continue;
      }

      if (hasApiKey && !options.useYoloOnly) {
        console.log(`[Auto-Annotate] Running AI symbol detector & arbiter (Gemini / Qwen) on ${tile.id} with ${yoloDetections.length} YOLO candidate hints...`);
        try {
          const improved = await improveDetectionsWithApi(targetBase64, tile, yoloDetections, candidateClasses, sheetId, options);
          parsedAnnotations = improved.parsedResponse?.annotations || [];
          modelUsed = improved.modelUsed;
          console.log(`[Auto-Annotate] AI symbol detector verified & decided ${parsedAnnotations.length} symbols on ${tile.id}.`);
        } catch (apiErr) {
          console.warn(`[Auto-Annotate] AI symbol detector notice on ${tile.id} (${apiErr.message}). Gracefully falling back to saved YOLO detections.`);
          parsedAnnotations = yoloDetections.map(d => ({
            reference_id: null,
            legend_entry: null,
            label: normalizeSymbolLabel(d.label),
            layer: 'symbols',
            box_2d: d.box_2d,
            match_quality: d.confidence >= 0.5 ? 'strong' : 'tentative',
            evidence: d.evidence || `Saved YOLO candidate (${d.confidence})`,
            truncated: false
          }));
          modelUsed = `local/${yoloRes.model || 'ved-symbols'} (saved)`;
        }
      } else {
        // No API key configured or YOLO-only mode: use saved YOLO detections directly
        parsedAnnotations = yoloDetections.map(d => ({
          reference_id: null,
          legend_entry: null,
          label: normalizeSymbolLabel(d.label),
          layer: 'symbols',
          box_2d: d.box_2d,
          match_quality: d.confidence >= 0.5 ? 'strong' : 'tentative',
          evidence: d.evidence || `Saved YOLO candidate (${d.confidence})`,
          truncated: false
        }));
        modelUsed = `local/${yoloRes.model || 'ved-symbols'}`;
      }
    } else if (hasApiKey && !options.useYoloOnly) {
      console.log(`[Auto-Annotate] Running AI symbol detector & arbiter (Gemini / Qwen) on ${tile.id}...`);
      try {
        const improved = await improveDetectionsWithApi(targetBase64, tile, [], candidateClasses, sheetId, options);
        parsedAnnotations = improved.parsedResponse?.annotations || [];
        modelUsed = improved.modelUsed;
      } catch (err) {
        console.warn(`[Auto-Annotate] AI detector notice on ${tile.id} (${err.message}). Falling back to multi-provider.`);
        const { parsedResponse, modelUsed: mUsed } = await callMultiProviderWithModelHopping(requestContext, tile.id, options);
        modelUsed = mUsed;
        parsedAnnotations = parsedResponse.annotations || [];
      }
    } else {
      const { parsedResponse, modelUsed: mUsed } = await callMultiProviderWithModelHopping(requestContext, tile.id, options);
      modelUsed = mUsed;

      if (parsedResponse.status === 'references_only') {
        return {
          sheet_id: sheetId,
          status: 'references_only',
          message: parsedResponse.message || 'References only.',
          annotations: [],
          count: 0
        };
      }
      parsedAnnotations = parsedResponse.annotations || [];
    }

    lastUsedModel = modelUsed;

    for (const ann of parsedAnnotations) {
      let box = ann.box_2d || ann.bbox;
      if (!box && Array.isArray(ann.coordinates) && ann.coordinates.length === 4) {
        box = ann.coordinates;
      } else if (!box && Array.isArray(ann.coordinates) && ann.coordinates.length === 2) {
        const [cx, cy] = ann.coordinates;
        box = [Math.max(0, cy - 15), Math.max(0, cx - 15), Math.min(1000, cy + 15), Math.min(1000, cx + 15)];
      }
      if (!Array.isArray(box) || box.length !== 4) continue;

      const [ymin, xmin, ymax, xmax] = box;
      // Coordinate validity check
      if (typeof ymin !== 'number' || typeof xmin !== 'number' || typeof ymax !== 'number' || typeof xmax !== 'number') continue;
      if (ymin >= ymax || xmin >= xmax || ymin < 0 || xmin < 0 || ymax > 1000 || xmax > 1000) continue;

      const sheetPixels = convertTileBoxToSheetPixels([ymin, xmin, ymax, xmax], tile);
      rawTileProposals.push({
        ...ann,
        label: normalizeSymbolLabel(ann.label),
        detector_model: modelUsed,
        sheet_pixels: sheetPixels,
        tile_id: tile.id
      });
    }
  }

  // Extract raw image pixels for ink verification (reject hallucinations in white space)
  let sheetRawPixels = null;
  try {
    const { data, info } = await sharp(imageBuffer).raw().toBuffer({ resolveWithObject: true });
    sheetRawPixels = { data, width: info.width, height: info.height, channels: info.channels };
  } catch {}

  function hasInkInBbox(b, minDark = 4) {
    if (!sheetRawPixels) return true;
    const { data, width, height, channels } = sheetRawPixels;
    const xStart = Math.max(0, Math.min(width - 1, Math.round(b[0])));
    const yStart = Math.max(0, Math.min(height - 1, Math.round(b[1])));
    const xEnd = Math.max(0, Math.min(width - 1, Math.round(b[2])));
    const yEnd = Math.max(0, Math.min(height - 1, Math.round(b[3])));
    let dark = 0;
    for (let y = yStart; y <= yEnd; y++) {
      for (let x = xStart; x <= xEnd; x++) {
        const idx = (y * width + x) * channels;
        const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        if (brightness < 160) {
          dark++;
          if (dark >= minDark) return true;
        }
      }
    }
    return dark >= minDark;
  }

  // Merge overlapping tile predictions and deduplicate
  const mergedProposals = [];
  for (const prop of rawTileProposals) {
    const b1 = prop.sheet_pixels;
    const w = b1[2] - b1[0];
    const h = b1[3] - b1[1];
    const midX = (b1[0] + b1[2]) / 2;
    const midY = (b1[1] + b1[3]) / 2;

    // Reject outer margins (grid bubbles 1, 2, 3, 4 on left, dimension lines, sheet borders)
    // and bottom title block area ('GROUND FLOOR POWER LAYOUT', scale 1:75, signatures)
    if (midX < sheet.width * 0.12 || midY > sheet.height * 0.86 || midY < sheet.height * 0.04 || midX > sheet.width * 0.98) {
      continue;
    }

    // Reject bounding boxes on pure white space (no drawing ink)
    if (!hasInkInBbox(b1)) {
      continue;
    }

    // Dimension sanity check for electrical devices
    if (w < 8 || h < 8 || w > 140 || h > 140) {
      continue;
    }

    // Check against excluded regions
    const insideExcluded = excludedRegions.some(e => {
      return midX >= e[0] && midX <= e[2] && midY >= e[1] && midY <= e[3];
    });
    if (insideExcluded) continue;

    // Check against deleted symbols (never recreate deleted items)
    const isDeleted = deletedSymbols.some(d => computeIoU(b1, d) > 0.4);
    if (isDeleted) continue;

    // Check against existing symbol annotations (not OCR or text)
    const isExisting = existingSymbols.some(e => computeIoU(b1, e) > 0.45);
    if (isExisting) continue;

    // Self-deduplication against newly merged proposals
    const duplicateIdx = mergedProposals.findIndex(m => {
      const iou = computeIoU(b1, m.sheet_pixels);
      const cont = computeContainment(b1, m.sheet_pixels);
      if (iou > 0.35 || cont > 0.75) return true;
      if (m.label === prop.label) {
        const c1x = (b1[0] + b1[2]) / 2;
        const c1y = (b1[1] + b1[3]) / 2;
        const c2x = (m.sheet_pixels[0] + m.sheet_pixels[2]) / 2;
        const c2y = (m.sheet_pixels[1] + m.sheet_pixels[3]) / 2;
        if (Math.hypot(c1x - c2x, c1y - c2y) < 22) return true;
      }
      return false;
    });
    if (duplicateIdx >= 0) {
      const existing = mergedProposals[duplicateIdx];
      // Keep complete / non-truncated over truncated
      if (existing.truncated && !prop.truncated) {
        mergedProposals[duplicateIdx] = prop;
      }
      continue;
    }

    mergedProposals.push(prop);
  }

  // Generate final annotation records with unique IDs
  const finalAnnotations = [];
  const generatedIds = new Set((currentAnnotations || []).map(a => a.id));

  for (const prop of mergedProposals) {
    const geometry = { type: 'bbox', coordinates: prop.sheet_pixels };
    if (!AnnotationCore.validGeometry(geometry, sheet.width, sheet.height)) continue;

    let uid = `${sheetId}-ai-${crypto.randomBytes(3).toString('hex')}`;
    while (generatedIds.has(uid)) {
      uid = `${sheetId}-ai-${crypto.randomBytes(3).toString('hex')}`;
    }
    generatedIds.add(uid);

    // Lookup legend entry provenance for cross-group compliance
    let legendEntry = prop.legend_entry || null;
    if (!legendEntry) {
      if (prop.label === 'Duplex 3-prong power outlet') legendEntry = 'receptacle_duplex';
      else if (prop.label === 'Wall fan') legendEntry = 'wall_fan';
      else if (prop.label === 'Air conditioning unit') legendEntry = 'air_conditioning_unit';
      else if (prop.label === 'Circuit homerun') legendEntry = 'circuit_homerun';
      else if (prop.label === 'Panelboard') legendEntry = 'panelboard';
    }

    let sourceSheet = null;
    if (legendEntry) {
      sourceSheet = ref.sheets.find(s => (s.annotations || []).some(a => a.layer === 'legend' && a.legend_entry === legendEntry));
    }
    const isAssociated = !sourceSheet || (sheet.associated_legend_ids || []).includes(sourceSheet.id) || sheet.id === sourceSheet.id;
    const legendScope = isAssociated ? 'group' : 'cross_group';
    const classState = legendEntry ? (isAssociated ? 'proposed_legend_mapping' : 'cross_group_candidate') : 'unresolved';
    const legendSource = (!isAssociated && sourceSheet) ? {
      sheet_id: sourceSheet.id,
      source_sha256: sourceSheet.sha256,
      group: sourceSheet.group
    } : undefined;

    finalAnnotations.push({
      id: uid,
      layer: prop.layer || 'symbols',
      label: prop.label || 'Candidate device',
      geometry: geometry,
      legend_entry: legendEntry,
      legend_scope: legendScope,
      legend_source: legendSource,
      review_state: 'needs_review',
      method: prop.detector_model?.startsWith('local/') ? 'auto_annotation_yolo' :
        prop.detector_model?.startsWith('groq/') ? 'auto_annotation_groq' : 'auto_annotation_gemini',
      class_state: classState,
      note: prop.evidence || `Auto-annotated by ${lastUsedModel} visual detection`,
      created_at: new Date().toISOString()
    });
  }

  return {
    sheet_id: sheetId,
    status: 'success',
    model: lastUsedModel,
    count: finalAnnotations.length,
    annotations: finalAnnotations
  };
}

module.exports = {
  runAutoAnnotation,
  convertBoxToSheetPixels,
  convertTileBoxToSheetPixels,
  generateOverlappingTiles,
  computeIoU,
  computeContainment,
  loadReferences,
  buildContactSheets,
  getCandidateModels,
  getCandidateTargets,
  getYoloModelPath,
  isYoloAvailable,
  resolvePythonCommand,
  runYoloOnTile,
  improveDetectionsWithApi
};

