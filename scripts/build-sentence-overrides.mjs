/**
 * build-sentence-overrides.mjs
 * Harvests 2 Tatoeba sentences per JLPT kanji that lacks SENTENCE_OVERRIDE.
 * Writes results to scripts/generated-sentences.json for review + injection.
 *
 * Usage:
 *   node scripts/build-sentence-overrides.mjs [--level=n4] [--level=n3] ...
 *   node scripts/build-sentence-overrides.mjs  (default: all N4–N1)
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Load overrides from src/kanji.js ─────────────────────────────────────────
const kjText = readFileSync(join(ROOT, 'src', 'kanji.js'), 'utf8');
function loadObj(varName) {
  const marker = `${varName} = {`;
  const start = kjText.indexOf(marker);
  if (start === -1) return {};
  let depth = 0, i = start + marker.length - 1;
  while (i < kjText.length) {
    if (kjText[i] === '{') depth++;
    else if (kjText[i] === '}') { depth--; if (depth === 0) break; }
    i++;
  }
  return new Function(`"use strict"; return (${kjText.slice(start + marker.length - 1, i + 1)})`)();
}
const EXAMPLE_OVERRIDE  = loadObj('EXAMPLE_OVERRIDE');
const SENTENCE_OVERRIDE = loadObj('SENTENCE_OVERRIDE');

// ── Config ────────────────────────────────────────────────────────────────────
const MAX_LEN = { 5: 35, 4: 50, 3: 65, 2: 80, 1: 100 };
const DELAY_MS = 180; // ms between Tatoeba requests — be polite
const GLOSS_SKIP = /^(?:\w{2,3}:|\(|\[|to be |see )/i;

// Which levels to process
const args = process.argv.slice(2);
const requestedLevels = args
  .filter(a => a.startsWith('--level'))
  .map(a => parseInt(a.replace(/[^0-9]/g, '')));
const LEVELS = requestedLevels.length ? requestedLevels : [4, 3, 2, 1];

// ── Fetch JLPT lists ──────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchJLPT(n) {
  const r = await fetch(`https://kanjiapi.dev/v1/kanji/jlpt-${n}`);
  return r.ok ? r.json() : [];
}

// ── Get vocab pool for a kanji ────────────────────────────────────────────────
async function getVocabWords(kanji) {
  // Priority: EXAMPLE_OVERRIDE
  const words = (EXAMPLE_OVERRIDE[kanji] || []).slice(0, 5).map(w => w.w);
  if (words.length < 5) {
    try {
      const r = await fetch(`https://kanjiapi.dev/v1/words/${encodeURIComponent(kanji)}`);
      if (r.ok) {
        const entries = await r.json();
        const apiWords = [];
        for (const e of entries) {
          const v = (e.variants ?? []).find(v => v.written?.includes(kanji));
          if (!v?.written) continue;
          // Skip pure-kana forms
          if (/^[\u3040-\u309F\u30A0-\u30FF]+$/.test(v.written)) continue;
          if (!words.includes(v.written) && !apiWords.includes(v.written)) {
            let gloss = null;
            for (const m of (e.meanings ?? [])) {
              for (const g of (m.glosses ?? [])) {
                if (!GLOSS_SKIP.test(g)) { gloss = g; break; }
              }
              if (gloss) break;
            }
            if (gloss) apiWords.push(v.written);
          }
          if (apiWords.length >= 8) break;
        }
        words.push(...apiWords.slice(0, 8 - words.length));
      }
    } catch {}
  }
  // Bare kanji as last resort
  if (!words.includes(kanji)) words.push(kanji);
  return words;
}

// ── Fetch sentences from Tatoeba ──────────────────────────────────────────────
// Returns array of {jp, en} pairs — up to `need` items
async function fetchTatoeba(query, maxLen, kanji, need = 2) {
  await sleep(DELAY_MS);
  try {
    const url = `https://tatoeba.org/api_v0/search?query=${encodeURIComponent(query)}&from=jpn&to=eng&limit=100&sort=relevance`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return [];
    const d = await r.json();
    const results = [];
    for (const s of (d.results || [])) {
      const jp = s.text?.trim();
      const en = s.translations?.[0]?.[0]?.text?.trim();
      if (!jp || !en) continue;
      if (jp.length > maxLen) continue;
      if (jp.replace(/[。！？\s、]/g, '').length < 8) continue;
      if (!jp.includes(query) && !jp.includes(kanji)) continue;
      results.push({ jp, en });
      if (results.length >= need) break;
    }
    return results;
  } catch {
    return [];
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log('Fetching JLPT lists...');
const jlptLists = {};
for (const n of LEVELS) {
  jlptLists[n] = await fetchJLPT(n);
  console.log(`  N${n}: ${jlptLists[n].length} kanji`);
}

const output = {};   // kanji → [{jp, en}, {jp, en}]
const missing = [];  // kanji that got < 2 sentences

for (const n of LEVELS) {
  const kanjiList = jlptLists[n];
  const toProcess = kanjiList.filter(k => !SENTENCE_OVERRIDE[k]);
  const maxLen = MAX_LEN[n];

  console.log(`\n══ N${n} ══  ${toProcess.length} kanji to harvest (${kanjiList.length - toProcess.length} already have override)`);

  for (let i = 0; i < toProcess.length; i++) {
    const kanji = toProcess[i];
    const words = await getVocabWords(kanji);
    const seen = new Set();
    const collected = [];

    for (const word of words) {
      if (collected.length >= 2) break;
      const need = 2 - collected.length;
      const hits = await fetchTatoeba(word, maxLen, kanji, need + 2);
      for (const h of hits) {
        if (collected.length >= 2) break;
        if (!seen.has(h.jp)) {
          seen.add(h.jp);
          collected.push(h);
        }
      }
    }

    const status = collected.length >= 2 ? '✅' : collected.length === 1 ? '⚠️ ' : '❌';
    const pct = Math.round(((i + 1) / toProcess.length) * 100);
    process.stdout.write(`  [${pct}%] ${status} ${kanji} (${collected.length}/2)  \r`);

    if (collected.length > 0) {
      output[kanji] = collected;
    }
    if (collected.length < 2) {
      missing.push({ kanji, level: n, got: collected.length });
    }
  }
  console.log(''); // newline after progress bar
}

// ── Save output ───────────────────────────────────────────────────────────────
const outputPath = join(ROOT, 'scripts', 'generated-sentences.json');
writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');

const total = Object.keys(output).length;
console.log(`\n✅ Saved ${total} entries → scripts/generated-sentences.json`);

if (missing.length) {
  console.log(`\n⚠️  Incomplete (< 2 sentences):`);
  for (const { kanji, level, got } of missing) {
    console.log(`   N${level} ${kanji}: ${got}/2`);
  }
}

console.log('\nNext step:');
console.log('  node scripts/inject-sentences.mjs');
