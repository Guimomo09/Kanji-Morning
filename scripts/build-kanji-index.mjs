#!/usr/bin/env node
/**
 * scripts/build-kanji-index.mjs
 *
 * Fetches meanings + readings for all JLPT N5-N1 kanji from kanjiapi.dev
 * and writes a compact search index to public/kanji_index.json.
 *
 * Format: { "馬": { "m": "horse, steed", "o": ["バ"], "k": ["うま"] }, ... }
 *
 * Run once:  node scripts/build-kanji-index.mjs
 */

import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir  = dirname(fileURLToPath(import.meta.url));
const ROOT   = join(__dir, '..');
const OUT    = join(ROOT, 'public', 'kanji_index.json');
const API    = 'https://kanjiapi.dev/v1';
const BATCH  = 30; // parallel requests per batch
const DELAY  = 200; // ms between batches

const sleep  = ms => new Promise(r => setTimeout(r, ms));

async function fetchJLPT(n) {
  const res = await fetch(`${API}/kanji/jlpt-${n}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for jlpt-${n}`);
  return res.json(); // string[]
}

async function fetchDetail(char) {
  try {
    const res = await fetch(`${API}/kanji/${encodeURIComponent(char)}`);
    if (!res.ok) return null;
    const d = await res.json();
    return {
      m: (d.meanings ?? []).slice(0, 4).join(', ') || '',
      o: (d.on_readings  ?? []).map(r => r.toLowerCase()),
      k: (d.kun_readings ?? []).map(r => r.replace(/-$/, '').toLowerCase()),
    };
  } catch {
    return null;
  }
}

async function main() {
  console.log('Fetching JLPT lists…');
  const lists = await Promise.all([5, 4, 3, 2, 1].map(n => fetchJLPT(n)));
  const allChars = [...new Set(lists.flat())];
  console.log(`Total unique kanji: ${allChars.length}`);

  const index = {};
  let done = 0;

  for (let i = 0; i < allChars.length; i += BATCH) {
    const batch = allChars.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(c => fetchDetail(c)));
    batch.forEach((c, j) => {
      if (results[j]) index[c] = results[j];
    });
    done += batch.length;
    process.stdout.write(`\r${done}/${allChars.length} kanji`);
    if (i + BATCH < allChars.length) await sleep(DELAY);
  }

  console.log('\nWriting kanji_index.json…');
  await writeFile(OUT, JSON.stringify(index), 'utf-8');
  console.log(`Done → ${OUT} (${Object.keys(index).length} entries)`);
}

main().catch(err => { console.error(err); process.exit(1); });
