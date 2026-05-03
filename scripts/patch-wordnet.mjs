#!/usr/bin/env node
/**
 * scripts/patch-wordnet.mjs
 *
 * Fills missing translations in public/jmdict_trans.json using:
 *   - Japanese WordNet (JWN v1.1) — JP word → synset IDs
 *   - Open Multilingual Wordnet (OMW) — synset ID → FR/DE/ES/RU lemma
 *
 * Sources (all free, 1-time download of ~10 MB total):
 *   JWN  https://github.com/bond-lab/wnja/releases/download/v1.1/wnjpn-ok.tab.gz
 *   FR   https://raw.githubusercontent.com/omwn/omw-data/main/wns/fra/wn-data-fra.tab
 *   DE   https://raw.githubusercontent.com/omwn/omw-data/main/wns/wikt/wn-wikt-deu.tab
 *   ES   https://raw.githubusercontent.com/omwn/omw-data/main/wns/mcr/wn-data-spa.tab
 *   RU   https://raw.githubusercontent.com/omwn/omw-data/main/wns/wikt/wn-wikt-rus.tab
 *
 * Run: node scripts/patch-wordnet.mjs
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync }                 from 'node:fs';
import { createGunzip }               from 'node:zlib';
import { join, dirname }              from 'node:path';
import { fileURLToPath }              from 'node:url';
import { pipeline }                   from 'node:stream/promises';
import { Readable }                   from 'node:stream';

const __dir      = dirname(fileURLToPath(import.meta.url));
const ROOT       = join(__dir, '..');
const TRANS_PATH = join(ROOT, 'public', 'jmdict_trans.json');
const FREQ_PATH  = join(ROOT, 'src',    'freq.js');
const CACHE      = join(ROOT, '_wordnet_cache');

const LANGS = ['fr', 'de', 'es', 'ru'];

// ── Data sources ──────────────────────────────────────────────────────────────
const JWN_URL = 'https://github.com/bond-lab/wnja/releases/download/v1.1/wnjpn-ok.tab.gz';

const OMW_URLS = {
  fr: 'https://raw.githubusercontent.com/omwn/omw-data/main/wns/fra/wn-data-fra.tab',
  de: 'https://raw.githubusercontent.com/omwn/omw-data/main/wns/wikt/wn-wikt-deu.tab',
  es: 'https://raw.githubusercontent.com/omwn/omw-data/main/wns/mcr/wn-data-spa.tab',
  ru: 'https://raw.githubusercontent.com/omwn/omw-data/main/wns/wikt/wn-wikt-rus.tab',
};

// ── Download helpers ──────────────────────────────────────────────────────────
async function fetchGz(url, cacheFile) {
  const path = join(CACHE, cacheFile);
  if (existsSync(path)) {
    process.stdout.write(`  (cached) ${cacheFile}\n`);
    return readFile(path, 'utf8');
  }
  process.stdout.write(`  Downloading ${cacheFile} … `);
  const res = await fetch(url, { headers: { 'User-Agent': 'patch-wordnet.mjs/1.1' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const chunks = [];
  await pipeline(
    Readable.from(buf),
    createGunzip(),
    async function* (src) { for await (const c of src) chunks.push(c); }
  );
  const text = Buffer.concat(chunks).toString('utf8');
  await writeFile(path, text, 'utf8');
  process.stdout.write(`OK (${Math.round(text.length / 1024)} KB)\n`);
  return text;
}

async function fetchText(url, cacheFile) {
  const path = join(CACHE, cacheFile);
  if (existsSync(path)) {
    process.stdout.write(`  (cached) ${cacheFile}\n`);
    return readFile(path, 'utf8');
  }
  process.stdout.write(`  Downloading ${cacheFile} … `);
  const res = await fetch(url, { headers: { 'User-Agent': 'patch-wordnet.mjs/1.1' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const text = await res.text();
  await writeFile(path, text, 'utf8');
  process.stdout.write(`OK (${Math.round(text.length / 1024)} KB)\n`);
  return text;
}

// ── JWN parser ────────────────────────────────────────────────────────────────
// wnjpn-ok.tab.gz format (confirmed):  synset \t jp_lemma \t source
// Returns: Map<jp_lemma, Set<synset_id>>
function parseJwn(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    if (!line || line[0] === '#') continue;
    const [synset, lemma] = line.split('\t');
    if (!synset || !lemma) continue;
    const s  = synset.trim();
    const lm = lemma.trim();
    if (!s || !lm) continue;
    // Only keep Japanese entries (lemma contains CJK)
    if (!/[\u3040-\u9FFF]/.test(lm)) continue;
    if (!map.has(lm)) map.set(lm, new Set());
    map.get(lm).add(s);
  }
  return map;
}

// ── OMW parser ────────────────────────────────────────────────────────────────
// Format:  synset \t lang:lemma \t actual_lemma
// Returns: Map<synset_id, first_lemma>
function parseOmw(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    if (!line || line[0] === '#' || line.startsWith('//')) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [synset, rel, lemma] = parts;
    if (!rel.endsWith(':lemma')) continue;       // skip defs, examples
    const s  = synset.trim();
    const lm = lemma.trim();
    if (!s || !lm) continue;
    if (!map.has(s)) map.set(s, lm);            // keep first lemma per synset
  }
  return map;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  await mkdir(CACHE, { recursive: true });

  console.log('Loading jmdict_trans.json…');
  const trans = JSON.parse(await readFile(TRANS_PATH, 'utf8'));

  const freqSrc   = await readFile(FREQ_PATH, 'utf8');
  const freqObj   = JSON.parse(freqSrc.slice(freqSrc.indexOf('{'), freqSrc.lastIndexOf('}') + 1));
  const freqWords = Object.keys(freqObj);
  console.log(`Freq words: ${freqWords.length}`);

  // ── Download & parse JWN ─────────────────────────────────────────────────
  console.log('\nJapanese WordNet (JWN v1.1):');
  const jwnText   = await fetchGz(JWN_URL, 'wnjpn-ok.tab');
  const jpToSynsets = parseJwn(jwnText);
  console.log(`  JP lemmas mapped to synsets: ${jpToSynsets.size}`);

  // Quick sanity
  for (const w of ['時計', '魔女', '警察', '刑事']) {
    const s = jpToSynsets.get(w);
    console.log(`  ${w}: ${s ? [...s].slice(0,3).join(', ') : '(not in JWN)'}`);
  }

  // ── Download & parse OMW ──────────────────────────────────────────────────
  console.log('\nOpen Multilingual Wordnet:');
  const omwMaps = {};
  for (const lang of LANGS) {
    const url = OMW_URLS[lang];
    const file = `omw-${lang}.tab`;
    try {
      const text = await fetchText(url, file);
      omwMaps[lang] = parseOmw(text);
      console.log(`  ${lang.toUpperCase()}: ${omwMaps[lang].size} synset→lemma pairs`);
    } catch (e) {
      console.warn(`  ${lang.toUpperCase()}: FAILED — ${e.message}`);
      omwMaps[lang] = new Map();
    }
  }

  // ── Apply translations ────────────────────────────────────────────────────
  console.log('\nApplying translations…');
  const counts = Object.fromEntries(LANGS.map(l => [l, 0]));

  for (const word of freqWords) {
    const synsets = jpToSynsets.get(word);
    if (!synsets) continue;
    if (!trans[word]) trans[word] = {};

    for (const lang of LANGS) {
      if (trans[word][lang]) continue;          // already have it
      const omw = omwMaps[lang];
      for (const synset of synsets) {
        const lemma = omw.get(synset);
        if (lemma) {
          trans[word][lang] = lemma;
          counts[lang]++;
          break;                                // first synset hit is enough
        }
      }
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  console.log('\nNew translations added:');
  for (const lang of LANGS) {
    console.log(`  ${lang.toUpperCase()}: +${counts[lang]}`);
  }

  // Sanity-check a few words
  console.log('\nSample results:');
  for (const w of ['魔女', '刑事', '警察', '時計', '医者', '政治家']) {
    const e = trans[w];
    if (e) console.log(`  ${w}: fr=${e.fr ?? '-'}, de=${e.de ?? '-'}, es=${e.es ?? '-'}`);
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  console.log('\nSaving jmdict_trans.json…');
  await writeFile(TRANS_PATH, JSON.stringify(trans), 'utf8');

  // Coverage report
  const total = freqWords.length;
  for (const lang of ['en', ...LANGS]) {
    const has = freqWords.filter(w => trans[w]?.[lang]).length;
    console.log(`  ${lang.toUpperCase()} coverage: ${has}/${total} (${Math.round(has / total * 100)}%)`);
  }
  console.log('\nDone!');
}

main().catch(e => { console.error(e); process.exit(1); });