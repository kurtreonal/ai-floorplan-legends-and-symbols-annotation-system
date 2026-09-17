// scripts/extract-legends.cjs
// Uses Gemini to detect all legend symbol glyphs and labels from the newly added legend sheets
// Zero external dependencies. Zero emojis.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
process.loadEnvFile(path.join(__dirname, '..', '.env'));

const key = process.env.GEMINI_API_KEY;

const LEGEND_SHEETS = [
  { id: 'sheet-53', filename: '23-legends.jpg', group: 23 },
  { id: 'sheet-56', filename: '24-legends.jpg', group: 24 },
  { id: 'sheet-58', filename: '25-legends.jpg', group: 25 },
  { id: 'sheet-65', filename: '26-legends.jpg', group: 26 },
  { id: 'sheet-66', filename: '27-legends.jpg', group: 27 },
  { id: 'sheet-67', filename: '28-legends.jpg', group: 28 }
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function callGemini(modelName, prompt, buf) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/jpeg', data: buf.toString('base64') } }
        ]
      }],
      generationConfig: { response_mime_type: 'application/json', temperature: 0.1 }
    })
  });
  return res;
}

async function inspectSheet(sheetInfo) {
  const imgPath = path.join(__dirname, '..', 'images', sheetInfo.filename);
  if (!fs.existsSync(imgPath)) {
    console.error('Image not found:', imgPath);
    return null;
  }
  const meta = await sharp(imgPath).metadata();
  console.log(`Processing ${sheetInfo.id} (${sheetInfo.filename}), dimensions: ${meta.width}x${meta.height}...`);

  const buf = await sharp(imgPath)
    .resize(1600, 1600, { fit: 'inside' })
    .jpeg({ quality: 85 })
    .toBuffer();

  const prompt = `This image is an architectural/engineering blueprint legend sheet: "${sheetInfo.filename}".
Please detect and list EVERY legend entry / symbol shown in the legend tables or columns.
For each legend entry, provide:
1. "label": The full text description / meaning of the symbol (e.g., "Duplex convenience receptacle", "Single pole switch", "Fluorescent lighting fixture", "Smoke detector", etc.).
2. "symbol_box": Normalized bounding box [ymin, xmin, ymax, xmax] (integers 0 to 1000) tightly enclosing the graphical symbol / glyph icon itself.
3. "text_box": Normalized bounding box [ymin, xmin, ymax, xmax] (integers 0 to 1000) enclosing the description text for this symbol.

Format your output strictly as a JSON object:
{
  "legends": [
    {
      "label": "string",
      "symbol_box": [ymin, xmin, ymax, xmax],
      "text_box": [ymin, xmin, ymax, xmax]
    }
  ]
}`;

  const models = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];
  let res = null;
  let resJson = null;

  for (const model of models) {
    try {
      console.log(`Trying ${model} for ${sheetInfo.id}...`);
      res = await callGemini(model, prompt, buf);
      if (res.ok) {
        resJson = await res.json();
        break;
      } else {
        const errText = await res.text();
        console.warn(`Model ${model} returned ${res.status}: ${errText.slice(0, 120)}`);
        if (res.status === 429) {
          console.log('Sleeping 5s before trying next model...');
          await sleep(5000);
        }
      }
    } catch (err) {
      console.warn(`Fetch error with ${model}:`, err.message);
    }
  }

  if (!resJson) {
    console.error(`All models failed for ${sheetInfo.id}`);
    return null;
  }

  const rawText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
  let parsed = null;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    console.error(`Failed to parse JSON for ${sheetInfo.id}:`, e.message);
    console.log(rawText);
    return null;
  }

  const items = parsed.legends || [];
  console.log(`Detected ${items.length} legend entries on ${sheetInfo.id}.`);
  return {
    ...sheetInfo,
    width: meta.width,
    height: meta.height,
    items
  };
}

async function run() {
  const outPath = path.join(__dirname, '..', '.temp', 'extracted-legends.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  let results = [];
  if (fs.existsSync(outPath)) {
    try {
      results = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    } catch (e) {
      results = [];
    }
  }

  for (const info of LEGEND_SHEETS) {
    const existing = results.find(r => r.id === info.id && r.items && r.items.length > 0);
    if (existing) {
      console.log(`Skipping ${info.id} (${existing.items.length} items already cached).`);
      continue;
    }
    const res = await inspectSheet(info);
    if (res && res.items.length > 0) {
      const idx = results.findIndex(r => r.id === info.id);
      if (idx >= 0) results[idx] = res;
      else results.push(res);
      fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
      console.log(`Saved intermediate progress with ${results.length} sheets.`);
    }
    await sleep(2500);
  }

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log('Finished. Saved all extracted legends to', outPath);
}

run().catch(console.error);
