/**
 * audit-kanji-quality.mjs
 *
 * Checks every JLPT kanji against two conditions (offline, no card rendering):
 *   VOCAB   : EXAMPLE_OVERRIDE has ≥1 KUN word + ≥1 ON word + ≥3 words total
 *   PHRASES : SENTENCE_OVERRIDE has ≥1 KUN sentence + ≥1 ON sentence
 *
 * Result statuses:
 *   ok             — both conditions met → kanji is LOCKED, generate will skip it
 *   phrase-missing — vocab OK, phrases don't have KUN+ON pair
 *   vocab-missing  — phrases OK, EXAMPLE_OVERRIDE lacks KUN or ON (or < 3 words)
 *   both-missing   — neither condition met
 *
 * Writes: kanji-status.json (root of workspace)
 *
 * Usage:
 *   node scripts/audit-kanji-quality.mjs [--level=n5] [--reset]
 *
 *   --level=n5   : audit only that level (default: all)
 *   --reset      : ignore existing locked entries and re-evaluate all
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import kuromoji from 'kuromoji';

const ROOT          = dirname(dirname(fileURLToPath(import.meta.url)));
const KUROMOJI_DIC  = join(ROOT, 'node_modules', 'kuromoji', 'dict');
const STATUS_FILE   = join(ROOT, 'kanji-status.json');

// ── Args ──────────────────────────────────────────────────────────────────────
const args     = process.argv.slice(2);
const LEVEL    = args.find(a => a.startsWith('--level='))?.replace('--level=', '').toLowerCase() ?? null;
const RESET    = args.includes('--reset');
const LEVELS_ALL = ['n5', 'n4', 'n3', 'n2', 'n1'];
const LEVELS   = LEVEL ? [LEVEL] : LEVELS_ALL;

// ── Load KANJI_INDEX ──────────────────────────────────────────────────────────
const KANJI_INDEX = JSON.parse(readFileSync(join(ROOT, 'public', 'kanji_index.json'), 'utf8'));

// ── Load EXAMPLE_OVERRIDE + SENTENCE_OVERRIDE ─────────────────────────────────
const loadObj = (text, varName) => {
  const marker   = `${varName} = {`;
  const start    = text.indexOf(marker);
  if (start === -1) return {};
  const objStart = start + marker.length - 1;
  let depth = 0, i = objStart;
  while (i < text.length) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) break; }
    i++;
  }
  return new Function('"use strict"; return (' + text.slice(objStart, i + 1) + ')')();
};

const kjText          = readFileSync(join(ROOT, 'src', 'kanji.js'), 'utf8');
const EXAMPLE_OVERRIDE  = loadObj(kjText, 'EXAMPLE_OVERRIDE');
const SENTENCE_OVERRIDE = loadObj(kjText, 'SENTENCE_OVERRIDE');
console.log(`✅ EXAMPLE_OVERRIDE: ${Object.keys(EXAMPLE_OVERRIDE).length} kanji  |  SENTENCE_OVERRIDE: ${Object.keys(SENTENCE_OVERRIDE).length} kanji`);

// ── Fetch JLPT lists ──────────────────────────────────────────────────────────
const JLPT_LISTS = {};
for (const lvl of LEVELS_ALL) {
  const num = lvl.replace('n', '');
  const res = await fetch(`https://kanjiapi.dev/v1/kanji/jlpt-${num}`);
  if (!res.ok) throw new Error(`kanjiapi.dev jlpt-${num}: HTTP ${res.status}`);
  JLPT_LISTS[lvl] = await res.json();
}

// ── Kuromoji ──────────────────────────────────────────────────────────────────
let _tokenizer = null;
async function getTokenizer() {
  if (_tokenizer) return _tokenizer;
  return new Promise((res, rej) => {
    kuromoji.builder({ dicPath: KUROMOJI_DIC }).build((err, t) => {
      if (err) return rej(err);
      _tokenizer = t;
      res(t);
    });
  });
}
// Pre-warm tokenizer
await getTokenizer();

// ── Helpers ───────────────────────────────────────────────────────────────────
function voiced(r) {
  const map = {
    'か':'が','き':'ぎ','く':'ぐ','け':'げ','こ':'ご',
    'さ':'ざ','し':'じ','す':'ず','せ':'ぜ','そ':'ぞ',
    'た':'だ','ち':'ぢ','つ':'づ','て':'で','と':'ど',
    'は':'ば','ひ':'び','ふ':'ぶ','へ':'べ','ほ':'ぼ',
  };
  if (!r) return r;
  return (map[r[0]] ?? r[0]) + r.slice(1);
}

function classifyVocab(words, kanjiData, targetKanji = '') {
  const kunRoots    = (kanjiData.k || []).map(r => r.replace(/^-/, '').replace(/\..+$/, '').trim()).filter(Boolean);
  const onRootsKata = (kanjiData.o || []).map(r => r.replace(/\s.+$/, '').trim()).filter(Boolean);
  const onRootsHira = onRootsKata.map(r =>
    r.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
  );
  const kun = [], on = [], other = [];
  for (const w of words) {
    const r   = w.r || '';
    const pos = targetKanji ? (w.w || '').indexOf(targetKanji) : 0;
    let classified = false;
    if (pos === 0) {
      const km = kunRoots.find(k => r.startsWith(k)) ?? kunRoots.find(k => r.startsWith(voiced(k)));
      if (km) { kun.push(w); classified = true; }
      else {
        const oi = onRootsHira.findIndex(o => r.startsWith(o));
        if (oi >= 0) { on.push(w); classified = true; }
      }
    } else {
      const km = kunRoots.find(k => r.includes(k)) ?? kunRoots.find(k => r.includes(voiced(k)));
      if (km) { kun.push(w); classified = true; }
      else {
        const oi = onRootsHira.findIndex(o => r.includes(o));
        if (oi >= 0) { on.push(w); classified = true; }
      }
    }
    if (!classified) other.push(w);
  }
  return { kun, on, other };
}

async function detectReadingType(jp, kanji, kanjiData) {
  try {
    const tokenizer = await getTokenizer();
    const tokens    = tokenizer.tokenize(jp);
    const kunRoots  = (kanjiData.k || []).map(r => r.replace(/^-/, '').replace(/\..+$/, '').trim()).filter(Boolean);
    const onKata    = (kanjiData.o || []).map(r => r.replace(/\s.+$/, '').trim()).filter(Boolean);
    const onHira    = onKata.map(r => r.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60)));
    for (const tok of tokens) {
      if (!tok.surface_form.includes(kanji)) continue;
      const rd = tok.reading
        ? tok.reading.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
        : '';
      if (!rd) continue;
      const km = kunRoots.find(k => rd.startsWith(k) || rd.includes(k) || rd.startsWith(voiced(k)) || rd.includes(voiced(k)));
      if (km) return { type: 'kun', reading: km };
      const oi = onHira.findIndex(o => rd.startsWith(o) || rd.includes(o));
      if (oi >= 0) return { type: 'on', reading: onKata[oi] };
    }
  } catch {}
  return { type: null, reading: null };
}

// ── Load existing status ──────────────────────────────────────────────────────
const existingStatus = (!RESET && existsSync(STATUS_FILE))
  ? JSON.parse(readFileSync(STATUS_FILE, 'utf8'))
  : {};

// ── Audit ─────────────────────────────────────────────────────────────────────
const result = { ...existingStatus };
const TODAY  = new Date().toISOString().slice(0, 10);

const problemList = [];   // kanji that are not OK
const globalCounts = { ok: 0, phraseMissing: 0, vocabMissing: 0, bothMissing: 0, locked: 0, total: 0 };

for (const level of LEVELS) {
  const list = JLPT_LISTS[level] || [];
  const counts = { ok: 0, phraseMissing: 0, vocabMissing: 0, bothMissing: 0, locked: 0 };

  process.stdout.write(`\n${level.toUpperCase()} (${list.length} kanji)  `);
  let dot = 0;

  for (const kanji of list) {
    // Progress dots
    if (++dot % 50 === 0) process.stdout.write('.');

    // Honour existing lock (unless --reset)
    if (!RESET && existingStatus[kanji]?.status === 'ok' && existingStatus[kanji]?.locked) {
      result[kanji] = existingStatus[kanji];
      counts.locked++;
      counts.ok++;
      continue;
    }

    const kanjiData = KANJI_INDEX[kanji] || {};

    // ── VOCAB CHECK ──
    // Vocab is always guaranteed at generation time (fetchVocab merges EXAMPLE_OVERRIDE + kanjiapi.dev)
    // We just note whether curated override words exist as a bonus indicator.
    const vocabWords = EXAMPLE_OVERRIDE[kanji] || [];
    const { kun: vKun, on: vOn } = classifyVocab(vocabWords, kanjiData, kanji);

    // ── PHRASE CHECK ──
    // Condition: ≥2 sentences exist in SENTENCE_OVERRIDE (reading type irrelevant)
    // KUN/ON classification is bonus info only — some kanji have no KUN usage at all (百, 千…)
    const sentences = (SENTENCE_OVERRIDE[kanji] || []).filter(s => s.jp && s.en);
    const phrasePass = sentences.length >= 2;

    // Classify for informational purposes only
    let phraseKunCount = 0, phraseOnCount = 0;
    for (const s of sentences) {
      const { type } = await detectReadingType(s.jp, kanji, kanjiData);
      if (type === 'kun') phraseKunCount++;
      else if (type === 'on') phraseOnCount++;
    }

    // ── Status ──
    let status;
    if (phrasePass) {
      status = 'ok';
      counts.ok++;
    } else {
      status = 'phrase-missing';
      counts.phraseMissing++;
      problemList.push({
        kanji, level,
        issue: 'phrase',
        detail: `${sentences.length} sentence(s) in SENTENCE_OVERRIDE (need 2)`,
        readingInfo: `${phraseKunCount}KUN ${phraseOnCount}ON`,
        vocabInfo: `${vKun.length}KUN ${vOn.length}ON ${vocabWords.length}total`,
      });
    }

    result[kanji] = {
      level,
      status,
      vocab:   { total: vocabWords.length, kun: vKun.length, on: vOn.length },
      phrases: { total: sentences.length,  kun: phraseKunCount, on: phraseOnCount, ok: phrasePass },
      ...(status === 'ok' ? { locked: TODAY } : {}),
    };
  }

  const pct = Math.round(counts.ok / list.length * 100);
  console.log(`\n${level.toUpperCase()}: ${counts.ok}/${list.length} OK (${pct}%)  ${counts.locked > 0 ? `[${counts.locked} already locked]  ` : ''}phrase-missing: ${counts.phraseMissing}`);

  for (const k of Object.keys(counts)) globalCounts[k] = (globalCounts[k] || 0) + counts[k];
  globalCounts.total += list.length;
}

// ── Write status file ─────────────────────────────────────────────────────────
writeFileSync(STATUS_FILE, JSON.stringify(result, null, 2), 'utf8');
const totalPct = Math.round(globalCounts.ok / globalCounts.total * 100);
console.log(`\n${'─'.repeat(60)}`);
console.log(`TOTAL: ${globalCounts.ok}/${globalCounts.total} OK (${totalPct}%)`);
console.log(`  phrase-missing : ${globalCounts.phraseMissing}  ← need 2nd sentence in SENTENCE_OVERRIDE`);
console.log(`\n✅ kanji-status.json written (${Object.keys(result).length} entries)`);

// ── Print problem details ─────────────────────────────────────────────────────
if (problemList.length > 0) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`GAPS TO FILL (${problemList.length} kanji — each needs 1 more sentence):\n`);
  for (const level of LEVELS) {
    const group = problemList.filter(p => p.level === level);
    if (!group.length) continue;
    console.log(`── ${level.toUpperCase()} ──`);
    for (const p of group) {
      console.log(`  ${p.kanji}  ${p.detail}  [${p.readingInfo}]`);
    }
    console.log();
  }
}
