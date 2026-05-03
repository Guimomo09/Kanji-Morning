#!/usr/bin/env node
/**
 * scripts/patch-en-pivot.mjs
 *
 * Pivot EN→FR/DE/ES/RU via en.wiktionary translation tables.
 *
 * Strategy:
 *   1. Find freq words that have EN but are missing FR/DE/ES/RU
 *   2. Extract the base English word from the EN gloss
 *      ("to eat" → "eat", "eating utensil" → skip)
 *   3. Batch-query en.wiktionary for those English words
 *   4. Parse {{t+|fr|manger}}-style translation templates
 *   5. Apply back to every JP word that shares the same EN base
 *
 * Run: node scripts/patch-en-pivot.mjs [fr|de|es|ru|all]   (default: all)
 *
 * Cache: _enpivot_cache/<word>.json   (re-run at any time, safe to Ctrl-C)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync }                 from 'node:fs';
import { join, dirname }              from 'node:path';
import { fileURLToPath }              from 'node:url';

const __dir      = dirname(fileURLToPath(import.meta.url));
const ROOT       = join(__dir, '..');
const TRANS_PATH = join(ROOT, 'public', 'jmdict_trans.json');
const FREQ_PATH  = join(ROOT, 'src',    'freq.js');
const CACHE_DIR  = join(ROOT, '_enpivot_cache');

const ALL_LANGS = ['fr', 'de', 'es', 'ru'];

// en.wiktionary uses ISO 639-1 codes that match ours exactly
// Russian is 'ru' on wiktionary too (also sometimes 'rus' but we match either)

const BATCH = 40;    // wiktionary allows 50 titles per query; use 40 to be safe
const DELAY = 1500;  // ms between batches

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Extract a lookup-able base English word from a JMdict EN gloss.
 * Returns null if the gloss is too complex (phrase, skip it).
 */
