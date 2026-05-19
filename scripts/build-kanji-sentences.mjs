/**
 * build-kanji-sentences.mjs
 *
 * Pre-computes public/kanji-sentences.json from public/sentences.json.
 * Maps each kanji → best 2 sentences from sentences.json that contain it.
 *
 * Used as a fallback by generate-kanji-cards.mjs and generate-reels.mjs
 * (after SENTENCE_OVERRIDE, before Tatoeba live fetch).
 *
 * Usage:
 *   node scripts/build-kanji-sentences.mjs
 *   node scripts/build-kanji-sentences.mjs --min-len 8 --max-len 60
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args   = process.argv.slice(2);
const getArg = (f, d) => { const i = args.indexOf(f); return i !== -1 ? args[i+1] : d; };
const MIN_LEN = parseInt(getArg('--min-len', '6'),  10);
const MAX_LEN = parseInt(getArg('--max-len', '70'), 10);

const sentences  = JSON.parse(readFileSync(join(ROOT, 'public', 'sentences.json'),  'utf8'));
const kanjiIndex = JSON.parse(readFileSync(join(ROOT, 'public', 'kanji_index.json'), 'utf8'));

const kanji_sentences = {};

for (const kanji of Object.keys(kanjiIndex)) {
  const candidates = [];

  for (const [, sent] of Object.entries(sentences)) {
    const jp = sent.jp?.trim();
    if (!jp || !en_ok(sent.en) || !jp.includes(kanji)) continue;
    const len = jp.length;
    if (len < MIN_LEN || len > MAX_LEN) continue;

    candidates.push({
      jp,
      en:   sent.en.trim(),
      ruby: sent.ruby || null,
      len,
    });
  }

  if (candidates.length === 0) continue;

  // Sort by length ascending (shorter = clearer for learners)
  candidates.sort((a, b) => a.len - b.len);

  // Deduplicate by jp, keep best 2
  const seen = new Set();
  const best = [];
  for (const c of candidates) {
    if (seen.has(c.jp)) continue;
    seen.add(c.jp);
    best.push({ jp: c.jp, en: c.en, ruby: c.ruby });
    if (best.length >= 2) break;
  }

  kanji_sentences[kanji] = best;
}

function en_ok(en) {
  return typeof en === 'string' && en.trim().length > 2;
}

const outPath = join(ROOT, 'public', 'kanji-sentences.json');
writeFileSync(outPath, JSON.stringify(kanji_sentences, null, 2), 'utf8');

const total   = Object.keys(kanji_sentences).length;
const inIndex = Object.keys(kanjiIndex).length;
const missing = inIndex - total;

console.log(`✅ kanji-sentences.json generated`);
console.log(`   ${total} / ${inIndex} kanji have sentences (${missing} still missing)`);

// Breakdown by JLPT level
const levels = { n5:0, n4:0, n3:0, n2:0, n1:0, '—':0 };
for (const [k] of Object.entries(kanji_sentences)) {
  const lvl = kanjiIndex[k]?.j;
  const key = lvl ? `n${lvl}` : '—';
  if (levels[key] !== undefined) levels[key]++;
  else levels['—']++;
}
console.log('   by level:', Object.entries(levels).filter(([,v])=>v>0).map(([k,v])=>`${k}:${v}`).join(' '));
