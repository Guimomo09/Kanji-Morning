#!/usr/bin/env node
// Build complete vocab database + pre-generate Tatoeba sentences for top N words.
//
// Outputs:
//   - scripts/vocab-db.json       : all words with corrected meanings (pickBestGloss)
//   - public/sentences.json       : pre-fetched Tatoeba sentences for top N
//   - scripts/vocab-audit.txt     : top 200 for manual QA
//
// Usage: node scripts/build-vocab-database.mjs [--fetch-sentences] [--top N]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(__dirname, '.cache-words');
const OUT_DB    = path.join(__dirname, 'vocab-db.json');
const OUT_SENT  = path.join(ROOT, 'public', 'sentences.json');
const OUT_AUDIT = path.join(__dirname, 'vocab-audit.txt');

fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'public'), { recursive: true });

// ── CLI args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const FETCH_SENTENCES = args.includes('--fetch-sentences');
const TOP_N = parseInt(args.find(a => a.startsWith('--top='))?.split('=')[1] || '1000', 10);

// ── Constants (mirror src/config.js + src/vocab.js) ───────────────────────
const LEVEL_LABEL = { 5: 'N5', 4: 'N4', 3: 'N3', 2: 'N2', 1: 'N1' };
const FREQ_CUTOFF = { 5: 2500, 4: 4500, 3: 9000, 2: 15000, 1: 20000 };
const TOP_TAGS    = ['news1', 'ichi1', 'spec1', 'nf01', 'nf02', 'nf03', 'nf04', 'nf05', 'nf06'];

// Load FREQ corpus
const { FREQ } = await import(path.join(ROOT, 'src/freq.js'));

// ── Helpers (from src/vocab.js + src/utils.js) ────────────────────────────
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

// ── Meaning quality (from src/utils.js) ───────────────────────────────────
const RARE_RE = /\b(archaism|archaic|obsolete|rare|dated|poetic|vulgar|derogatory|slang|colloquial|euphemism|honorific|humble|polite|familiar|childish|female|male|baseball|cards|mahjong|shogi|go\b|sumo|chess|cricket|poker|trump|fishing|card game|nautical|heraldry|anatomy|botany|zoology|chemistry|physics|mathematics|geometry|algebra|computing|programming|law|legal|judicial|military|ecclesiastical|biblical|mythology|astrology|dialectal|regional)/i;
const COUNTER_RE = /^counter for\b/i;
const POS_DEPRIORITIZE_RE = /counter|numeric.?classifier|suffix|prefix|particle|auxiliary/i;
const NONDAILY_RE = /\b(buddha|goddess?|deity|shrine|temple|nobleman|noble|aristocrat|feudal|imperial|shogun|emperor|empress|consort|prince|princess|monk|priest|nun|clan|warlord|samurai|vassal|regent|dynasty|epoch|era\b|period\b|reign|manor|castle|artifact|relic|scripture|sutra|incense|ritual|ceremony|divinity|divination|oracle|omen|ancestral|pilgrimage|cerebrum|cerebellum|cortex|neuron|artery|vein|tendon|ligament|vertebra|pelvis|thorax|femur|tibia|fibula|humerus|radius|ulna|clavicle|scapula|cranium|mandible|phalanx|battalion|regiment|platoon|squadron|garrison|artillery|infantry|cavalry|grenade|torpedo|mortar|barracks|ordnance|munition|troop|brigade|company\b.*soldier|battery\b.*military|messrs|addressee|salutation|preamble|foreword|preface|postscript|appendix|errata|treatise|dissertation|monograph|on base|times on base|batting|fielding|pitcher|catcher|inning|strikeout|homerun|shortstop|outfield|infield|distribution of electricity|electric.?power.?distribution|high.?voltage|low.?voltage|transformer\b|substation|switchboard)\b/i;

