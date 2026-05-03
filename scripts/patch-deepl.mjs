#!/usr/bin/env node
/**
 * scripts/patch-deepl.mjs
 *
 * Translates all missing language glosses in public/jmdict_trans.json
 * using the DeepL API Free (500 000 chars/month, no credit card needed).
 *
 * Strategy:
 *   - For each freq.js word missing a lang, find the best source lang
 *     (DE preferred > RU > ES > existing other)
 *   - Batch up to 50 texts per request to minimize API calls
 *   - Resumable: saves progress to _deepl_progress.json
 *
 * Setup (free, takes 2 min):
 *   1. Go to https://www.deepl.com/en/pro#developer
 *   2. Create a free account (no credit card)
 *   3. Go to Account > API Keys → copy the key
 *   4. Run:  DEEPL_KEY=your_key node scripts/patch-deepl.mjs
 *      OR:   set DEEPL_KEY=your_key && node scripts/patch-deepl.mjs
 *
 * Free quota: 500 000 chars/month.
 * This script needs ~350 000 chars total for all 4 langs — fits in one month.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync }          from 'node:fs';
import { join, dirname }       from 'node:path';
import { fileURLToPath }       from 'node:url';

const __dir      = dirname(fileURLToPath(import.meta.url));
const ROOT       = join(__dir, '..');
const TRANS_PATH = join(ROOT, 'public', 'jmdict_trans.json');
const FREQ_PATH  = join(ROOT, 'src', 'freq.js');
const PROG_PATH  = join(ROOT, '_deepl_progress.json');

const DEEPL_KEY = process.env.DEEPL_KEY;
if (!DEEPL_KEY) {
  console.error('❌  DEEPL_KEY not set.');
  console.error('   Get a free key at: https://www.deepl.com/en/pro#developer');
  console.error('   Then run:  $env:DEEPL_KEY="your_key"; node scripts/patch-deepl.mjs');
  process.exit(1);
}

// DeepL API endpoint (free plan uses api-free.deepl.com)
const DEEPL_URL = DEEPL_KEY.endsWith(':fx')
  ? 'https://api-free.deepl.com/v2/translate'
  : 'https://api.deepl.com/v2/translate';

const BATCH   = 50;   // DeepL allows up to 50 texts per request
const DELAY   = 500;  // ms between requests (well within rate limits)
const LANGS   = ['fr', 'de', 'es', 'ru'];

// DeepL language codes
const DEEPL_LANG = { fr: 'FR', de: 'DE', es: 'ES', ru: 'RU' };

// Source language priority: most coverage first
const SRC_PRIORITY = ['de', 'ru', 'es', 'fr'];

// ── DeepL batch translate ─────────────────────────────────────────────────
async function translateBatch(texts, sourceLang, targetLang) {
  const body = new URLSearchParams();
  body.append('source_lang', DEEPL_LANG[sourceLang]);
  body.append('target_lang', DEEPL_LANG[targetLang]);
  for (const t of texts) body.append('text', t);

  const res = await fetch(DEEPL_URL, {
    method: 'POST',
    headers: {
      'Authorization': `DeepL-Auth-Key ${DEEPL_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (res.status === 456) throw new Error('DeepL quota exceeded (456)');
  if (!res.ok) {
    const msg = await res.text().catch(() => res.status);
    throw new Error(`DeepL ${res.status}: ${msg}`);
  }
  const data = await res.json();
  return data.translations.map(t => t.text);
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('Loading jmdict_trans.json…');
  const trans = JSON.parse(await readFile(TRANS_PATH, 'utf8'));

  const freqSrc  = await readFile(FREQ_PATH, 'utf8');
  const freqObj  = JSON.parse(freqSrc.slice(freqSrc.indexOf('{'), freqSrc.lastIndexOf('}') + 1));
  const freqWords = Object.keys(freqObj);

  // Build work list: for each (word, targetLang) that needs translation
  // Group by (sourceLang, targetLang) to batch efficiently
  const workGroups = {}; // key = "de->fr", value = [{word, srcText}]

  for (const word of freqWords) {
    const entry = trans[word];
    if (!entry) continue;

    for (const tgtLang of LANGS) {
      if (entry[tgtLang]) continue; // already has translation

      // Find best source
      const srcLang = SRC_PRIORITY.find(l => l !== tgtLang && entry[l]);
      if (!srcLang) continue; // no source available

      const key = `${srcLang}->${tgtLang}`;
      if (!workGroups[key]) workGroups[key] = [];
      workGroups[key].push({ word, srcText: entry[srcLang] });
    }
  }

  // Summary
  let totalItems = 0;
  let totalChars = 0;
  for (const [key, items] of Object.entries(workGroups)) {
    const chars = items.reduce((s, i) => s + i.srcText.length, 0);
    console.log(`  ${key}: ${items.length} words, ~${chars} chars`);
    totalItems += items.length;
    totalChars += chars;
  }
  console.log(`Total: ${totalItems} translations, ~${totalChars} chars\n`);

  // Load resume state
  let done = new Set();
  if (existsSync(PROG_PATH)) {
    const prog = JSON.parse(await readFile(PROG_PATH, 'utf8'));
    done = new Set(prog.done ?? []);
    console.log(`Resuming from ${done.size} already done.`);
  }

  let totalFound = 0;
  const byLang = { fr: 0, de: 0, es: 0, ru: 0 };

  function saveProgress() {
    writeFile(PROG_PATH, JSON.stringify({ done: [...done] }), 'utf8').catch(() => {});
  }
  function saveTrans() {
    return writeFile(TRANS_PATH, JSON.stringify(trans), 'utf8');
  }

  let interrupted = false;
  process.on('SIGINT', async () => {
    if (interrupted) return;
    interrupted = true;
    console.log('\nInterrupted — saving progress…');
    saveProgress();
    await saveTrans();
    console.log(`Saved. +${totalFound} translations added.`);
    process.exit(0);
  });

  // Process each group
  for (const [key, items] of Object.entries(workGroups)) {
    const [srcLang, tgtLang] = key.split('->');

    // Filter out already done
    const todo = items.filter(i => !done.has(`${key}:${i.word}`));
    if (todo.length === 0) continue;

    console.log(`\n=== ${key} (${todo.length} words) ===`);
    let i = 0;

    while (i < todo.length) {
      if (interrupted) break;
      const batch = todo.slice(i, i + BATCH);
      const pct   = Math.round((i / todo.length) * 100);
      process.stdout.write(`\r  [${String(i).padStart(5)}/${todo.length}] ${pct}% — +${totalFound} total`);

      try {
        const translated = await translateBatch(batch.map(b => b.srcText), srcLang, tgtLang);

        for (let j = 0; j < batch.length; j++) {
          const { word } = batch[j];
          const text = translated[j]?.trim();
          if (text && trans[word] && !trans[word][tgtLang]) {
            trans[word][tgtLang] = text;
            totalFound++;
            byLang[tgtLang]++;
          }
          done.add(`${key}:${word}`);
        }
      } catch (e) {
        if (e.message.includes('quota')) {
          console.error('\n❌  DeepL quota exceeded. Run again next month.');
          await saveTrans();
          saveProgress();
          process.exit(1);
        }
        console.warn(`\n  Batch error: ${e.message} — skipping`);
      }

      i += BATCH;

      if (i % 500 === 0) {
        saveProgress();
        await saveTrans();
      }

      await new Promise(r => setTimeout(r, DELAY));
    }
    process.stdout.write('\n');
  }

  // Final coverage report
  console.log(`\n✅  Done! +${totalFound} new translations`);
  for (const [l, n] of Object.entries(byLang)) {
    if (n) console.log(`  ${l.toUpperCase()}: +${n}`);
  }
  for (const lang of LANGS) {
    const has = freqWords.filter(w => trans[w]?.[lang]).length;
    console.log(`  ${lang.toUpperCase()} coverage: ${has}/${freqWords.length} (${Math.round(has/freqWords.length*100)}%)`);
  }

  saveProgress();
  await saveTrans();
  console.log(`\nSaved → ${TRANS_PATH}`);
  console.log('Next: git add public/jmdict_trans.json && git commit -m "feat(i18n): DeepL translations" && git push origin dev');
}

main().catch(err => { console.error(err); process.exit(1); });
