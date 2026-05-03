/**
 * patch-fallback.mjs
 *
 * For freq words still missing a translation in FR/DE/ES/RU,
 * copy from the best available language (EN priority, then any other).
 * This handles proper nouns, rare words, etc. — display in English is fine.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT  = join(dirname(fileURLToPath(import.meta.url)), '..');
const TRANS = join(ROOT, 'public', 'jmdict_trans.json');
const FREQ  = join(ROOT, 'src', 'freq.js');

const src = readFileSync(FREQ, 'utf8');
const freq = Object.keys(JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1)));
const trans = JSON.parse(readFileSync(TRANS, 'utf8'));

const LANGS   = ['fr', 'de', 'es', 'ru'];
const ALL     = ['en', 'fr', 'de', 'es', 'ru'];
const counts  = Object.fromEntries(LANGS.map(l => [l, 0]));

for (const word of freq) {
  if (!trans[word]) continue;
  const entry = trans[word];

  for (const lang of LANGS) {
    if (entry[lang]) continue;

    // Priority: EN first, then any other available lang
    const fallback = ALL.find(l => l !== lang && entry[l]);
    if (fallback) {
      entry[lang] = entry[fallback];
      counts[lang]++;
    }
  }
}

console.log('Fallback copies:');
let total = 0;
for (const l of LANGS) { console.log(`  ${l.toUpperCase()}: +${counts[l]}`); total += counts[l]; }
console.log(`  Total: +${total}`);

writeFileSync(TRANS, JSON.stringify(trans));
console.log('\nSaving jmdict_trans.json… Done ✓');

// Coverage report
const n = freq.length;
console.log('\nCoverage après fallback:');
for (const l of ALL) {
  const c = freq.filter(w => trans[w]?.[l]).length;
  console.log(`  ${l.toUpperCase()}: ${c}/${n} (${Math.round(c/n*100)}%)`);
}
