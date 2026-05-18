#!/usr/bin/env node
/**
 * scripts/translate-sentences.mjs
 *
 * Translates all Japanese example sentences in public/sentences.json
 * into FR, ES, DE, RU using OpenAI gpt-4o-mini.
 *
 * Cost: ~$0.30 total for all 4518 sentences × 4 languages.
 * Resumable: already-translated entries are skipped on re-run.
 *
 * Usage:
 *   node scripts/translate-sentences.mjs
 *   (reads OPENAI_API_KEY from .env — same key used by ai-fill-sentences.mjs)
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname }       from 'node:path';
import { existsSync }          from 'node:fs';
import { fileURLToPath }       from 'node:url';

const __dir   = dirname(fileURLToPath(import.meta.url));
const ROOT    = join(__dir, '..');
const DB_PATH = join(ROOT, 'public', 'sentences.json');

// ── Load .env (same pattern as ai-fill-sentences.mjs) ────────────────────
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of (await readFile(envPath, 'utf8')).split('\n')) {
    const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) {
  console.error('❌  OPENAI_API_KEY not found in .env');
  console.error('   Add it to your .env file: OPENAI_API_KEY=sk-...');
  process.exit(1);
}

const BATCH = 20;  // sentences per API call
const DELAY = 300; // ms between requests
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SYSTEM_PROMPT = `You are a professional translator specializing in Japanese.
Translate each Japanese sentence into French (fr), Spanish (es), German (de), and Russian (ru).
Respond ONLY with a JSON array matching the input order.
Each element: { "fr": "...", "es": "...", "de": "...", "ru": "..." }
No explanation, no markdown, just the raw JSON array.`;

async function translateBatch(sentences, attempt = 0) {
  const userMsg = JSON.stringify(sentences.map((s, i) => ({ i, jp: s })));

  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userMsg },
        ],
      }),
      signal: AbortSignal.timeout(90000),
    });
  } catch (e) {
    // Retry up to 3 times on network/timeout errors
    if (attempt < 3) {
      const wait = (attempt + 1) * 5000;
      process.stdout.write(` ↺ timeout, retry ${attempt + 1}/3 in ${wait/1000}s…`);
      await sleep(wait);
      return translateBatch(sentences, attempt + 1);
    }
    throw e;
  }

  if (!res.ok) {
    const err = await res.text();
    // Retry on 429 rate limit
    if (res.status === 429 && attempt < 3) {
      const wait = (attempt + 1) * 10000;
      process.stdout.write(` ↺ rate limit, retry ${attempt + 1}/3 in ${wait/1000}s…`);
      await sleep(wait);
      return translateBatch(sentences, attempt + 1);
    }
    throw new Error(`OpenAI ${res.status}: ${err}`);
  }

  const data = await res.json();
  const content = data.choices[0].message.content.trim();
  // Strip possible markdown code fences
  const clean = content.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(clean);
}

// ── Main ──────────────────────────────────────────────────────────────────
const db    = JSON.parse(await readFile(DB_PATH, 'utf8'));
const words = Object.keys(db);

// Find entries that are missing at least one language
const toTranslate = words.filter(w =>
  ['fr', 'es', 'de', 'ru'].some(l => !db[w][l])
);

console.log(`\nTotal entries : ${words.length}`);
console.log(`Need translate: ${toTranslate.length}`);
console.log(`Already done  : ${words.length - toTranslate.length}`);
console.log(`Estimated cost: ~$${(toTranslate.length * 0.00007).toFixed(2)} (gpt-4o-mini)\n`);

if (!toTranslate.length) {
  console.log('✅ All sentences already translated!');
  process.exit(0);
}

let done = 0;
for (let i = 0; i < toTranslate.length; i += BATCH) {
  const batch = toTranslate.slice(i, i + BATCH);
  const sentences = batch.map(w => db[w].jp);

  process.stdout.write(`  [${i + 1}–${Math.min(i + BATCH, toTranslate.length)}/${toTranslate.length}]…`);

  try {
    const results = await translateBatch(sentences);

    for (let j = 0; j < batch.length; j++) {
      const word = batch[j];
      const t = results[j];
      if (!t) continue; // guard against truncated API response
      if (!db[word].fr && t.fr) db[word].fr = t.fr;
      if (!db[word].es && t.es) db[word].es = t.es;
      if (!db[word].de && t.de) db[word].de = t.de;
      if (!db[word].ru && t.ru) db[word].ru = t.ru;
    }

    done += batch.length;
    process.stdout.write(` ✓ (${done} done)\n`);

    // Save every batch (resumable)
    await writeFile(DB_PATH, JSON.stringify(db), 'utf8');

  } catch (e) {
    process.stdout.write(` ✗ ${e.message}\n`);
    console.error('  Saving progress. Re-run to resume from where it stopped.');
    await writeFile(DB_PATH, JSON.stringify(db), 'utf8');
    process.exit(1);
  }

  if (i + BATCH < toTranslate.length) await sleep(DELAY);
}

await writeFile(DB_PATH, JSON.stringify(db), 'utf8');
console.log(`\n✅ Done! ${done} sentences translated into FR, ES, DE, RU.`);
console.log(`   git add public/sentences.json && git push origin dev`);
