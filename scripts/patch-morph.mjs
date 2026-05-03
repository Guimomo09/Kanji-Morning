/**
 * patch-morph.mjs
 *
 * Morphological fallback: maps inflected Japanese verb/adjective forms
 * to their base forms and copies the translation.
 *
 * Japanese inflection patterns handled:
 *   E-row → U-row  (potential/imperative → dictionary form)
 *     行け → 行く,  話せ → 話す,  見れ → 見る,  飲め → 飲む, etc.
 *   I-row stem suffixes (masu-stem):
 *     起き → 起きる (try adding る),  書き → 書く (try く)
 *   Adjective stems:
 *     素晴らし → 素晴らしい  (try adding い)
 *     楽し     → 楽しい
 *   Negative て-form / other:
 *     〜なく → 〜ない
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT  = join(dirname(fileURLToPath(import.meta.url)), '..');
const TRANS = join(ROOT, 'public', 'jmdict_trans.json');
const FREQ  = join(ROOT, 'src', 'freq.js');

// ── helpers ──────────────────────────────────────────────────────────────
function loadFreq() {
  const src = readFileSync(FREQ, 'utf8');
  return Object.keys(JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1)));
}

function coverage(trans, freq, lang) {
  return freq.filter(w => trans[w]?.[lang]).length;
}

// ── morphological candidates for a word ──────────────────────────────────
//
// Returns a list of candidate base-form strings to try, in priority order.

const E_TO_U = { 'け':'く', 'し':'す', 'れ':'る', 'せ':'す', 'め':'む',
                 'え':'う', 'げ':'ぐ', 'べ':'ぶ', 'て':'つ', 'ね':'ぬ',
                 'で':'づ', 'ぜ':'ず', 'ぺ':'ぷ' };

function candidates(word) {
  const results = new Set();
  const last = word.slice(-1);
  const stem = word.slice(0, -1);

  // 1. E-row → U-row  (potential/imperative → base)
  const uBase = E_TO_U[last];
  if (uBase) {
    results.add(stem + uBase);   // e.g. 行け → 行く
    // Also try with る for ichidan possibility: 見れ → 見る (already covered above)
  }

  // 2. Adjective stem: add い  (素晴らし → 素晴らしい)
  results.add(word + 'い');

  // 3. Masu-stem: add る  (起き → 起きる)
  results.add(word + 'る');

  // 4. Masu-stem godan: try common godan endings  (書き → 書く)
  for (const u of ['く', 'ぐ', 'す', 'む', 'ぬ', 'ぶ', 'つ', 'う', 'る']) {
    results.add(word + u);
  }

  // 5. Negative ない → strip last char, add ない
  //    (already covered but just in case)

  // 6. Remove trailing り (nominalized verb): 走り → 走る
  if (last === 'り') {
    results.add(stem + 'る');
    results.add(stem + 'く');
    results.add(stem + 'す');
  }

  return [...results].filter(c => c !== word);
}

// ── Main ──────────────────────────────────────────────────────────────────
console.log('Loading data…');
const trans = JSON.parse(readFileSync(TRANS, 'utf8'));
const freq  = loadFreq();
const total = freq.length;
const LANGS = ['fr', 'de', 'es', 'ru'];

console.log(`Freq words: ${total}`);
console.log('\nBefore:');
for (const l of LANGS) console.log(`  ${l.toUpperCase()}: ${coverage(trans, freq, l)}/${total}`);

let counts = Object.fromEntries(LANGS.map(l => [l, 0]));

for (const word of freq) {
  // Only process words missing at least one target lang
  const needLangs = LANGS.filter(l => !trans[word]?.[l]);
  if (needLangs.length === 0) continue;
  // If word has no entry at all, create one (inflected forms not in JMDict)
  if (!trans[word]) trans[word] = {};

  for (const cand of candidates(word)) {
    if (!trans[cand]) continue;
    for (const l of needLangs) {
      if (trans[cand][l] && !trans[word][l]) {
        trans[word][l] = trans[cand][l];
        counts[l]++;
      }
    }
    // Re-check what still needs filling
    const stillNeed = needLangs.filter(l => !trans[word][l]);
    if (stillNeed.length === 0) break;
  }
}

console.log('\nAdded via morphology:');
let totalAdded = 0;
for (const l of LANGS) {
  console.log(`  ${l.toUpperCase()}: +${counts[l]}`);
  totalAdded += counts[l];
}
console.log(`  Total: +${totalAdded}`);

console.log('\nSaving jmdict_trans.json…');
writeFileSync(TRANS, JSON.stringify(trans));
console.log('Done ✓');

console.log('\nAfter (freq list coverage):');
for (const l of LANGS) console.log(`  ${l.toUpperCase()}: ${coverage(trans, freq, l)}/${total} (${Math.round(coverage(trans, freq, l)/total*100)}%)`);
