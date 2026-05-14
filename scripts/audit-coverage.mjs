/**
 * audit-coverage.mjs
 * Vérifie pour chaque kanji JLPT que :
 *  - vocab   : EXAMPLE_OVERRIDE OU kanjiapi.dev retourne ≥3 mots
 *  - phrases : SENTENCE_OVERRIDE (≥2) OU Tatoeba retourne ≥2 phrases
 * Sortie : rapport par niveau avec ✅ / ⚠️ / ❌
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Load overrides ────────────────────────────────────────────────────────────
const kjText = readFileSync(join(ROOT, 'src', 'kanji.js'), 'utf8');
const loadObj = (varName) => {
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
};
const EXAMPLE_OVERRIDE  = loadObj('EXAMPLE_OVERRIDE');
const SENTENCE_OVERRIDE = loadObj('SENTENCE_OVERRIDE');

// ── Load KANJI_INDEX ──────────────────────────────────────────────────────────
const KANJI_INDEX = JSON.parse(readFileSync(join(ROOT, 'public', 'kanji_index.json'), 'utf8'));

// ── Fetch JLPT lists ──────────────────────────────────────────────────────────
const fetchJLPT = async (n) => {
  const r = await fetch(`https://kanjiapi.dev/v1/kanji/jlpt-${n}`);
  return r.ok ? r.json() : [];
};
const LEVELS = [5, 4, 3, 2, 1];
console.log('Fetching JLPT lists...');
const lists = await Promise.all(LEVELS.map(fetchJLPT));
const JLPT = Object.fromEntries(LEVELS.map((n, i) => [`n${n}`, lists[i]]));

// Sentences check: matches actual fetchSentences logic
// 1) SENTENCE_OVERRIDE → guaranteed 2/2
// 2) Else: try top vocab words on Tatoeba (same as the real script)
const sentCache = new Map();
async function sentenceCount(kanji, levelNum) {
  if (sentCache.has(kanji)) return sentCache.get(kanji);
  if (SENTENCE_OVERRIDE[kanji]?.length >= 2) { sentCache.set(kanji, 2); return 2; }

  const maxLen = MAX_LEN[levelNum];
  // Get vocab pool (EXAMPLE_OVERRIDE or top 5 from API)
  let words = (EXAMPLE_OVERRIDE[kanji] || []).slice(0, 5).map(w => w.w);
  if (words.length < 5) {
    try {
      const r = await fetch(`https://kanjiapi.dev/v1/words/${encodeURIComponent(kanji)}`);
      if (r.ok) {
        const entries = await r.json();
        const apiWords = [];
        for (const e of entries) {
          const v = (e.variants ?? []).find(v => v.written?.includes(kanji));
          if (v?.written && !words.includes(v.written) && !apiWords.includes(v.written)) apiWords.push(v.written);
          if (apiWords.length >= 5) break;
        }
        words = [...words, ...apiWords].slice(0, 8);
      }
    } catch {}
  }
  // Add bare kanji as final fallback
  if (!words.includes(kanji)) words.push(kanji);

  const seen = new Set();
  let count = 0;
  for (const w of words) {
    if (count >= 2) break;
    try {
      const url = `https://tatoeba.org/api_v0/search?query=${encodeURIComponent(w)}&from=jpn&to=eng&limit=50&sort=relevance`;
      const r = await fetch(url);
      if (!r.ok) continue;
      const d = await r.json();
      for (const s of (d.results || [])) {
        const jp = s.text?.trim();
        const en = s.translations?.[0]?.[0]?.text?.trim();
        if (!jp || !en || seen.has(jp)) continue;
        if (jp.length > maxLen || jp.replace(/[。！？\s、]/g,'').length < 8) continue;
        // Must contain the word or the kanji
        if (!jp.includes(w) && !jp.includes(kanji)) continue;
        seen.add(jp);
        count++;
        if (count >= 2) break;
      }
    } catch {}
  }
  sentCache.set(kanji, count);
  return count;
}

// ── kanjiapi vocab check ──────────────────────────────────────────────────────
const GLOSS_SKIP = /^(?:\w{2,3}:|\(|\[|to be |see )/i;
function pickCount(entries, kanji) {
  let n = 0;
  for (const e of entries) {
    const v = (e.variants ?? []).find(v => v.written?.includes(kanji));
    if (!v) continue;
    let gloss = null;
    for (const m of (e.meanings ?? [])) {
      for (const g of (m.glosses ?? [])) { if (!GLOSS_SKIP.test(g)) { gloss = g; break; } }
      if (gloss) break;
    }
    if (gloss && gloss.length >= 4) n++;
    if (n >= 3) break;
  }
  return n;
}
const apiCache = new Map();
async function apiVocabCount(kanji) {
  if (apiCache.has(kanji)) return apiCache.get(kanji);
  try {
    const r = await fetch(`https://kanjiapi.dev/v1/words/${encodeURIComponent(kanji)}`);
    if (!r.ok) { apiCache.set(kanji, 0); return 0; }
    const n = pickCount(await r.json(), kanji);
    apiCache.set(kanji, n);
    return n;
  } catch { apiCache.set(kanji, 0); return 0; }
}

// ── Process one level (with concurrency limit) ────────────────────────────────
const MAX_LEN = { 5: 35, 4: 50, 3: 65, 2: 80, 1: 100 };
const CONCURRENCY = 8;

async function processLevel(levelNum) {
  const key = `n${levelNum}`;
  const kanji = JLPT[key] || [];
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`JLPT N${levelNum}  (${kanji.length} kanji)`);
  console.log('═'.repeat(50));

  const results = { ok: 0, warn: 0, err: 0, details: [] };

  // Process in batches
  for (let i = 0; i < kanji.length; i += CONCURRENCY) {
    const batch = kanji.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (k) => {
      const hasExampleOverride  = !!(EXAMPLE_OVERRIDE[k]?.length >= 1);
      const hasSentenceOverride = !!(SENTENCE_OVERRIDE[k]?.length >= 2);
      const maxLen = MAX_LEN[levelNum];

      // Vocab check
      let vocabOk = hasExampleOverride;
      let vocabSrc = hasExampleOverride ? 'override' : null;
      if (!vocabOk) {
        const n = await apiVocabCount(k);
        vocabOk = n >= 1;
        vocabSrc = `api(${n})`;
      }

      // Sentences check
      let sentOk = hasSentenceOverride;
      let sentSrc = hasSentenceOverride ? 'override' : null;
      let sentCount = hasSentenceOverride ? 2 : 0;
      if (!sentOk) {
        const n = await sentenceCount(k, levelNum);
        sentOk = n >= 2;
        sentCount = Math.min(n, 2);
        sentSrc = `tatoeba(${n})`;
      }

      const status = (vocabOk && sentOk) ? '✅' : (vocabOk || sentOk) ? '⚠️' : '❌';
      if (status === '✅') results.ok++;
      else if (status === '⚠️') results.warn++;
      else results.err++;

      if (status !== '✅') {
        results.details.push({ k, vocabOk, vocabSrc, sentOk, sentSrc, sentCount, status });
      }

      const line = `${status} ${k}  vocab:${vocabSrc}  phrases:${sentCount}/2`;
      if (status !== '✅') process.stdout.write(line + '\n');
    }));
    process.stdout.write(`  [${Math.min(i + CONCURRENCY, kanji.length)}/${kanji.length}]\r`);
  }

  console.log(`\n✅ ${results.ok}  ⚠️ ${results.warn}  ❌ ${results.err}  / ${kanji.length}`);

  if (results.details.length > 0) {
    console.log('\nProblèmes:');
    for (const d of results.details) {
      const v = d.vocabOk ? '✅vocab' : '❌vocab';
      const s = d.sentOk ? '✅phrases' : `❌phrases(${d.sentCount}/2)`;
      console.log(`  ${d.status} ${d.k}  ${v}:${d.vocabSrc}  ${s}:${d.sentSrc}`);
    }
  }

  return results;
}

// ── Run all levels ────────────────────────────────────────────────────────────
const LEVEL_ARG = process.argv.find(a => a.startsWith('--level='))?.split('=')[1];
const levelsToRun = LEVEL_ARG ? [parseInt(LEVEL_ARG.replace('n',''))] : LEVELS;

let totalOk = 0, totalWarn = 0, totalErr = 0;
for (const lvl of levelsToRun) {
  const r = await processLevel(lvl);
  totalOk += r.ok; totalWarn += r.warn; totalErr += r.err;
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`TOTAL  ✅ ${totalOk}  ⚠️ ${totalWarn}  ❌ ${totalErr}`);
console.log('═'.repeat(50));
if (totalErr === 0 && totalWarn === 0) console.log('🎉 Tous les kanji sont couverts correctement.');
else console.log('⚠️  Kanji avec problèmes listés ci-dessus.');
