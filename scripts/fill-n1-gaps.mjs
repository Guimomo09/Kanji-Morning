/**
 * fill-n1-gaps.mjs
 * Offline — no API calls except a single N1 kanji list fetch.
 * For every N1 kanji with <2 sentences in SENTENCE_OVERRIDE:
 *   - 0 sentences + vocab  → add 2 template sentences from EXAMPLE_OVERRIDE vocab
 *   - 1 sentence           → add 1 template sentence from EXAMPLE_OVERRIDE vocab
 *   - 0 sentences + no vocab → add 2 hardcoded manual sentences (7 ❌ cases)
 * Injects directly into src/kanji.js.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const KANJI_PATH = join(ROOT, 'src', 'kanji.js');

// ── Load overrides ────────────────────────────────────────────────────────────
let src = readFileSync(KANJI_PATH, 'utf8');
function loadObj(varName) {
  const marker = `${varName} = {`;
  const start = src.indexOf(marker);
  if (start === -1) return {};
  let depth = 0, i = start + marker.length - 1;
  while (i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
    i++;
  }
  try { return new Function(`"use strict"; return (${src.slice(start + marker.length - 1, i + 1)})`)(); }
  catch { return {}; }
}
const EXAMPLE_OVERRIDE  = loadObj('EXAMPLE_OVERRIDE');
const SENTENCE_OVERRIDE = loadObj('SENTENCE_OVERRIDE');

// ── Manual sentences for 7 ❌ (no vocab, no sentences anywhere) ───────────────
const MANUAL = {
  '崚': [
    { jp: '崚々たる山々が朝日に輝いていた。', en: 'The towering mountains shone in the morning sun.' },
    { jp: '険しい崚峰を登るのは容易ではない。', en: 'Climbing the rugged, lofty peaks is no easy feat.' },
  ],
  '彪': [
    { jp: '彪炳たる業績を後世に残した人物だ。', en: 'He was a figure who left distinguished achievements for posterity.' },
    { jp: '彪は虎の模様や勇猛さを表す漢字だ。', en: 'Hyō is a kanji expressing tiger stripes and bravery.' },
  ],
  '晟': [
    { jp: '晟という字は輝きや盛んなさまを意味する。', en: 'The character sei means brightness and prosperity.' },
    { jp: '晟は人名によく使われる漢字の一つだ。', en: 'Sei is one of the kanji commonly used in personal names.' },
  ],
  '朕': [
    { jp: '古代の天皇は朕という一人称を使った。', en: 'Ancient emperors used the first-person pronoun "chin".' },
    { jp: '朕はこれを命ずる、と天皇は宣言した。', en: '"I hereby command this," the emperor declared.' },
  ],
  '燿': [
    { jp: '夜空の星が燿々と輝いていた。', en: 'The stars in the night sky shone brilliantly.' },
    { jp: '燿は光り輝くことを表す漢字だ。', en: 'Yō is a kanji representing shining brilliance.' },
  ],
  '舜': [
    { jp: '舜は古代中国の伝説的な聖王だ。', en: 'Shun is a legendary sage king of ancient China.' },
    { jp: '堯舜の時代は平和だったと伝えられる。', en: 'The era of Yao and Shun is said to have been peaceful.' },
  ],
  '赳': [
    { jp: '赳々武夫という言葉は勇ましい武人を指す。', en: 'The phrase "kyūkyū takeo" refers to a brave warrior.' },
    { jp: '赳は勇ましさや凛々しさを表す漢字だ。', en: 'Kyū is a kanji that expresses bravery and gallantry.' },
  ],
};

// ── Template sentence generator (offline) ────────────────────────────────────
// Rotates 3 natural templates based on kanji code point for variety
function makeSentence(kanji, vocabEntry, slot /* 0 or 1 */) {
  if (!vocabEntry) {
    // Ultimate fallback (no vocab at all)
    const fb = [
      { jp: `${kanji}という漢字には深い意味がある。`, en: `The kanji ${kanji} carries a deep meaning.` },
      { jp: `${kanji}は日本語の語彙の中に含まれる漢字だ。`, en: `${kanji} is a kanji found in the Japanese vocabulary.` },
    ];
    return fb[slot];
  }
  const { w, r, m } = vocabEntry;
  const cp = kanji.codePointAt(0) % 3;

  if (slot === 0) {
    // Three patterns for first sentence
    const opts = [
      { jp: `${w}（${r}）という言葉は「${m}」を意味する。`, en: `The word ${w} (${r}) means "${m}".` },
      { jp: `${w}はよく知られた日本語の表現の一つだ。`, en: `${w} is one of the well-known Japanese expressions.` },
      { jp: `${w}という言葉を覚えておくと役に立つ。`, en: `Remembering the word ${w} will come in handy.` },
    ];
    return opts[cp];
  } else {
    // Three patterns for second sentence
    const opts = [
      { jp: `${w}について詳しく学んだことがある。`, en: `I have learned about ${w} in detail.` },
      { jp: `${w}という表現を日常会話で使うことがある。`, en: `The expression ${w} is sometimes used in daily conversation.` },
      { jp: `${w}は日本語で重要な言葉の一つだと思う。`, en: `I think ${w} is one of the important words in Japanese.` },
    ];
    return opts[cp];
  }
}

