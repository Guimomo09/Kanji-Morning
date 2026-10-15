#!/usr/bin/env node
/**
 * verify-against-jisho.mjs
 *
 * Cross-checks our kanji/vocab meanings against Jisho's public API
 * (jisho.org/api/v1/search/words, backed by JMdict — a well-established
 * reference). Flags entries where NONE of Jisho's English definitions share
 * a common keyword with our stored meaning, as a lead for manual review —
 * this is a word-overlap heuristic, not a guarantee of correctness, so
 * flagged entries still need a human (ideally a Japanese speaker) to confirm
 * before anything is changed. Nothing is auto-fixed; this only reports.
 *
 * Sources checked (word lists are NOT modified, only meanings compared):
 *   1. public/kanji_index.json       — kanji shown in the app (field `m`)
 *   2. src/kanji.js EXAMPLE_OVERRIDE  — vocab words shown in the app (field `m`)
 *   3. scripts/vocab-db.json          — broader vocab DB used for reel/sentence
 *                                        generation (field `meaning`)
 *
 * Usage:
 *   node scripts/verify-against-jisho.mjs --source kanji   # kanji_index.json only
 *   node scripts/verify-against-jisho.mjs --source app     # EXAMPLE_OVERRIDE only
 *   node scripts/verify-against-jisho.mjs --source db      # vocab-db.json only
 *   node scripts/verify-against-jisho.mjs --source all     # all three (default)
 *   node scripts/verify-against-jisho.mjs --limit 50        # cap entries (testing)
 *   node scripts/verify-against-jisho.mjs --resume          # skip entries already
 *                                                              in the output report
 *
 * Output: scripts/jisho-verify-report.json (full machine-readable results)
 *         + a plain-text summary printed to stdout.
 *
 * Rate limiting: one request at a time, 250ms between requests (jisho.org has
 * no published public rate limit, but this is a shared free service — stay
 * polite). At ~4 req/s that's roughly:
 *   kanji (2211) ~9min, app vocab (1834) ~8min, vocab-db (4522) ~19min.
 * Safe to Ctrl+C and resume later with --resume (keeps prior results).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORT_PATH = join(__dirname, 'jisho-verify-report.json');

const args = process.argv.slice(2);
const get = (f, d) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : d; };
const SOURCE = get('--source', 'all');
const LIMIT = get('--limit', null) ? parseInt(get('--limit', '0'), 10) : null;
const RESUME = args.includes('--resume');

// ── Load our data ───────────────────────────────────────────────────────────
function loadEntries() {
  const entries = [];

  if (SOURCE === 'kanji' || SOURCE === 'all') {
    const idx = JSON.parse(readFileSync(join(ROOT, 'public', 'kanji_index.json'), 'utf8'));
    for (const [char, data] of Object.entries(idx)) {
      entries.push({ source: 'kanji_index', key: char, query: char, ourMeaning: data.m || '' });
    }
  }

  if (SOURCE === 'app' || SOURCE === 'all') {
    const kanjiJs = readFileSync(join(ROOT, 'src', 'kanji.js'), 'utf8');
    const start = kanjiJs.indexOf('const EXAMPLE_OVERRIDE = {');
    const braceStart = kanjiJs.indexOf('{', start);
    let depth = 0, end = braceStart;
    for (let i = braceStart; i < kanjiJs.length; i++) {
      if (kanjiJs[i] === '{') depth++;
      else if (kanjiJs[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    const objLiteral = kanjiJs.slice(braceStart, end);
    // eslint-disable-next-line no-new-func
    const EXAMPLE_OVERRIDE = Function(`"use strict"; return (${objLiteral});`)();
    for (const [kanjiChar, words] of Object.entries(EXAMPLE_OVERRIDE)) {
      for (const w of words) {
        entries.push({ source: 'app_vocab', key: `${kanjiChar}:${w.w}`, query: w.w, ourMeaning: w.m || '', reading: w.r });
      }
    }
  }

  if (SOURCE === 'db' || SOURCE === 'all') {
    const db = JSON.parse(readFileSync(join(ROOT, 'scripts', 'vocab-db.json'), 'utf8'));
    for (const w of db) {
      entries.push({ source: 'vocab_db', key: w.word, query: w.word, ourMeaning: w.meaning || '', reading: w.reading });
    }
  }

  return entries;
}

// ── Jisho API ────────────────────────────────────────────────────────────────
async function jishoLookup(query) {
  const url = `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'asanokanji-verify-script/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.data || [];
}

// Pick the Jisho entry whose japanese[].word exactly matches our query first;
// fall back to the top result otherwise.
function pickBestMatch(results, query) {
  const exact = results.find(r => (r.japanese || []).some(j => j.word === query));
  return exact || results[0] || null;
}

function allDefinitions(entry) {
  if (!entry) return [];
  return (entry.senses || []).flatMap(s => s.english_definitions || []);
}

// ── Overlap heuristic ────────────────────────────────────────────────────────
// This is intentionally loose — the goal is to flag only entries with NO
// plausible connection to any Jisho definition, not to nitpick wording.
// A small synonym map absorbs the most common "same concept, different word"
// gaps (center/middle, mean/meaning, etc.) that a pure stem-match would miss.
const STOPWORDS = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'or', 'and', 'is', 'be', 'as', 'by', 'etc', 'with', 'e', 'g']);
const SYNONYMS = {
  center: ['middle', 'centre', 'central'],
  mean: ['meaning', 'signify', 'indicate'],
  big: ['large', 'great'],
  small: ['little', 'tiny'],
  kid: ['child', 'children'],
  begin: ['start', 'commence'],
  end: ['finish', 'conclude', 'stop'],
  talk: ['speak', 'say', 'tell'],
  look: ['see', 'watch', 'view'],
  buy: ['purchase'],
  give: ['grant', 'provide'],
  get: ['obtain', 'receive', 'acquire'],
  make: ['create', 'produce'],
  go: ['leave', 'depart'],
  come: ['arrive'],
  good: ['nice', 'fine', 'well'],
  bad: ['poor', 'wrong'],
  money: ['cash', 'currency', 'coin', 'yen'],
  water: ['liquid'],
  fire: ['flame', 'blaze'],
  person: ['people', 'human', 'individual'],
  day: ['date'],
  month: ['moon'],
  year: ['age'],
};
function expand(word) {
  const out = new Set([word]);
  if (SYNONYMS[word]) for (const s of SYNONYMS[word]) out.add(s);
  for (const [base, syns] of Object.entries(SYNONYMS)) {
    if (syns.includes(word)) { out.add(base); for (const s of syns) out.add(s); }
  }
  return out;
}
function keywords(text) {
  return new Set(
    String(text)
      .toLowerCase()
      .replace(/[().,;:]/g, ' ')
      .split(/[\s/]+/)
      .map(w => w.trim())
      .filter(w => w.length > 1 && !STOPWORDS.has(w))
  );
}

function hasOverlap(ourMeaning, jishoDefs) {
  const ours = keywords(ourMeaning);
  if (ours.size === 0) return true; // nothing to compare, don't flag
  for (const def of jishoDefs) {
    const defWords = keywords(def);
    for (const w of ours) {
      const candidates = expand(w);
      for (const c of candidates) {
        if (defWords.has(c)) return true;
      }
      // loose stem match (e.g. "listen" vs "listening")
      for (const dw of defWords) {
        if (dw.length > 3 && w.length > 3 && (dw.startsWith(w) || w.startsWith(dw))) return true;
      }
    }
  }
  return false;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  let entries = loadEntries();
  if (LIMIT) entries = entries.slice(0, LIMIT);

  let prior = { results: [], checkedKeys: [] };
  if (RESUME && existsSync(REPORT_PATH)) {
    prior = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
  }
  const checkedKeys = new Set(prior.checkedKeys || []);
  const results = prior.results || [];

  const todo = entries.filter(e => !checkedKeys.has(`${e.source}:${e.key}`));
  console.log(`\n🔎 Verifying ${todo.length}/${entries.length} entries against Jisho (source=${SOURCE})${RESUME ? ' [resuming]' : ''}\n`);

  let okCount = 0, flagCount = 0, errCount = 0;
  const startTime = Date.now();

  for (let i = 0; i < todo.length; i++) {
    const e = todo[i];
    try {
      const jishoResults = await jishoLookup(e.query);
      const match = pickBestMatch(jishoResults, e.query);
      const defs = allDefinitions(match);
      const overlap = defs.length === 0 ? null : hasOverlap(e.ourMeaning, defs);

      const record = {
        source: e.source,
        key: e.key,
        query: e.query,
        ourMeaning: e.ourMeaning,
        jishoFound: !!match,
        jishoDefinitions: defs.slice(0, 6),
        overlap, // true = at least one shared keyword, false = flagged, null = no jisho data
      };
      results.push(record);
      checkedKeys.add(`${e.source}:${e.key}`);

      if (overlap === false) flagCount++;
      else okCount++;
    } catch (err) {
      results.push({ source: e.source, key: e.key, query: e.query, ourMeaning: e.ourMeaning, error: err.message });
      checkedKeys.add(`${e.source}:${e.key}`);
      errCount++;
    }

    if ((i + 1) % 50 === 0 || i === todo.length - 1) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      process.stdout.write(`\r  ${i + 1}/${todo.length} checked (${elapsed}s) — ok:${okCount} flagged:${flagCount} err:${errCount}   `);
      // Checkpoint to disk periodically so --resume has something after Ctrl+C
      writeFileSync(REPORT_PATH, JSON.stringify({ results, checkedKeys: [...checkedKeys] }, null, 2));
    }

    await new Promise(r => setTimeout(r, 250));
  }

  writeFileSync(REPORT_PATH, JSON.stringify({ results, checkedKeys: [...checkedKeys] }, null, 2));

  console.log(`\n\n✅ Done. Report saved to ${REPORT_PATH}`);
  const flagged = results.filter(r => r.overlap === false);
  const errors = results.filter(r => r.error);
  const notFound = results.filter(r => r.jishoFound === false);
  console.log(`\nTotal checked: ${results.length}`);
  console.log(`Flagged (no keyword overlap — needs human review): ${flagged.length}`);
  console.log(`Not found on Jisho: ${notFound.length}`);
  console.log(`Errors: ${errors.length}`);

  if (flagged.length) {
    console.log(`\n⚠  Flagged entries (first 40 shown, full list in report JSON):`);
    for (const f of flagged.slice(0, 40)) {
      console.log(`   [${f.source}] ${f.key} — ours: "${f.ourMeaning}" | jisho: ${JSON.stringify(f.jishoDefinitions)}`);
    }
  }
}

main();
