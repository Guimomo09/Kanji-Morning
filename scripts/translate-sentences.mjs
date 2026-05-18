#!/usr/bin/env node
/**
 * scripts/translate-sentences.mjs
 *
 * Translates all Japanese example sentences in public/sentences.json
 * into FR, ES, DE, RU using the Microsoft Azure Translator API.
 *
 * FREE tier: 2 000 000 chars/month — no credit card required.
 * This script needs ~300 000 chars total (4518 sentences × 4 langs).
 *
 * Setup (free, ~3 min):
 *   1. Go to https://portal.azure.com → Create a resource → "Translator"
 *   2. Pricing tier: F0 (Free) — no credit card
 *   3. After creation: Keys and Endpoint → copy Key 1 and the Region
 *   4. Run:
 *        AZURE_KEY=your_key AZURE_REGION=your_region node scripts/translate-sentences.mjs
 *      Example region: westeurope, eastus, francecentral…
 *
 * Resumable: already-translated entries are skipped on re-run.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname }       from 'node:path';
import { fileURLToPath }       from 'node:url';

const __dir   = dirname(fileURLToPath(import.meta.url));
const ROOT    = join(__dir, '..');
const DB_PATH = join(ROOT, 'public', 'sentences.json');

const AZURE_KEY    = process.env.AZURE_KEY;
const AZURE_REGION = process.env.AZURE_REGION || 'westeurope';

if (!AZURE_KEY) {
  console.error('❌  AZURE_KEY not set.');
  console.error('');
  console.error('  Setup (free, no credit card):');
  console.error('  1. https://portal.azure.com → Create resource → "Translator"');
  console.error('  2. Pricing tier: F0 (Free)');
  console.error('  3. After creation → Keys and Endpoint → copy Key 1 + Region');
  console.error('  4. Run:');
  console.error('     AZURE_KEY=your_key AZURE_REGION=your_region node scripts/translate-sentences.mjs');
  process.exit(1);
}

const ENDPOINT = 'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=ja';

const LANGS  = ['fr', 'es', 'de', 'ru'];
const BATCH  = 100;  // Azure allows up to 100 texts per request
const DELAY  = 400;  // ms between requests

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function translateBatch(texts, targetLangs) {
  const url  = `${ENDPOINT}&${targetLangs.map(l => `to=${l}`).join('&')}`;
  const body = JSON.stringify(texts.map(t => ({ Text: t })));

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key':    AZURE_KEY,
      'Ocp-Apim-Subscription-Region': AZURE_REGION,
      'Content-Type':                 'application/json; charset=UTF-8',
    },
    body,
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Azure ${res.status}: ${err}`);
  }

  // Returns array of { translations: [{ text, to }] } — one per input text
  return await res.json();
}

// ── Main ──────────────────────────────────────────────────────────────────
const db    = JSON.parse(await readFile(DB_PATH, 'utf8'));
const words = Object.keys(db);

// Find entries missing at least one language
const toTranslate = words.filter(w => LANGS.some(l => !db[w][l]));
console.log(`\nTotal entries : ${words.length}`);
console.log(`Need translate: ${toTranslate.length}`);
console.log(`Already done  : ${words.length - toTranslate.length}`);

if (!toTranslate.length) {
  console.log('\n✅ All sentences already translated!');
  process.exit(0);
}

// Azure can translate to multiple target languages in one request
// Process in batches of 100 texts, all 4 target langs at once
let done = 0;
for (let i = 0; i < toTranslate.length; i += BATCH) {
  const batch = toTranslate.slice(i, i + BATCH);
  const texts = batch.map(w => db[w].jp);

  process.stdout.write(`  [${i + 1}–${Math.min(i + BATCH, toTranslate.length)}/${toTranslate.length}] translating all 4 langs…`);

  try {
    const results = await translateBatch(texts, LANGS);

    for (let j = 0; j < batch.length; j++) {
      const word = batch[j];
      const translations = results[j].translations; // [{ text, to }]
      for (const { text, to } of translations) {
        if (!db[word][to]) db[word][to] = text; // only fill missing
      }
    }

    done += batch.length;
    process.stdout.write(` ✓ (${done} total)\n`);

    // Save after every batch (resumable)
    await writeFile(DB_PATH, JSON.stringify(db), 'utf8');

  } catch (e) {
    process.stdout.write(` ✗ ${e.message}\n`);
    console.error('\n  Saving progress and stopping. Re-run to resume from where it stopped.');
    await writeFile(DB_PATH, JSON.stringify(db), 'utf8');
    process.exit(1);
  }

  if (i + BATCH < toTranslate.length) await sleep(DELAY);
}

await writeFile(DB_PATH, JSON.stringify(db), 'utf8');
console.log(`\n✅ Done! ${done} sentences translated into FR, ES, DE, RU.`);
console.log(`   sentences.json updated — run: git add public/sentences.json && git push origin dev`);

