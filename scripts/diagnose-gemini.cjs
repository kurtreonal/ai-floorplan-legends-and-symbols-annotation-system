// Uses the existing terminal's key; never prints it. One small text-only API request.
const fs = require('fs');
const path = require('path');

const envPath = fs.existsSync(path.join(__dirname, '.env')) ? path.join(__dirname, '.env') : path.join(__dirname, '../.env');
if (typeof process.loadEnvFile === 'function' && fs.existsSync(envPath)) {
  try { process.loadEnvFile(envPath); } catch {}
}

const { getCandidateModels } = require('../auto-annotate.cjs');

async function main() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set. Provide it in .env or set the environment variable.');

  const models = getCandidateModels();
  console.log(`Testing Gemini API key across ${models.length} model-hopping candidate models...\n`);

  let operationalCount = 0;

  for (const m of models) {
    const started = Date.now();
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with the single word OK.' }] }] }),
        signal: AbortSignal.timeout(15000)
      });
      const data = await response.json().catch(() => ({}));
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);

      if (response.ok) {
        operationalCount++;
        console.log(`[PASS] ${m.padEnd(24)} HTTP 200 (${elapsed}s) -> Operational`);
      } else {
        const reason = data.error?.message || data.error?.status || response.statusText;
        console.log(`[WAIT] ${m.padEnd(24)} HTTP ${response.status} (${elapsed}s) -> ${reason.slice(0, 90)}`);
      }
    } catch (err) {
      console.log(`[FAIL] ${m.padEnd(24)} Error -> ${err.message}`);
    }
  }

  console.log(`\nModel Hopping Summary: ${operationalCount} of ${models.length} models currently operational.`);
  if (operationalCount > 0) {
    console.log('Auto-Annotation will smoothly hop across these models as needed under quota/demand spikes.');
  } else {
    console.log('No models are currently responding. Check your API key or quota in Google AI Studio.');
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
