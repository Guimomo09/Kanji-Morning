#!/usr/bin/env node
/**
 * fill-sentences.mjs
 *
 * Generates Tatoeba sentences for the ~709 words in vocab-db.json
 * that are missing from public/sentences.json.
 *
 * Scoring mirrors build-vocab-database.mjs:
 *   - Polite form (です/ます/…)  → +100
 *   - Appropriate length         → +50 (penalty if over)
 *   - Ends with punctuation      → +20
 *   - Shorter = better           → +max(0, 30-len)
 *   - Way too long               → −50
 *
 * Fallback: if kanji form not found on Tatoeba, try kana reading.
 * Rate limit: 1 request/s to avoid Tatoeba bans.
 */

import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SENT_PATH = path.join(__dirname, '../public/sentences.json');
const DB_PATH   = path.join(__dirname, 'vocab-db.json');

const sentences = JSON.parse(fs.readFileSync(SENT_PATH, 'utf8'));
const db        = JSON.parse(fs.readFileSync(DB_PATH,   'utf8'));

// Max sentence length by JLPT level (same as build-vocab-database.mjs)
const MAX_LEN = { 5: 25, 4: 30, 3: 40, 2: 50, 1: 60 };

const POLITE_RE = /(です|ます|ました|でした|ません|ませんでした|でしょう|ましょう)[。？！]?$/;

async function searchTatoeba(query, jlptLevel) {
  const maxLen = MAX_LEN[jlptLevel] ?? 60;
  try {
    const url = `https://tatoeba.org/en/api_v0/search?query=${encodeURIComponent(query)}&from=jpn&to=eng&limit=50&sort=relevance`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();

    const candidates = [];
    for (const r of (data.results || [])) {
      if (!r.text?.includes(query))           continue;
      if (!r.translations?.[0]?.[0]?.text)   continue;
      const jp = r.text.trim();
      const en = r.translations[0][0].text.trim();

      let score = 0;
      if (POLITE_RE.test(jp))              score += 100;
      if (jp.length <= maxLen)             score += 50;
      else                                 score -= (jp.length - maxLen);
      if (/[。！？]$/.test(jp))            score += 20;
      score += Math.max(0, 30 - jp.length);
      if (jp.length > maxLen * 1.5)        score -= 50;

      candidates.push({ jp, en, score });
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    return { jp: candidates[0].jp, en: candidates[0].en };
  } catch {
    return null;
  }
}

// Sleep helper
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Main ──────────────────────────────────────────────────────────────────────
const missing = db.filter(w => !sentences[w.word]);
console.log(`▶ ${missing.length} words missing — starting fill…`);
console.log(`  Rate limit: ~1 req/s — estimated time: ${Math.ceil(missing.length * 1.1 / 60)} min`);

let done = 0, found = 0;

for (const entry of missing) {
  done++;
  const prefix = `  [${done}/${missing.length}]`;

  // 1) Try kanji/written form
  let result = await searchTatoeba(entry.word, entry.jlptNum);
  await sleep(1100);

  // 2) Fallback: kana reading (e.g. 他所 → よそ)
  if (!result && entry.reading && entry.reading !== entry.word) {
    result = await searchTatoeba(entry.reading, entry.jlptNum);
    await sleep(1100);
  }

  if (result) {
    sentences[entry.word] = result;
    found++;
    console.log(`${prefix} ✓ ${entry.word}: ${result.jp}`);
  } else {
    console.log(`${prefix} ✗ ${entry.word}: no result`);
  }

  // Save every 50 words in case of interruption
  if (done % 50 === 0) {
    fs.writeFileSync(SENT_PATH, JSON.stringify(sentences, null, 2));
    console.log(`  💾 Checkpoint saved (${Object.keys(sentences).length} total)`);
  }
}

fs.writeFileSync(SENT_PATH, JSON.stringify(sentences, null, 2));
console.log(`\n▶ Done. Found ${found}/${missing.length} new sentences.`);
console.log(`  Total sentences: ${Object.keys(sentences).length} / ${db.length}`);
