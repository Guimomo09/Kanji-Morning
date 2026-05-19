#!/usr/bin/env node
// Build a static vocab index for Kanji Morning.
// Mirrors the scoring logic from src/vocab.js (buildVocabItems) but runs
// offline against kanjiapi.dev so we can see exactly which words our app
// will surface, ranked by priority.
//
// Output: scripts/vocab-index.json (sorted by score, desc)
// Cache : scripts/.cache-words/<kanji>.json (per-kanji API response)
//
// Usage:  node scripts/build-vocab-index.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(__dirname, '.cache-words');
const OUT_FILE  = path.join(__dirname, 'vocab-index.json');

fs.mkdirSync(CACHE_DIR, { recursive: true });

// ── Mirror constants from src/config.js + src/vocab.js ─────────────────────
const LEVEL_LABEL = { 5: 'N5', 4: 'N4', 3: 'N3', 2: 'N2', 1: 'N1' };
const FREQ_CUTOFF = { 5: 2500, 4: 4500, 3: 9000, 2: 15000, 1: 20000 };
const TOP_TAGS    = ['news1', 'ichi1', 'spec1', 'nf01', 'nf02', 'nf03', 'nf04', 'nf05', 'nf06'];

// ── Load FREQ corpus from src/freq.js (ESM export) ─────────────────────────
const { FREQ } = await import(path.join(ROOT, 'src/freq.js'));

// ── Helpers (copied from src/vocab.js to keep behaviour identical) ─────────
function isAllKatakana(str) {
  return str && /^[\u30A0-\u30FF\uFF65-\uFF9F\u30FC\u30FE\u30FF\u309B\u309C]+$/.test(str);
}
function hasNoKanji(str) {
  return str && !/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(str);
}
function kanjiCount(str) {
  return [...(str || '')].filter(
    c => (c >= '\u4E00' && c <= '\u9FFF') || (c >= '\u3400' && c <= '\u4DBF')
  ).length;
}
function maxKanjiForLevel(jlptNum) {
  if (jlptNum >= 4) return 2;
  if (jlptNum === 3) return 3;
  return 99;
}
function priorityScore(priorities) {
  if (!priorities || !priorities.length) return 0;
  let score = 0;
  for (const p of priorities) {
    if      (p === 'news1' || p === 'ichi1' || p === 'spec1') score += 100;
    else if (p === 'news2' || p === 'ichi2' || p === 'spec2') score += 50;
    else if (/^nf0[1-9]$/.test(p))  score += 90;
    else if (/^nf[12]\d$/.test(p))  score += 40;
    else if (/^gai/.test(p))        score -= 60;
    else                            score += 5;
  }
  return score;
}
function isProperNoun(entry) {
  const properTags = /place|proper.?noun|city|country|region|district|prefecture|island|ocean|river|mountain|surname|given.?name|person.?name|organization|company|brand/i;
  if ((entry.meanings || []).some(m => (m.part_of_speech || []).some(p => properTags.test(p)))) return true;
  const allGlosses = (entry.meanings || []).flatMap(m => m.glosses || []);
  return allGlosses.length > 0 && allGlosses.every(g => /^[A-Z]/.test(g.trim()));
}

// ── Fetch JLPT lists + per-kanji words (with disk cache) ───────────────────
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function getJLPTList(num) {
  const cache = path.join(CACHE_DIR, `_jlpt-${num}.json`);
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, 'utf8'));
  const list = await fetchJSON(`https://kanjiapi.dev/v1/kanji/jlpt-${num}`);
  fs.writeFileSync(cache, JSON.stringify(list));
  return list;
}

async function getWords(char) {
  const cache = path.join(CACHE_DIR, `${encodeURIComponent(char)}.json`);
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, 'utf8'));
  try {
    const w = await fetchJSON(`https://kanjiapi.dev/v1/words/${encodeURIComponent(char)}`);
    fs.writeFileSync(cache, JSON.stringify(w));
    return w;
  } catch {
    fs.writeFileSync(cache, '[]');
    return [];
  }
}

