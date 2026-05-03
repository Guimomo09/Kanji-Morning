#!/usr/bin/env node
/**
 * scripts/patch-kaikki.mjs
 *
 * Fills missing FR/DE/ES/RU translations using kaikki.org's en-wiktionary
 * translation extracts (offline, no API, no rate limits).
 *
 * Source: https://kaikki.org/dictionary/English/by-pos/
 * We use the pre-built "translations" JSONL file which contains every
 * translation section from en.wiktionary, one entry per line:
 *   { "word": "eat", "translations": [{ "lang_code": "fr", "word": "manger" }, ...] }
 *
 * Strategy:
 *   1. Download kaikki EN→all translations (~80MB JSONL, cached)
 *   2. Build map: enWord → { fr, de, es, ru }
 *   3. For each freq JP word missing a lang: look up EN gloss → get target lang
 *
 * Run: node scripts/patch-kaikki.mjs [fr|de|es|ru|all]   (default: all)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';

const __dir      = dirname(fileURLToPath(import.meta.url));
const ROOT       = join(__dir, '..');
const TRANS_PATH = join(ROOT, 'public', 'jmdict_trans.json');
const FREQ_PATH  = join(ROOT, 'src',    'freq.js');
const CACHE_DIR  = join(ROOT, '_kaikki_cache');

const ALL_LANGS = ['fr', 'de', 'es', 'ru'];

// kaikki.org full en-wiktionary translations (one JSON object per line)
// This is the "kaikki.org-dictionary-English.jsonl.gz" file — contains all entries
// with their translation sections pre-extracted.
const KAIKKI_URL = 'https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz';
const KAIKKI_CACHE = join(CACHE_DIR, 'kaikki-en.jsonl.gz');
const KAIKKI_JSONL = join(CACHE_DIR, 'kaikki-en.jsonl');

// ── Download helper ───────────────────────────────────────────────────────────

async function download(url, destPath) {
  console.log(`Downloading ${url} …`);
  console.log('(This is a large file ~80MB, one-time download)');
  const res = await fetch(url, {
    headers: { 'User-Agent': 'patch-kaikki.mjs/1.0 (Kanji-Morning; open-source)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const dest = createWriteStream(destPath);
  await pipeline(res.body, dest);
  console.log('Download complete.');
}

async function decompress(gzPath, outPath) {
  console.log('Decompressing…');
  const src  = createReadStream(gzPath);
  const gunz = createGunzip();
  const dest = createWriteStream(outPath);
  await pipeline(src, gunz, dest);
  console.log('Decompressed.');
}

// ── Extract base EN word (same logic as patch-en-pivot.mjs) ──────────────────

function extractBaseWord(gloss) {
  if (!gloss) return null;
  const first = gloss.split(',')[0].trim().toLowerCase();
  let w = first.replace(/^to /, '');
  w = w.replace(/\s*\([^)]*\)/g, '').trim();
  w = w.replace(/[^a-z\s'-]/gi, '').trim();
  const wordCount = w.split(/\s+/).filter(Boolean).length;
  if (wordCount > 2) return null;
  if (w.length < 2) return null;
  if (/^(be|is|are|was|were|have|has|had|do|does|did|a|an|the|of|in|on|at|by|for|with|from|to|and|or|not)$/.test(w)) return null;
  return w;
}

// ── Parse kaikki JSONL and build EN→{fr,de,es,ru} map ────────────────────────

async function buildKaikkiMap(jsonlPath, targetLangs, neededWords) {
  console.log('Parsing kaikki JSONL…');
  const map = new Map(); // enWord → { fr, de, es, ru }

  const rl = createInterface({
    input: createReadStream(jsonlPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let lines = 0;
  let hits = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    lines++;
    if (lines % 100000 === 0) process.stdout.write(`\r  Parsed ${lines} entries, ${hits} with translations…`);

    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    const word = entry.word?.toLowerCase();
    if (!word || !neededWords.has(word)) continue;
    if (!entry.translations?.length) continue;

    if (!map.has(word)) map.set(word, {});
    const row = map.get(word);

    for (const t of entry.translations) {
      const lc = t.lang_code?.toLowerCase();
      if (!lc || !targetLangs.includes(lc)) continue;
      if (row[lc]) continue; // keep first
      const tw = t.word?.trim();
      if (!tw || tw.length < 1) continue;
      row[lc] = tw;
      hits++;
    }
  }

  process.stdout.write(`\r  Parsed ${lines} entries, ${hits} translations found\n`);
  return map;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2] ?? 'all';
  const targetLangs = arg === 'all' ? ALL_LANGS : [arg];
  if (!targetLangs.every(l => ALL_LANGS.includes(l))) {
    console.error('Usage: node scripts/patch-kaikki.mjs [fr|de|es|ru|all]');
    process.exit(1);
  }

  await mkdir(CACHE_DIR, { recursive: true });

  // ── Load data ──────────────────────────────────────────────────────────────
  console.log('Loading jmdict_trans.json…');
  const trans = JSON.parse(await readFile(TRANS_PATH, 'utf8'));

  const freqSrc = await readFile(FREQ_PATH, 'utf8');
  const freq = Object.keys(
    JSON.parse(freqSrc.slice(freqSrc.indexOf('{'), freqSrc.lastIndexOf('}') + 1))
  );
  console.log(`Freq list: ${freq.length} words`);

  // ── Find needed EN base words ──────────────────────────────────────────────
  const enToJp = new Map(); // enWord → [jpWords]
  for (const jpWord of freq) {
    const entry = trans[jpWord];
    if (!entry?.en) continue;
    const hasGap = targetLangs.some(l => !entry[l]);
    if (!hasGap) continue;
    const base = extractBaseWord(entry.en);
    if (!base) continue;
    if (!enToJp.has(base)) enToJp.set(base, []);
    enToJp.get(base).push(jpWord);
  }

  const neededWords = new Set(enToJp.keys());
  console.log(`\nNeed translations for ${neededWords.size} unique EN words\n`);

  // ── Download + decompress kaikki (one-time) ────────────────────────────────
  if (!existsSync(KAIKKI_JSONL)) {
    if (!existsSync(KAIKKI_CACHE)) {
      await download(KAIKKI_URL, KAIKKI_CACHE);
    }
    await decompress(KAIKKI_CACHE, KAIKKI_JSONL);
  } else {
    console.log('(kaikki JSONL already cached)');
  }

  // ── Build translation map from kaikki ─────────────────────────────────────
  const kaikkiMap = await buildKaikkiMap(KAIKKI_JSONL, targetLangs, neededWords);
  console.log(`\nEN words with kaikki translations: ${kaikkiMap.size}/${neededWords.size}`);

  // ── Apply to JP words ──────────────────────────────────────────────────────
  const added = Object.fromEntries(targetLangs.map(l => [l, 0]));
  let totalPatched = 0;

  for (const [enWord, jpWords] of enToJp) {
    const tl = kaikkiMap.get(enWord) ?? {};
    if (Object.keys(tl).length === 0) continue;
    for (const jpWord of jpWords) {
      if (!trans[jpWord]) trans[jpWord] = {};
      let patched = false;
      for (const lang of targetLangs) {
        if (!trans[jpWord][lang] && tl[lang]) {
          trans[jpWord][lang] = tl[lang];
          added[lang]++;
          patched = true;
        }
      }
      if (patched) totalPatched++;
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\nResults:');
  for (const lang of targetLangs) {
    console.log(`  ${lang.toUpperCase()}: +${added[lang]} translations`);
  }
  console.log(`  Total JP words patched: ${totalPatched}`);

  if (totalPatched === 0) {
    console.log('\nNothing new to save.');
    return;
  }

  console.log('\nSaving jmdict_trans.json…');
  await writeFile(TRANS_PATH, JSON.stringify(trans), 'utf8');
  console.log('Done ✓');

  console.log('\nUpdated coverage:');
  for (const lang of ['en', 'fr', 'de', 'es', 'ru']) {
    const has = freq.filter(w => trans[w]?.[lang]).length;
    console.log(`  ${lang.toUpperCase()}: ${has}/${freq.length} (${Math.round(has / freq.length * 100)}%)`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
