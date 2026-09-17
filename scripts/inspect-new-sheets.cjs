const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
process.loadEnvFile(path.join(__dirname, '..', '.env'));

const key = process.env.GEMINI_API_KEY;
const dir = 'C:/Users/kupal/Downloads/FLOOR PLAN DATA SETS NIGGA';
const files = [
  '23-datacomlayout.jpg', '23-legends.jpg', '23-systemlayout.jpg',
  '24-legends.jpg', '24-securitylayout.jpg',
  '25-legends.jpg', '25-wallfinisheslayout.jpg', '25-unspecified.jpg',
  '25-unspecified2.jpg', '25-unspecified3.jpg', '25.jpg',
  '26-legends.jpg', '27-legends.jpg', '28-legends.jpg', 'unspecified4.jpg'
];

async function checkAllTitles() {
  for (const f of files) {
    const full = path.join(dir, f);
    const buf = fs.readFileSync(full);
    const small = await sharp(buf).resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: 'Identify this engineering sheet: What is the sheet title (e.g. DATACOM LAYOUT, LEGENDS & SYMBOLS, etc.), sheet number, project name, and is it a "plan" or "legend_reference"? Return concise JSON: {"title": string, "sheet_type": "plan" | "legend_reference", "sheet_number": string, "project": string}' },
            { inline_data: { mime_type: 'image/jpeg', data: small.toString('base64') } }
          ]
        }],
        generationConfig: { response_mime_type: 'application/json', temperature: 0.1 }
      })
    });

    if (res.ok) {
      const d = await res.json();
      console.log(f.padEnd(28), d.candidates?.[0]?.content?.parts?.[0]?.text?.trim()?.replace(/\n/g, ' '));
    } else {
      console.log(f.padEnd(28), 'Error:', res.status);
    }
  }
}

checkAllTitles().catch(e => console.error(e));