// ── Fetch N1 list ─────────────────────────────────────────────────────────────
console.log('Fetching N1 kanji list…');
const r = await fetch('https://kanjiapi.dev/v1/kanji/jlpt-1');
const N1 = r.ok ? await r.json() : [];
console.log(`  N1: ${N1.length} kanji`);

// ── Identify gaps ─────────────────────────────────────────────────────────────
const toAdd = {}; // kanji → [{jp,en}, ...]

for (const k of N1) {
  const current = SENTENCE_OVERRIDE[k] || [];
  if (current.length >= 2) continue; // already complete

  if (MANUAL[k]) {
    // ❌ case — use hardcoded sentences
    toAdd[k] = MANUAL[k];
    continue;
  }

  // Get best vocab entry for templates
  const vocab0 = EXAMPLE_OVERRIDE[k]?.[0] || null;
  const vocab1 = EXAMPLE_OVERRIDE[k]?.[1] || vocab0;

  if (current.length === 0) {
    // Need 2 sentences
    toAdd[k] = [
      makeSentence(k, vocab0, 0),
      makeSentence(k, vocab1, 1),
    ];
  } else {
    // Need 1 more sentence
    toAdd[k] = [makeSentence(k, vocab1, 1)];
  }
}

console.log(`\nGaps to fill: ${Object.keys(toAdd).length} kanji`);

if (Object.keys(toAdd).length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

// ── Inject into SENTENCE_OVERRIDE ────────────────────────────────────────────
// Find closing brace of SENTENCE_OVERRIDE
const marker = 'SENTENCE_OVERRIDE = {';
const start  = src.indexOf(marker);
let depth = 0, i = start + marker.length - 1;
while (i < src.length) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { depth--; if (depth === 0) break; }
  i++;
}

let injection = '\n  // ── N1 gap fill (offline templates + manual) ──\n';
let addedNew = 0;
let addedExtra = 0;

for (const [k, sentences] of Object.entries(toAdd)) {
  const existing = SENTENCE_OVERRIDE[k] || [];

  if (existing.length === 0) {
    // Add fresh entry
    injection += `  '${k}': [\n`;
    for (const { jp, en } of sentences) {
      injection += `    { jp: '${jp.replace(/'/g, "\\'")}', en: '${en.replace(/'/g, "\\'")}' },\n`;
    }
    injection += `  ],\n`;
    addedNew++;
  } else {
    // Need to append to existing entry — find it in src and add the sentence
    // Pattern: find '${k}': [ ... ] and insert before the closing ]
    const entryPat = new RegExp(`'${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\s*:\\s*\\[`);
    const m2 = src.match(entryPat);
    if (m2) {
      const entryStart = src.indexOf(m2[0]);
      let d2 = 0, j = entryStart + m2[0].length - 1;
      while (j < src.length) {
        if (src[j] === '[') d2++;
        else if (src[j] === ']') { d2--; if (d2 === 0) break; }
        j++;
      }
      // j points to closing ]
      let extra = '';
      for (const { jp, en } of sentences) {
        extra += `    { jp: '${jp.replace(/'/g, "\\'")}', en: '${en.replace(/'/g, "\\'")}' },\n`;
      }
      src = src.slice(0, j) + '\n' + extra + '  ' + src.slice(j);
      addedExtra++;
    } else {
      // fallback: add as new (shouldn't happen but safe)
      injection += `  '${k}': [\n`;
      for (const { jp, en } of [...existing, ...sentences]) {
        injection += `    { jp: '${jp.replace(/'/g, "\\'")}', en: '${en.replace(/'/g, "\\'")}' },\n`;
      }
      injection += `  ],\n`;
      addedNew++;
    }
  }
}

// Insert new entries before closing } of SENTENCE_OVERRIDE
// Recalculate i since src may have changed
const start2  = src.indexOf(marker);
let depth2 = 0, i2 = start2 + marker.length - 1;
while (i2 < src.length) {
  if (src[i2] === '{') depth2++;
  else if (src[i2] === '}') { depth2--; if (depth2 === 0) break; }
  i2++;
}
src = src.slice(0, i2) + injection + src.slice(i2);

writeFileSync(KANJI_PATH, src, 'utf8');
console.log(`\n✅ Done:`);
console.log(`   ${addedNew} new entries added`);
console.log(`   ${addedExtra} existing entries extended (+1 sentence)`);
console.log(`   src/kanji.js updated`);
