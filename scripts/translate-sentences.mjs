#!/usr/bin/env node
/**
 * scripts/translate-sentences.mjs
 *
 * Translates all Japanese example sentences in public/sentences.json
 * into FR, ES, DE, RU using the DeepL API (JP as source — best quality).
 *
 * Usage:
 *   DEEPL_KEY=your_key node scripts/translate-sentences.mjs
 *
 * Free tier: 500 000 chars/month — this script needs ~300 000 chars total.
 * Resumable: already-translated entries are skipped on re-run.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync }          from 'node:fs';
import { join, dirname }       from 'node:path';
import { fileURLToPath }       from 'node:url';

const __dir   = dirname(fileURLToPath(import.meta.url));
const ROOT    = join(__dir, '..');
const DB_PATH = join(ROOT, 'public', 'sentences.json');

const DEEPL_KEY = process.env.DEEPL_KEY;
if (!DEEPL_KEY) {
  console.error('❌  DEEPL_KEY not set.');
  console.error('   Get a free key at: https://www.deepl.com/en/pro#developer');
  console.error('   Then run:  DEEPL_KEY=your_key node scripts/translate-sentences.mjs');
  process.exit(1);
}

const DEEPL_URL = DEEPL_KEY.endsWith(':fx')
  ? 'https://api-free.deepl.com/v2/translate'
  : 'https://api.deepl.com/v2/translate';

const LANGS = [
  { code: 'fr', deepl: 'FR' },
  { code: 'es', deepl: 'ES' },
  { code: 'de', deepl: 'DE' },
  { code: 'ru', deepl: 'RU' },
];

const BATCH = 50;   // DeepL max per request
const DELAY = 600;  // ms between requests

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function translateBatch(texts, targetLang) {
  const body = new URLSearchParams();
  body.append('auth_key', DEEPL_KEY);
  body.append('source_lang', 'JA');
  body.append('target_lang', targetLang);
  texts.forEach(t => body.append('text', t));

  const res = await fetch(DEEPL_URL, {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepL ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.translations.map(t => t.text);
}

// ── Main ──────────────────────────────────────────────────────────────────
const db = JSON.parse(await readFile(DB_PATH, 'utf8'));
const words = Object.keys(db);

let totalTranslated = 0;
let totalSkipped = 0;

for (const { code, deepl } of LANGS) {
  console.log(`\n━━ Translating → ${code.toUpperCase()} ━━`);

  // Collect words that still need this language
  const toTranslate = words.filter(w => !db[w][code]);
  console.log(`  ${toTranslate.length} missing / ${words.length - toTranslate.length} already done`);
  totalSkipped += words.length - toTranslate.length;

  if (!toTranslate.length) continue;

  // Process in batches
  for (let i = 0; i < toTranslate.length; i += BATCH) {
    const batch = toTranslate.slice(i, i + BATCH);
    const texts = batch.map(w => db[w].jp);

    process.stdout.write(`  [${i + 1}–${Math.min(i + BATCH, toTranslate.length)}/${toTranslate.length}] translating…`);

    try {
      const translated = await translateBatch(texts, deepl);
      for (let j = 0; j < batch.length; j++) {
        db[batch[j]][code] = translated[j];
      }
      totalTranslated += batch.length;
      process.stdout.write(` ✓\n`);

      // Save after every batch (resumable)
      await writeFile(DB_PATH, JSON.stringify(db, null, 0), 'utf8');
    } catch (e) {
      process.stdout.write(` ✗ ${e.message}\n`);
      console.error('  Saving progress and stopping. Re-run to resume.');
      await writeFile(DB_PATH, JSON.stringify(db, null, 0), 'utf8');
      process.exit(1);
    }

    if (i + BATCH < toTranslate.length) await sleep(DELAY);
  }
}

// Final save (compact JSON for smaller file size)
await writeFile(DB_PATH, JSON.stringify(db, null, 0), 'utf8');

console.log(`\n✅ Done! Translated ${totalTranslated} sentences, skipped ${totalSkipped} already done.`);
console.log(`   sentences.json updated at: ${DB_PATH}`);