function meaningScore(m) {
  const text = (m.glosses || []).join(' ');
  const pos  = (m.part_of_speech || []).join(' ');
  let score  = 0;
  if (RARE_RE.test(text))           score += 20;
  if (NONDAILY_RE.test(text))       score += 15;
  if (COUNTER_RE.test(text))        score += 25;
  if (POS_DEPRIORITIZE_RE.test(pos)) score += 20;
  return score;
}
function sortMeanings(meanings) {
  if (!meanings || meanings.length <= 1) return meanings || [];
  return [...meanings].sort((a, b) => meaningScore(a) - meaningScore(b));
}
const GLOSS_SKIP_RE = /^\((french|german|english|dutch|portuguese|chinese|korean|approx|abbr|uk|us|lit|fig|also|esp|orig|hist|obs|arch)\)/i;
const GLOSS_RARE_RE = /\b(monarchy|empire|dynasty|shogunate|anniversary|feudal|imperial|shogun|archaic|obsolete|rare|dated|poetic|biblical|mythology|ecclesiastical|heraldry|nautical|mahjong|shogi|sumo|cricket|poker|chess)\b/i;

function pickBestGloss(meanings) {
  if (!meanings?.length) return null;
  const sorted = sortMeanings(meanings);
  for (const m of sorted) {
    if (COUNTER_RE.test((m.glosses || []).join(' '))) continue;
    for (const g of (m.glosses || [])) {
      if (!GLOSS_SKIP_RE.test(g) && !GLOSS_RARE_RE.test(g) && !NONDAILY_RE.test(g) && g.length >= 3) return { gloss: g, meaning: m };
    }
  }
  for (const m of sorted) {
    if (COUNTER_RE.test((m.glosses || []).join(' '))) continue;
    for (const g of (m.glosses || [])) {
      if (!GLOSS_SKIP_RE.test(g) && !GLOSS_RARE_RE.test(g) && g.length >= 3) return { gloss: g, meaning: m };
    }
  }
  for (const m of sorted) {
    for (const g of (m.glosses || [])) {
      if (!GLOSS_SKIP_RE.test(g) && g.length >= 3) return { gloss: g, meaning: m };
    }
  }
  const g = sorted[0]?.glosses?.[0];
  return g ? { gloss: g, meaning: sorted[0] } : null;
}

// ── Fetch API (with disk cache) ───────────────────────────────────────────
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

// ── Tatoeba sentence search (mirrors webhook/server.js) ───────────────────
async function searchTatoeba(query) {
  try {
    const url = `https://tatoeba.org/en/api_v0/search?query=${encodeURIComponent(query)}&from=jpn&to=eng&limit=20`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    for (const r of (data.results || [])) {
      if (r.text?.includes(query) && r.translations?.[0]?.[0]?.text) {
        return { jp: r.text.trim(), en: r.translations[0][0].text.trim() };
      }
    }
  } catch {}
  return null;
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
console.log('▶ Step 1/4 — Fetching JLPT kanji lists…');
const jlptLists = {};
for (const n of [5, 4, 3, 2, 1]) {
  jlptLists[n] = await getJLPTList(n);
  console.log(`  N${n}: ${jlptLists[n].length} kanji`);
}

const kanjiLevel = new Map();
for (const n of [5, 4, 3, 2, 1]) {
  for (const c of jlptLists[n]) if (!kanjiLevel.has(c)) kanjiLevel.set(c, n);
}
const allKanji = [...kanjiLevel.keys()];
console.log(`  Total kanji: ${allKanji.length}`);

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

console.log('▶ Step 2/4 — Fetching words for each kanji (concurrency=8)…');
let fetched = 0;
const allEntries = await mapLimit(allKanji, 8, async (char) => {
  const w = await getWords(char);
  fetched++;
  if (fetched % 100 === 0) console.log(`  ${fetched}/${allKanji.length}`);
  return { char, words: w };
});

console.log('▶ Step 3/4 — Scoring + dedup + cleaning meanings…');
const seen = new Map();

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

    // FIX obs #1: Allow hiragana-only words if they have high priority score
    const isHiraganaOnly = hasNoKanji(canonical.written);
    if (isHiraganaOnly) {
      // Only accept if priority score is very high (news1/ichi1/spec1 → 100+)
      const baseScore = priorityScore(canonical.priorities || []);
      if (baseScore < 100) continue; // Skip low-priority hiragana words
    } else {
      // Regular kanji-containing word filters
      if (kanjiCount(canonical.written) > maxKanjiForLevel(jlptNum)) continue;
      if (!allKanjiAllowed(canonical.written, allowedSet)) continue;
    }

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

    // FIX obs #2: Use pickBestGloss for higher-quality meanings
    const best = pickBestGloss(entry.meanings || []);
    const meaning = best ? best.gloss : (entry.meanings?.[0]?.glosses?.[0] || '');
    const pos = best?.meaning?.part_of_speech?.slice(0, 2).join(', ') || '';

    const prev = seen.get(wordKey);
    if (!prev || jlptNum > prev.jlptNum || (jlptNum === prev.jlptNum && score > prev.score)) {
      seen.set(wordKey, {
        word: wordKey,
        reading,
        meaning,
        pos,
        jlptNum,
        level: LEVEL_LABEL[jlptNum],
        freqRank,
        score,
      });
    }
  }
}

