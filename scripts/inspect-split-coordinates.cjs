// scripts/inspect-split-coordinates.cjs
const fs = require('fs');
const path = require('path');
process.loadEnvFile(path.join(__dirname, '..', '.env'));

const key = process.env.GEMINI_API_KEY;

async function detect(name, prompt) {
  const buf = fs.readFileSync(path.join(__dirname, '..', '.temp', 'splits', name));
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/png', data: buf.toString('base64') } }
        ]
      }],
      generationConfig: { response_mime_type: 'application/json' }
    })
  });
  const d = await res.json();
  console.log(`=== ${name} ===`);
  console.log(d.candidates?.[0]?.content?.parts?.[0]?.text);
}

async function run() {
  await detect('sheet-32-crop.png', 'This image has 2 rows of symbols from a blueprint legend. Row 1 has telephone outlet: single symbol on the left, the word "or", and duplex symbol with "2" on the right. Row 2 has data outlet: single symbol on the left, the word "or", and duplex symbol with "2" on the right. Give the normalized bounding box [ymin, xmin, ymax, xmax] (0 to 1000) for: 1. single_telephone_symbol, 2. duplex_telephone_symbol, 3. single_data_symbol, 4. duplex_data_symbol.');
  await detect('sheet-34-crop.png', 'This image shows legend symbol cells. Identify the single voice outlet, duplex voice outlet, single data outlet, and duplex data outlet. Give normalized bounding box [ymin, xmin, ymax, xmax] (0 to 1000).');
  await detect('sheet-37-crop.png', 'This image shows legend symbol cells for telephone/voice and data. Identify the single voice outlet, duplex voice outlet, single data outlet, and duplex data outlet. Give normalized bounding box [ymin, xmin, ymax, xmax] (0 to 1000).');
  await detect('bdo-outlet-crop.png', 'This image shows two duplex convenience outlet symbols side-by-side. The left symbol has an unshaded circle (Normal power - white plate). The right symbol has a half-shaded circle (UPS power - metallic gray plate). Give the normalized bounding box [ymin, xmin, ymax, xmax] (0 to 1000) for: 1. normal_power_white_plate_symbol, 2. ups_power_metallic_gray_plate_symbol.');
}

run().catch(console.error);
