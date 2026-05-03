#!/usr/bin/env node
/**
 * scripts/patch-freedict.mjs
 *
 * Fills missing FR/DE/ES/RU translations using FreeDict TEI dictionaries.
 * Sources: https://freedict.org  (CC-licensed, open data)
 *
 * Downloads eng-fra, eng-deu, eng-spa, eng-rus TEI files (a few MB each),
 * parses them offline, and fills gaps in jmdict_trans.json.
 *
 * Run: node scripts/patch-freedict.mjs [fr|de|es|ru|all]   (default: all)
 * Cache: _freedict_cache/  (safe to re-run, idempotent)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir      = dirname(fileURLToPath(import.meta.url));
const ROOT       = join(__dir, '..');
const TRANS_PATH = join(ROOT, 'public', 'jmdict_trans.json');
const FREQ_PATH  = join(ROOT, 'src',    'freq.js');
const CACHE_DIR  = join(ROOT, '_freedict_cache');

const ALL_LANGS = ['fr', 'de', 'es', 'ru'];

// FreeDict GitHub releases API — gets the latest release download URL per dict
const FREEDICT_API = 'https://api.freedict.org/dictionaries.json';

// Direct GitHub raw URLs — eng-fra is in fd-dictionaries monorepo, others in separate repos
const FALLBACK_URLS = {
  fr: 'https://raw.githubusercontent.com/freedict/fd-dictionaries/master/eng-fra/eng-fra.tei',
  de: 'https://raw.githubusercontent.com/freedict/eng-deu/master/eng-deu.tei',
  es: 'https://raw.githubusercontent.com/freedict/eng-spa/master/eng-spa.tei',
  ru: 'https://raw.githubusercontent.com/freedict/eng-rus/master/eng-rus.tei',
};

// FreeDict dict names per lang
const DICT_NAMES = { fr: 'eng-fra', de: 'eng-deu', es: 'eng-spa', ru: 'eng-rus' };

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'patch-freedict.mjs/1.0 (Kanji-Morning; open-source)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

async function fetchBuffer(url, destPath) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'patch-freedict.mjs/1.0 (Kanji-Morning; open-source)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const dest = createWriteStream(destPath);
  await pipeline(res.body, dest);
}

async function fetchGz(url, destPath) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'patch-freedict.mjs/1.0 (Kanji-Morning; open-source)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const dest = createWriteStream(destPath);
  const gunz = createGunzip();
  await pipeline(res.body, gunz, dest);
}

// ── Resolve download URLs from FreeDict API ───────────────────────────────────

async function resolveDictUrls(targetLangs) {
  const urls = {};
  try {
    console.log('Fetching FreeDict API…');
    const json = JSON.parse(await fetchText(FREEDICT_API));
    // API returns array of { name, releases: [{ URL, ... }] }
    for (const lang of targetLangs) {
      const dictName = DICT_NAMES[lang];
      const entry = json.find(d => d.name === dictName);
      const release = entry?.releases?.find(r => r.URL);
      if (release?.URL) {
        urls[lang] = release.URL;
        console.log(`  ${lang}: ${release.URL}`);
      } else {
        urls[lang] = FALLBACK_URLS[lang];
        console.log(`  ${lang}: (fallback) ${FALLBACK_URLS[lang]}`);
      }
    }
  } catch (e) {
    console.warn(`  FreeDict API failed (${e.message}), using fallback URLs`);
    for (const lang of targetLangs) urls[lang] = FALLBACK_URLS[lang];
  }
  return urls;
}

// ── Download and cache TEI file ────────────────────────────────────────────────

async function getTeiContent(lang, url) {
  const cachePath = join(CACHE_DIR, `${DICT_NAMES[lang]}.tei`);
  if (existsSync(cachePath)) {
    process.stdout.write(`  (cached) ${DICT_NAMES[lang]}.tei\n`);
    return readFile(cachePath, 'utf8');
  }

  console.log(`  Downloading ${url} …`);
  const isGz = url.endsWith('.gz') || url.includes('.tei.gz');

  if (isGz) {
    await fetchGz(url, cachePath);
  } else {
    await fetchBuffer(url, cachePath);
  }

  console.log(`  Saved ${DICT_NAMES[lang]}.tei`);
  return readFile(cachePath, 'utf8');
}

// ── Parse TEI XML → Map<enWord, targetWord> ────────────────────────────────────
// Actual FreeDict TEI structure:
//   <entry>
//     <form><orth>eat</orth></form>
//     <sense n="1">
//       <cit type="trans"><quote>manger</quote></cit>
//     </sense>
//   </entry>

function parseTei(xml) {
  const map = new Map(); // enWord.toLowerCase() → translation

  // Extract all <entry> blocks (lazy match, handles multiline)
  const entryRe = /<entry[^>]*>([\s\S]*?)<\/entry>/g;
  const orthRe  = /<orth[^>]*>([^<]+)<\/orth>/;
  // FreeDict uses <cit type="trans"><quote>word</quote></cit>
  const quoteRe = /<cit[^>]*type=["']trans["'][^>]*>\s*<quote[^>]*>([^<]+)<\/quote>/;

  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const block = m[1];
    const orthM = orthRe.exec(block);
    const trM   = quoteRe.exec(block);
    if (!orthM || !trM) continue;

    const enWord = orthM[1].trim().toLowerCase();
    const target = trM[1].trim();
    if (!enWord || !target) continue;
    if (map.has(enWord)) continue; // keep first
    map.set(enWord, target);
  }

  return map;
}

// ── Extract base EN word (same as other scripts) ──────────────────────────────
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

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2] ?? 'all';
  const targetLangs = arg === 'all' ? ALL_LANGS : [arg];
  if (!targetLangs.every(l => ALL_LANGS.includes(l))) {
    console.error('Usage: node scripts/patch-freedict.mjs [fr|de|es|ru|all]');
    process.exit(1);
  }

  await mkdir(CACHE_DIR, { recursive: true });

  console.log('Loading jmdict_trans.json…');
  const trans = JSON.parse(await readFile(TRANS_PATH, 'utf8'));

  const freqSrc = await readFile(FREQ_PATH, 'utf8');
  const freq = Object.keys(
    JSON.parse(freqSrc.slice(freqSrc.indexOf('{'), freqSrc.lastIndexOf('}') + 1))
  );
  console.log(`Freq list: ${freq.length} words\n`);

  // Build EN→JP index for words missing target langs
  const enToJp = new Map();
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
  console.log(`Candidates: ${[...enToJp.values()].flat().length} JP words → ${enToJp.size} unique EN words\n`);

  // Resolve download URLs
  const dictUrls = await resolveDictUrls(targetLangs);
  console.log();

  const added = Object.fromEntries(targetLangs.map(l => [l, 0]));
  let totalPatched = 0;

  for (const lang of targetLangs) {
    console.log(`── ${lang.toUpperCase()} ──`);
    let tei;
    try {
      tei = await getTeiContent(lang, dictUrls[lang]);
    } catch (e) {
      console.warn(`  Failed to get ${lang} dict: ${e.message}`);
      continue;
    }

    const dictMap = parseTei(tei);
    console.log(`  Dict entries: ${dictMap.size}`);

    let langAdded = 0;
    for (const [enWord, jpWords] of enToJp) {
      const target = dictMap.get(enWord);
      if (!target) continue;
      for (const jpWord of jpWords) {
        if (!trans[jpWord]) trans[jpWord] = {};
        if (!trans[jpWord][lang]) {
          trans[jpWord][lang] = target;
          added[lang]++;
          langAdded++;
          totalPatched++;
        }
      }
    }
    console.log(`  +${langAdded} translations added\n`);
  }

  console.log('Results:');
  for (const lang of targetLangs) {
    console.log(`  ${lang.toUpperCase()}: +${added[lang]}`);
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
