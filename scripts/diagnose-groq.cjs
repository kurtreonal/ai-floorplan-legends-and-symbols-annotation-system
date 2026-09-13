// diagnose-groq.cjs
// Diagnostic utility to verify Groq API Key and inspect available vision / Qwen models on Groq.

const fs = require('fs');
const path = require('path');

const envPath = fs.existsSync(path.join(__dirname, '.env')) ? path.join(__dirname, '.env') : path.join(__dirname, '../.env');
if (typeof process.loadEnvFile === 'function' && fs.existsSync(envPath)) {
  try { process.loadEnvFile(envPath); } catch {}
}

async function main() {
  const key = process.env.GROQ_API_KEY;
  if (!key || key.trim() === '') {
    console.log('GROQ_API_KEY is not yet configured in .env.');
    console.log('Please open .env and paste your Groq API key on line 6:');
    console.log('  GROQ_API_KEY=gsk_...\n');
    console.log('Once pasted, re-run: node diagnose-groq.cjs');
    process.exitCode = 1;
    return;
  }

  console.log('Querying Groq API for available models...\n');
  const started = Date.now();

  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: {
        'Authorization': `Bearer ${key.trim()}`
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error(`Groq API returned HTTP ${res.status}:`, err.error?.message || res.statusText);
      process.exitCode = 1;
      return;
    }

    const data = await res.json();
    const models = data.data || [];
    console.log(`Success! Found ${models.length} total models on Groq (${((Date.now() - started) / 1000).toFixed(1)}s).\n`);

    const qwenModels = models.filter(m => m.id.toLowerCase().includes('qwen'));
    const visionModels = models.filter(m => m.id.toLowerCase().includes('vision') || m.id.toLowerCase().includes('vl'));

    console.log('--- Qwen Models on Groq ---');
    if (qwenModels.length) {
      qwenModels.forEach(m => console.log(`  - ${m.id}`));
    } else {
      console.log('  (No models with "qwen" in ID found in your Groq account)');
    }

    console.log('\n--- Vision-Capable Models on Groq ---');
    if (visionModels.length) {
      visionModels.forEach(m => console.log(`  - ${m.id}`));
    } else {
      console.log('  (None specifically labeled "vision" or "vl")');
    }

    const configuredModel = process.env.GROQ_MODEL || 'qwen-2.5-32b';
    console.log(`\nConfigured GROQ_MODEL in .env: "${configuredModel}"`);

    // Quick test prompt
    console.log(`Testing prompt completion with "${configuredModel}"...`);
    const testRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: configuredModel,
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
        max_tokens: 10
      }),
      signal: AbortSignal.timeout(20000)
    });

    if (testRes.ok) {
      const testData = await testRes.json();
      console.log(`[PASS] "${configuredModel}" responded successfully: "${testData.choices?.[0]?.message?.content?.trim()}"`);
    } else {
      const testErr = await testRes.json().catch(() => ({}));
      console.log(`[NOTICE] "${configuredModel}" returned HTTP ${testRes.status}:`, testErr.error?.message || testRes.statusText);
      console.log('If needed, update GROQ_MODEL in your .env to one of the models listed above.');
    }
  } catch (err) {
    console.error('Diagnostic error:', err.message);
    process.exitCode = 1;
  }
}

main();