const allWords = [...seen.values()].sort((a, b) => b.score - a.score);
fs.writeFileSync(OUT_DB, JSON.stringify(allWords, null, 0));
console.log(`✓ Wrote ${allWords.length} entries to ${path.relative(ROOT, OUT_DB)}`);

// ── Stats ──────────────────────────────────────────────────────────────────
const byLevel = { N5: 0, N4: 0, N3: 0, N2: 0, N1: 0 };
for (const x of allWords) byLevel[x.level]++;
const withFreq = allWords.filter(x => x.freqRank < 99999).length;

console.log('\n── Recap (vocab-db.json) ───────────────────────');
console.log(`Total mots uniques        : ${allWords.length}`);
console.log('Par niveau JLPT :');
for (const k of ['N5', 'N4', 'N3', 'N2', 'N1']) console.log(`  ${k} : ${byLevel[k]}`);
console.log(`Avec rang fréquence connu : ${withFreq} (${((withFreq / allWords.length) * 100).toFixed(1)}%)`);

// ── FIX obs #3: Pre-generate sentences for top N words ────────────────────
if (FETCH_SENTENCES) {
  console.log(`\n▶ Step 4/4 — Fetching Tatoeba sentences for top ${TOP_N} words…`);
  console.log('  (Rate: 1 req/sec — this will take ~', Math.ceil(TOP_N / 60), 'min)');
  
  const topWords = allWords.slice(0, TOP_N);
  const sentences = {};
  let found = 0;

  for (let i = 0; i < topWords.length; i++) {
    const w = topWords[i];
    const byKanji = await searchTatoeba(w.word);
    if (byKanji) {
      sentences[w.word] = byKanji;
      found++;
    } else if (w.reading && w.reading !== w.word) {
      const byReading = await searchTatoeba(w.reading);
      if (byReading) {
        sentences[w.word] = byReading;
        found++;
      }
    }
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${TOP_N} — ${found} sentences found`);
    await new Promise(r => setTimeout(r, 1100)); // 1 req/sec rate limit
  }

  fs.writeFileSync(OUT_SENT, JSON.stringify(sentences, null, 0));
  console.log(`✓ Wrote ${Object.keys(sentences).length} sentences to ${path.relative(ROOT, OUT_SENT)}`);
  console.log(`  Coverage: ${((found / TOP_N) * 100).toFixed(1)}%`);
} else {
  console.log('\n▶ Step 4/4 — Skipped (use --fetch-sentences to pre-generate Tatoeba phrases)');
}

// ── Audit file (top 200 for manual QA) ────────────────────────────────────
const auditLines = ['=== Top 200 mots par score (QA manuel) ===\n'];
for (const x of allWords.slice(0, 200)) {
  auditLines.push(`${x.score.toString().padStart(5)}  ${x.level}  ${x.word.padEnd(10)}  ${x.reading.padEnd(12)}  ${x.meaning}`);
}
fs.writeFileSync(OUT_AUDIT, auditLines.join('\n'));
console.log(`✓ Wrote audit file: ${path.relative(ROOT, OUT_AUDIT)}`);

console.log('\n✅ Done. Next steps:');
console.log('   1. Review scripts/vocab-audit.txt for meaning quality');
console.log('   2. Run with --fetch-sentences to build public/sentences.json');
console.log('   3. Update src/vocab.js to load from public/vocab-db.json (optional preload optimization)');