function extractBaseWord(gloss) {
  if (!gloss) return null;
  // JMdict stores multiple glosses comma-separated — take the first
  const first = gloss.split(',')[0].trim().toLowerCase();

  // Strip leading "to " (verb infinitives)
  let w = first.replace(/^to /, '');

  // Remove parenthetical: "eat (food)" → "eat"
  w = w.replace(/\s*\([^)]*\)/g, '').trim();

  // Remove trailing punctuation / number annotations
  w = w.replace(/[^a-z\s'-]/gi, '').trim();

  // Only single words or simple two-word compounds (e.g. "ice cream")
  const wordCount = w.split(/\s+/).filter(Boolean).length;
  if (wordCount > 2) return null;

  // Minimum length, skip trivial grammatical words
  if (w.length < 2) return null;
  if (/^(be|is|are|was|were|have|has|had|do|does|did|a|an|the|of|in|on|at|by|for|with|from|to|and|or|not)$/.test(w)) return null;

  return w;
}

/**
 * Parse en.wiktionary wikitext and extract FR/DE/ES/RU translation targets.
 * Looks for: {{t+|fr|manger}}, {{t|de|essen|...}}, etc.
 * Returns { fr: "manger", de: "essen", ... }
 */
function parseTranslations(wikitext, langs) {
  if (!wikitext) return {};
  const result = {};
  // Match all translation templates; stop collecting once a lang is found
  // Pattern: {{t[+-]?|LANGCODE|WORD|optional-params...}}
  const re = /\{\{t[+\-]?c?\|([a-z]{2,3})\|([^|}\n]{1,60})/g;
  let m;
  while ((m = re.exec(wikitext)) !== null) {
    const lang = m[1];
    const word = m[2].trim();
    if (!langs.includes(lang)) continue;
    if (result[lang]) continue; // already have one, keep the first
    // Skip template references like {{...}}
    if (word.startsWith('{') || word.startsWith('[[')) continue;
    // Clean up wikilinks: [[manger|manger]] → "manger"
    const clean = word.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1').replace(/\[\[/g, '').trim();
    if (clean.length >= 1) result[lang] = clean;
  }
  return result;
}

/**
 * Batch-fetch wiktionary pages for multiple English words.
 * Returns Map<word, wikitext|null>
 */
async function fetchBatch(words, cacheDir) {
  const results = new Map();
  const toFetch = [];

  // Serve from cache first
  for (const word of words) {
    const cacheFile = join(cacheDir, encodeURIComponent(word) + '.json');
    if (existsSync(cacheFile)) {
      try {
        const c = JSON.parse(await readFile(cacheFile, 'utf8'));
        results.set(word, c.wikitext ?? null);
      } catch {
        toFetch.push(word);
      }
    } else {
      toFetch.push(word);
    }
  }

  if (toFetch.length === 0) return results;

  const url =
    'https://en.wiktionary.org/w/api.php?action=query&prop=revisions&rvprop=content' +
    '&rvslots=main&format=json&formatversion=2' +
    '&titles=' + toFetch.map(w => encodeURIComponent(w)).join('|');

  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'patch-en-pivot.mjs/1.0 (Kanji-Morning; open-source)' } });
    if (!res.ok) {
      console.warn(`  HTTP ${res.status} for batch`);
      for (const w of toFetch) results.set(w, null);
      return results;
    }
    const data = await res.json();
    const pages = data?.query?.pages ?? [];

    // Build title → wikitext map from response
    const byTitle = new Map();
    for (const page of pages) {
      if (page.missing || !page.revisions?.length) continue;
      const wikitext = page.revisions[0]?.slots?.main?.content ?? page.revisions[0]?.content ?? null;
      byTitle.set(page.title.toLowerCase(), wikitext);
    }

    for (const word of toFetch) {
      const wikitext = byTitle.get(word.toLowerCase()) ?? null;
      results.set(word, wikitext);
      // Cache result
      const cacheFile = join(cacheDir, encodeURIComponent(word) + '.json');
      await writeFile(cacheFile, JSON.stringify({ wikitext }), 'utf8');
    }
  } catch (e) {
    console.warn(`  Fetch error: ${e.message}`);
    for (const w of toFetch) results.set(w, null);
  }

  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2] ?? 'all';
  const targetLangs = arg === 'all' ? ALL_LANGS : [arg];
  if (!targetLangs.every(l => ALL_LANGS.includes(l))) {
    console.error('Usage: node scripts/patch-en-pivot.mjs [fr|de|es|ru|all]');
    process.exit(1);
  }

  await mkdir(CACHE_DIR, { recursive: true });

  // Load translations
  console.log('Loading jmdict_trans.json…');
  const trans = JSON.parse(await readFile(TRANS_PATH, 'utf8'));

  // Load freq list
  const freqSrc = await readFile(FREQ_PATH, 'utf8');
  const freq = Object.keys(
    JSON.parse(freqSrc.slice(freqSrc.indexOf('{'), freqSrc.lastIndexOf('}') + 1))
  );
  console.log(`Freq list: ${freq.length} words`);

  // ── Step 1: find words missing target langs but having EN ──────────────────
  // Map: baseEnWord → [jpWord1, jpWord2, ...]
  const enToJp = new Map();
  let candidates = 0;

  for (const jpWord of freq) {
    const entry = trans[jpWord];
    if (!entry?.en) continue;

    // Check if any target lang is missing
    const hasGap = targetLangs.some(l => !entry[l]);
    if (!hasGap) continue;

    const base = extractBaseWord(entry.en);
    if (!base) continue;

    candidates++;
    if (!enToJp.has(base)) enToJp.set(base, []);
    enToJp.get(base).push(jpWord);
  }

  const uniqueEnWords = [...enToJp.keys()];
  console.log(`\nCandidates: ${candidates} JP words → ${uniqueEnWords.length} unique EN base words`);
  console.log(`Querying en.wiktionary for ${uniqueEnWords.length} words…\n`);

  // ── Step 2: batch-fetch wiktionary ────────────────────────────────────────
  // Map: enWord → { fr: "...", de: "...", ... }
  const enTransMap = new Map();
  let fetched = 0;
  let hits = 0;

  for (let i = 0; i < uniqueEnWords.length; i += BATCH) {
    const batch = uniqueEnWords.slice(i, i + BATCH);
    const wikitexts = await fetchBatch(batch, CACHE_DIR);

    for (const [word, wikitext] of wikitexts) {
      const tl = parseTranslations(wikitext, targetLangs);
      enTransMap.set(word, tl);
      if (Object.keys(tl).length > 0) hits++;
    }

    fetched += batch.length;
    const pct = Math.round(fetched / uniqueEnWords.length * 100);
    process.stdout.write(`\r  ${fetched}/${uniqueEnWords.length} (${pct}%) — ${hits} EN words with translations`);

    if (i + BATCH < uniqueEnWords.length) await sleep(DELAY);
  }
  console.log('\n');

  // ── Step 3: apply translations to JP words ────────────────────────────────
  const added = Object.fromEntries(targetLangs.map(l => [l, 0]));
  let totalJpPatched = 0;

  for (const [enWord, jpWords] of enToJp) {
    const tl = enTransMap.get(enWord) ?? {};
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
      if (patched) totalJpPatched++;
    }
  }

  // ── Step 4: summary ───────────────────────────────────────────────────────
  console.log('Results:');
  for (const lang of targetLangs) {
    console.log(`  ${lang.toUpperCase()}: +${added[lang]} translations`);
  }
  console.log(`  Total JP words patched: ${totalJpPatched}`);

  if (totalJpPatched === 0) {
    console.log('\nNothing to save.');
    return;
  }

  console.log('\nSaving jmdict_trans.json…');
  await writeFile(TRANS_PATH, JSON.stringify(trans), 'utf8');
  console.log('Done ✓');

  // Print updated coverage
  console.log('\nUpdated coverage:');
  for (const lang of ['en', 'fr', 'de', 'es', 'ru']) {
    const has = freq.filter(w => trans[w]?.[lang]).length;
    console.log(`  ${lang.toUpperCase()}: ${has}/${freq.length} (${Math.round(has / freq.length * 100)}%)`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