// ── Concurrency limiter ────────────────────────────────────────────────────
async function mapLimit(arr, limit, fn) {
  const out = new Array(arr.length);
  let i = 0;
  async function worker() {
    while (i < arr.length) {
      const idx = i++;
      out[idx] = await fn(arr[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return out;
}

// ── Main ───────────────────────────────────────────────────────────────────
console.log('▶ Fetching JLPT kanji lists…');
const jlptLists = {};
for (const n of [5, 4, 3, 2, 1]) {
  jlptLists[n] = await getJLPTList(n);
  console.log(`  N${n}: ${jlptLists[n].length} kanji`);
}

// Map each kanji → JLPT level (lower-num levels win for duplicates? in practice kanjiapi has no overlap)
const kanjiLevel = new Map();
for (const n of [5, 4, 3, 2, 1]) {
  for (const c of jlptLists[n]) if (!kanjiLevel.has(c)) kanjiLevel.set(c, n);
}
const allKanji = [...kanjiLevel.keys()];
console.log(`▶ Total kanji: ${allKanji.length}`);

// Allowed-kanji sets (for N5/N4/N3 guard: all kanji in compound must be ≤ same level)
function buildAllowedKanjiSet(jlptNum) {
  if (jlptNum <= 2) return null;
  const allowed = new Set();
  for (const [c, lvl] of kanjiLevel.entries()) if (lvl >= jlptNum) allowed.add(c);
  return allowed;
}
const allowedSets = { 5: buildAllowedKanjiSet(5), 4: buildAllowedKanjiSet(4), 3: buildAllowedKanjiSet(3) };

function allKanjiAllowed(word, allowedSet) {
  if (!allowedSet) return true;
  for (const ch of word) {
    if ((ch >= '\u4E00' && ch <= '\u9FFF') || (ch >= '\u3400' && ch <= '\u4DBF')) {
      if (!allowedSet.has(ch)) return false;
    }
  }
  return true;
}

console.log('▶ Fetching words for each kanji (concurrency=8)…');
let fetched = 0;
const allEntries = await mapLimit(allKanji, 8, async (char) => {
  const w = await getWords(char);
  fetched++;
  if (fetched % 100 === 0) console.log(`  ${fetched}/${allKanji.length}`);
  return { char, words: w };
});

console.log('▶ Scoring + dedup…');
const seen = new Map(); // word → { score, level, ... }

for (const { char, words } of allEntries) {
  const jlptNum = kanjiLevel.get(char);
  const allowedSet = allowedSets[jlptNum] ?? null;

  for (const entry of words) {
    if (isProperNoun(entry)) continue;

    const canonical =
      (entry.variants || []).find(v =>
        v.written && !isAllKatakana(v.written) &&
        (v.priorities || []).some(p => TOP_TAGS.includes(p))
      ) ||
      (entry.variants || []).find(v => v.written && !isAllKatakana(v.written));

    if (!canonical) continue;
    if (!canonical.written.includes(char)) continue;
    if (hasNoKanji(canonical.written)) continue;
    if (kanjiCount(canonical.written) > maxKanjiForLevel(jlptNum)) continue;
    if (!allKanjiAllowed(canonical.written, allowedSet)) continue;

    const varPriorities = canonical.priorities || [];
    if (!varPriorities.some(p => TOP_TAGS.includes(p))) continue;

    const baseScore = priorityScore(varPriorities);
    if (baseScore <= 0) continue;

    const wordKey = canonical.written;
    const freqRank = FREQ[wordKey] ?? 99999;
    if (freqRank > FREQ_CUTOFF[jlptNum]) continue;

    const freqBonus = jlptNum >= 4
      ? Math.max(0, 2000 - freqRank * 2)
      : Math.max(0, 600 - freqRank);
    const score = baseScore + freqBonus;

    const reading = (canonical.pronounced && canonical.pronounced !== canonical.written)
      ? canonical.pronounced : '';
    const meaning = entry.meanings?.[0]?.glosses?.slice(0, 3).join(', ') || '';

    // Keep the entry where the word reaches the *easiest* JLPT level (highest jlptNum)
    // and the highest score. This avoids losing N5 words because they were
    // also found via an N1 kanji.
    const prev = seen.get(wordKey);
    if (!prev || jlptNum > prev.jlptNum || (jlptNum === prev.jlptNum && score > prev.score)) {
      seen.set(wordKey, {
        word: wordKey,
        reading,
        meaning,
        jlptNum,
        level: LEVEL_LABEL[jlptNum],
        freqRank,
        score,
      });
    }
  }
}

const out = [...seen.values()].sort((a, b) => b.score - a.score);

fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 0));
console.log(`✓ Wrote ${out.length} entries to ${path.relative(ROOT, OUT_FILE)}`);

// ── Recap stats ────────────────────────────────────────────────────────────
const byLevel = { N5: 0, N4: 0, N3: 0, N2: 0, N1: 0 };
for (const x of out) byLevel[x.level]++;
const withFreq = out.filter(x => x.freqRank < 99999).length;

console.log('\n── Recap ───────────────────────────────────────');
console.log(`Total mots uniques        : ${out.length}`);
console.log('Par niveau JLPT :');
for (const k of ['N5', 'N4', 'N3', 'N2', 'N1']) console.log(`  ${k} : ${byLevel[k]}`);
console.log(`Avec rang fréquence connu : ${withFreq} (${((withFreq / out.length) * 100).toFixed(1)}%)`);
console.log('\nTop 20 mots par score :');
for (const x of out.slice(0, 20)) {
  console.log(`  ${x.score.toString().padStart(5)}  ${x.level}  ${x.word.padEnd(8)}  ${x.reading.padEnd(10)}  ${x.meaning}`);
}
