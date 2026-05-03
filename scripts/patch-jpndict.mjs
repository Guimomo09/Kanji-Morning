/**
 * patch-jpndict.mjs
 *
 * Uses FreeDict jpn-X dictionaries (Japanese → target language) from the
 * fd-dictionaries monorepo. Source is Jim Breen's JMDict, same origin as our
 * jmdict_trans.json, so kanji keys match directly — no English pivot needed.
 *
 * Available:
 *   jpn-fra  (14 891 headwords)  → FR
 *   jpn-deu                      → DE
 *   jpn-rus                      → RU
 *   (no jpn-spa in FreeDict)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir  = dirname(fileURLToPath(import.meta.url));
const ROOT   = join(__dir, '..');
const TRANS  = join(ROOT, 'public', 'jmdict_trans.json');
const CACHE  = join(ROOT, '_jpndict_cache');

const BASE_URL = 'https://raw.githubusercontent.com/freedict/fd-dictionaries/master';

const DICTS = [
  { lang: 'fr', file: 'jpn-fra', label: 'FR' },
  { lang: 'de', file: 'jpn-deu', label: 'DE' },
  { lang: 'ru', file: 'jpn-rus', label: 'RU' },
];

// ── Download helper ────────────────────────────────────────────────────────
async function download(url, dest) {
  console.log(`  Downloading ${url} …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const buf = await res.arrayBuffer();
  writeFileSync(dest, Buffer.from(buf));
  console.log(`  Saved ${dest}`);
}

// ── Parse TEI (jpn-X format) → Map<kanjiWord, translation> ────────────────
//
// Entry structure:
//   <entry>
//     <form type="k_ele"><orth>明白</orth></form>   ← may be multiple
//     <form type="r_ele"><orth>めいはく</orth></form>
//     <sense>
//       <cit ... type="trans"><quote>évident</quote></cit>   ← first sense used
//     </sense>
//   </entry>

function parseTeiJpn(xml) {
  const map = new Map(); // kanjiWord → translation (first sense only)

  const entryRe  = /<entry[^>]*>([\s\S]*?)<\/entry>/g;
  const keleRe   = /<form[^>]*type=["']k_ele["'][^>]*>\s*<orth[^>]*>([^<]+)<\/orth>/g;
  const quoteRe  = /<cit[^>]*type=["']trans["'][^>]*>\s*<quote[^>]*>([^<]+)<\/quote>/;

  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const block = m[1];

    // Collect all kanji forms for this entry
    const kanjis = [];
    let km;
    keleRe.lastIndex = 0;
    while ((km = keleRe.exec(block)) !== null) {
      kanjis.push(km[1].trim());
    }
    if (kanjis.length === 0) continue;

    // First translation
    const trM = quoteRe.exec(block);
    if (!trM) continue;
    const translation = trM[1].trim();
    if (!translation) continue;

    for (const k of kanjis) {
      if (!map.has(k)) map.set(k, translation);
    }
  }

  return map;
}

// ── Main ───────────────────────────────────────────────────────────────────
console.log('Loading jmdict_trans.json…');
const trans = JSON.parse(readFileSync(TRANS, 'utf8'));
const words  = Object.keys(trans);
console.log(`Total words: ${words.length}`);

mkdirSync(CACHE, { recursive: true });

const results = {};
for (const { lang } of DICTS) results[lang] = 0;

for (const { lang, file, label } of DICTS) {
  console.log(`\n── ${label} ──`);

  const cachePath = join(CACHE, `${file}.tei`);
  if (!existsSync(cachePath)) {
    const url = `${BASE_URL}/${file}/${file}.tei`;
    try {
      await download(url, cachePath);
    } catch (e) {
      console.log(`  Failed to get ${label} dict: ${e.message}`);
      continue;
    }
  } else {
    console.log(`  Using cached ${file}.tei`);
  }

  const xml = readFileSync(cachePath, 'utf8');
  const dictMap = parseTeiJpn(xml);
  console.log(`  Dict entries: ${dictMap.size}`);

  let added = 0;
  for (const word of words) {
    if (trans[word][lang]) continue;        // already translated
    const tr = dictMap.get(word);
    if (!tr) continue;
    trans[word][lang] = tr;
    added++;
  }
  console.log(`  +${added} translations added`);
  results[lang] = added;
}

console.log('\nResults:');
for (const { lang, label } of DICTS) {
  console.log(`  ${label}: +${results[lang]}`);
}
console.log(`  Total: +${Object.values(results).reduce((a, b) => a + b, 0)}`);

console.log('\nSaving jmdict_trans.json…');
writeFileSync(TRANS, JSON.stringify(trans));
console.log('Done ✓');

// ── Coverage report ────────────────────────────────────────────────────────
const langs = ['en', 'fr', 'de', 'es', 'ru'];
const total  = words.length;
console.log('\nUpdated coverage:');
for (const l of langs) {
  const n = words.filter(w => trans[w][l]).length;
  console.log(`  ${l.toUpperCase()}: ${n}/${total} (${Math.round(n / total * 100)}%)`);
}
