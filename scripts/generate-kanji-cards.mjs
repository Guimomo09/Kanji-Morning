/**
 * generate-kanji-cards.mjs — v2
 *
 * Génère 3 cartes par kanji dans deux formats :
 *   kanji-cards/insta/{kanji}/   → 1080×1080px  (Instagram / carré)
 *   kanji-cards/tiktok/{kanji}/  → 1080×1920px  (TikTok / 9:16 portrait)
 *
 * Cartes :
 *   1-kanji.png   — kanji + signification + lectures
 *   2-vocab.png   — 3 mots exemple (EXAMPLE_OVERRIDE de l'app en priorité)
 *   3-phrases.png — 2 phrases d'exemple (Tatoeba)
 *
 * Usage :
 *   node scripts/generate-kanji-cards.mjs
 *   node scripts/generate-kanji-cards.mjs --level n4 --count 5
 *   node scripts/generate-kanji-cards.mjs --kanji 火,水,木
 *   node scripts/generate-kanji-cards.mjs --theme dark
 */

import { readFileSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── CLI ───────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const get = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };

const LEVEL  = get('--level', 'n5');
const COUNT  = parseInt(get('--count', '5'), 10);
const CUSTOM = get('--kanji', null);

// ── Kuromoji furigana ─────────────────────────────────────────────────────────
const kuromoji = require('kuromoji');
const KUROMOJI_DIC = resolve(ROOT, 'node_modules/kuromoji/dict');

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

/**
 * Convert a Japanese sentence to display text:
 * - Kanji known at targetLevelNum (and above = easier) → shown as kanji
 * - mainKanji (the card's kanji) → always shown as kanji
 * - Everything else → converted to hiragana via kuromoji reading
 * No furigana ruby tags — clean textbook-style progressive kanji.
 */
async function toFuriganaHTML(text, targetLevelNum = 5, mainKanji = '') {
  const tokenizer = await getTokenizer();
  const tokens = tokenizer.tokenize(text);
  return tokens.map(tok => {
    const surface = tok.surface_form;
    const reading = tok.reading; // katakana
    const hasKanji = /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(surface);
    if (!hasKanji) return escHtml(surface);

    // A token is "all known" if every kanji in it is either the card's kanji
    // or belongs to a JLPT level >= targetLevelNum (i.e. N5=5 ≥ 5, N4=4 < 5)
    const allKnown = [...surface].every(ch => {
      const cp = ch.codePointAt(0);
      if (!((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF))) return true;
      if (mainKanji.includes(ch)) return true;
      const lvl = CHAR_LEVEL_MAP.get(ch);
      if (lvl === undefined) return false; // not in JLPT → treat as too hard
      return lvl >= targetLevelNum;
    });

    if (allKnown) {
      return escHtml(surface);
    }
    // Replace token with its hiragana reading
    if (reading) {
      return escHtml(katakanaToHiragana(reading));
    }
    return escHtml(surface); // fallback: no reading available
  }).join('');
}

function katakanaToHiragana(str) {
  return str.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Output dirs ───────────────────────────────────────────────────────────────
const INSTA_DIR  = join(ROOT, 'kanji-cards', 'insta');
const TIKTOK_DIR = join(ROOT, 'kanji-cards', 'tiktok');
mkdirSync(INSTA_DIR,  { recursive: true });
mkdirSync(TIKTOK_DIR, { recursive: true });

// ── JLPT data ─────────────────────────────────────────────────────────────────
const KANJI_INDEX = JSON.parse(readFileSync(join(ROOT, 'public', 'kanji_index.json'), 'utf8'));

async function fetchJLPTList(num) {
  const res = await fetch(`https://kanjiapi.dev/v1/kanji/jlpt-${num}`);
  if (!res.ok) throw new Error(`kanjiapi.dev jlpt-${num}: HTTP ${res.status}`);
  return res.json();
}

const [list5, list4, list3, list2, list1] = await Promise.all([5, 4, 3, 2, 1].map(fetchJLPTList));
const JLPT_LISTS = { n5: list5, n4: list4, n3: list3, n2: list2, n1: list1 };

const CHAR_LEVEL_MAP = new Map();
for (const [level, num] of Object.entries({ n5: 5, n4: 4, n3: 3, n2: 2, n1: 1 })) {
  for (const ch of (JLPT_LISTS[level] || [])) CHAR_LEVEL_MAP.set(ch, num);
}

function realLevel(kanji) {
  const n = CHAR_LEVEL_MAP.get(kanji);
  return n ? `N${n}` : LEVEL.toUpperCase();
}

// ── EXAMPLE_OVERRIDE (app curated data — highest priority for vocab) ──────────
let EXAMPLE_OVERRIDE = {};
try {
  const kjText = readFileSync(join(ROOT, 'src', 'kanji.js'), 'utf8');
  const ovStart = kjText.indexOf('const EXAMPLE_OVERRIDE = {');
  if (ovStart !== -1) {
    const ovEnd  = kjText.indexOf('\n};', ovStart) + 3;
    const objStr = kjText.slice(ovStart + 'const EXAMPLE_OVERRIDE = '.length, ovEnd - 1);
    EXAMPLE_OVERRIDE = new Function(`"use strict"; return (${objStr})`)();
    console.log(`✅ EXAMPLE_OVERRIDE: ${Object.keys(EXAMPLE_OVERRIDE).length} kanji chargés`);
  }
} catch (e) {
  console.warn(`⚠️  EXAMPLE_OVERRIDE non chargé: ${e.message}`);
}

// ── Kanji selection ───────────────────────────────────────────────────────────
let targetKanji;
if (CUSTOM) {
  targetKanji = CUSTOM.split(',').map(k => k.trim()).filter(k => KANJI_INDEX[k]);
} else {
  const pool = (JLPT_LISTS[LEVEL] || JLPT_LISTS.n5).filter(k => KANJI_INDEX[k]);
  targetKanji = pool.sort(() => Math.random() - 0.5).slice(0, Math.min(COUNT, pool.length));
}

console.log(`\n🎴 ${targetKanji.length} kanji — ${LEVEL.toUpperCase()}`);
console.log(`   ${targetKanji.join(' ')}\n`);

// ── Format configs ─────────────────────────────────────────────────────────────
const FMT = {
  insta: {
    key: 'insta',
    canvasW: 1080, canvasH: 1080,
    headerH: 110, headerFont: 28, levelFont: 22, logoSize: 64,
    cardW: 860, cardH: 780, cardPad: '40px 64px', cardRadius: 28,
    kanjiFont: 260, meaningFont: 36, meaningMaxW: 700,
    tagFont: 26, tagPad: '8px 24px', labelFont: 16, readingGap: 12,
    badgeFont: 90, titleFont: 28, subFont: 18,
    wordKanjiFont: 42, wordReadFont: 20, wordMeanFont: 26,
    wordPad: '20px 28px', wordGap: '28px', wordJustify: 'center',
    sentJpFont: 34, sentEnFont: 20, sentPad: '24px 28px', sentGap: '24px', sentJustify: 'center',
  },
  tiktok: {
    key: 'tiktok',
    canvasW: 1080, canvasH: 1920,
    headerH: 120, headerFont: 30, levelFont: 24, logoSize: 70,
    cardW: 940, cardH: 860, cardPad: '44px 70px', cardRadius: 30,
    kanjiFont: 285, meaningFont: 40, meaningMaxW: 770,
    tagFont: 28, tagPad: '9px 26px', labelFont: 18, readingGap: 14,
    badgeFont: 100, titleFont: 31, subFont: 20,
    wordKanjiFont: 46, wordReadFont: 22, wordMeanFont: 28,
    wordPad: '22px 30px', wordGap: '30px', wordJustify: 'center',
    sentJpFont: 37, sentEnFont: 22, sentPad: '26px 30px', sentGap: '26px', sentJustify: 'center',
  },
};

// ── Logo ──────────────────────────────────────────────────────────────────────
const LOGO_B64 = `data:image/png;base64,${readFileSync(join(ROOT, 'SVG', 'Logo_192.png')).toString('base64')}`;
const logoImg = (size) =>
  `<img src="${LOGO_B64}" width="${size}" height="${size}" style="border-radius:50%;display:block;flex-shrink:0;" alt="logo">`;

// ── Card 1 — Kanji ────────────────────────────────────────────────────────────
function buildKanjiHTML(kanji, data, levelStr, fmt) {
  const { canvasW, canvasH, headerH, headerFont, levelFont, logoSize,
          cardW, cardH, cardPad, cardRadius,
          kanjiFont, meaningFont, meaningMaxW,
          tagFont, tagPad, labelFont, readingGap } = fmt;

  const onVals   = (data.o || []).slice(0, 3).join('・');
  const kunVals  = (data.k || []).slice(0, 3).join('・');
  const meanings = (data.m || '').split(',').slice(0, 3).join(', ');
  const onBlock  = onVals  ? `<div class="rr"><span class="rl">ON</span><span class="tag on">${onVals}</span></div>`   : '';
  const kunBlock = kunVals ? `<div class="rr"><span class="rl">KUN</span><span class="tag kun">${kunVals}</span></div>` : '';
  const LVL = levelStr || LEVEL.toUpperCase();
  const logoW = logoSize + 36;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
  *{margin:0;padding:0;box-sizing:border-box;}
  html,body{width:${canvasW}px;height:${canvasH}px;overflow:hidden;}
  body{background:#faf7f2;font-family:'Noto Sans JP',sans-serif;display:flex;flex-direction:column;}
  .hd{width:${canvasW}px;height:${headerH}px;background:#c03a20;display:flex;align-items:center;padding:0 48px;flex-shrink:0;}
  .hl{width:${logoW}px;}
  .ht{flex:1;text-align:center;font-size:${headerFont}px;font-weight:800;color:#fff;letter-spacing:.5px;}
  .hr{color:rgba(255,255,255,.85);font-size:${levelFont}px;font-weight:800;letter-spacing:1.5px;width:${logoW}px;text-align:right;white-space:nowrap;}
  .stage{flex:1;display:flex;align-items:center;justify-content:center;}
  .card{width:${cardW}px;height:${cardH}px;background:#fff;border-radius:${cardRadius}px;border:1.5px solid #e8e0d5;box-shadow:0 12px 48px rgba(0,0,0,.10);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:${cardPad};}
  .kanji{font-size:${kanjiFont}px;font-weight:900;color:#1a1a1a;line-height:1;margin-bottom:24px;}
  .meaning{font-size:${meaningFont}px;font-weight:700;color:#1a1a1a;text-align:center;margin-bottom:32px;max-width:${meaningMaxW}px;line-height:1.3;}
  .divider{width:48px;height:4px;background:#c03a20;border-radius:2px;margin-bottom:32px;opacity:.35;}
  .readings{display:flex;flex-direction:column;gap:${readingGap}px;align-items:center;}
  .rr{display:flex;align-items:center;gap:14px;}
  .rl{font-size:${labelFont}px;font-weight:900;letter-spacing:1.5px;width:44px;text-align:right;color:#aaa;flex-shrink:0;}
  .tag{border-radius:12px;padding:${tagPad};font-size:${tagFont}px;font-weight:700;}
  .on{background:#fdecea;color:#b91c1c;}
  .kun{background:#e8f5e9;color:#2e7d32;}
</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&display=swap" rel="stylesheet">
</head><body>
  <div class="hd"><div class="hl">${logoImg(logoSize)}</div><div class="ht">朝の漢字 · Asa no Kanji</div><div class="hr">JLPT ${LVL}</div></div>
  <div class="stage"><div class="card">
    <div class="kanji">${kanji}</div>
    <div class="meaning">${meanings}</div>
    <div class="divider"></div>
    <div class="readings">${onBlock}${kunBlock}</div>
  </div></div>
</body></html>`;
}

// ── Card 2 — Vocab ────────────────────────────────────────────────────────────
function buildVocabHTML(kanji, words, levelStr, fmt) {
  const { canvasW, canvasH, headerH, headerFont, levelFont, logoSize,
          cardW, cardH, cardPad, cardRadius,
          badgeFont, titleFont, subFont,
          wordKanjiFont, wordReadFont, wordMeanFont,
          wordPad, wordGap, wordJustify } = fmt;
  const LVL = levelStr || LEVEL.toUpperCase();
  const logoW = logoSize + 36;

  const rows = words.map(({ w, r, m }) => `
    <div class="wr">
      <div class="wl">
        <div class="wk">${w}</div>
        <div class="wread">${r}</div>
      </div>
      <div class="wm">${m}</div>
    </div>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
  *{margin:0;padding:0;box-sizing:border-box;}
  html,body{width:${canvasW}px;height:${canvasH}px;overflow:hidden;}
  body{background:#faf7f2;font-family:'Noto Sans JP',sans-serif;display:flex;flex-direction:column;}
  .hd{width:${canvasW}px;height:${headerH}px;background:#c03a20;display:flex;align-items:center;padding:0 48px;flex-shrink:0;}
  .hl{width:${logoW}px;}
  .ht{flex:1;text-align:center;font-size:${headerFont}px;font-weight:800;color:#fff;letter-spacing:.5px;}
  .hr{color:rgba(255,255,255,.85);font-size:${levelFont}px;font-weight:800;letter-spacing:1.5px;width:${logoW}px;text-align:right;white-space:nowrap;}
  .stage{flex:1;display:flex;align-items:center;justify-content:center;}
  .card{width:${cardW}px;height:${cardH}px;background:#fff;border-radius:${cardRadius}px;border:1.5px solid #e8e0d5;box-shadow:0 12px 48px rgba(0,0,0,.10);display:flex;flex-direction:column;padding:${cardPad};}
  .ch{display:flex;align-items:center;gap:24px;margin-bottom:28px;}
  .badge{font-size:${badgeFont}px;font-weight:900;color:#c03a20;line-height:1;width:${Math.round(badgeFont * 1.2)}px;text-align:center;flex-shrink:0;}
  .ctitle{font-size:${titleFont}px;font-weight:800;color:#1a1a1a;}
  .csub{font-size:${subFont}px;color:#999;margin-top:4px;}
  .div{width:100%;height:1px;background:#e8e0d5;margin-bottom:24px;flex-shrink:0;}
  .words{display:flex;flex-direction:column;flex:1;gap:${wordGap};justify-content:${wordJustify};}
  .wr{display:flex;align-items:center;gap:24px;padding:${wordPad};border-radius:16px;background:#faf7f2;border:1px solid #e8e0d5;}
  .wl{flex-shrink:0;min-width:${Math.round(wordKanjiFont * 3.6)}px;}
  .wk{font-size:${wordKanjiFont}px;font-weight:900;color:#1a1a1a;}
  .wread{font-size:${wordReadFont}px;color:#888;margin-top:4px;}
  .wm{font-size:${wordMeanFont}px;font-weight:600;color:#444;line-height:1.4;}
</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&display=swap" rel="stylesheet">
</head><body>
  <div class="hd"><div class="hl">${logoImg(logoSize)}</div><div class="ht">朝の漢字 · Asa no Kanji</div><div class="hr">JLPT ${LVL}</div></div>
  <div class="stage"><div class="card">
    <div class="ch">
      <div class="badge">${kanji}</div>
      <div><div class="ctitle">Vocabulary</div><div class="csub">Words using this kanji</div></div>
    </div>
    <div class="div"></div>
    <div class="words">${rows}</div>
  </div></div>
</body></html>`;
}

// ── Card 3 — Phrases ──────────────────────────────────────────────────────────
function buildPhrasesHTML(kanji, sentences, levelStr, fmt) {
  const { canvasW, canvasH, headerH, headerFont, levelFont, logoSize,
          cardW, cardH, cardPad, cardRadius,
          badgeFont, titleFont, subFont,
          sentJpFont, sentEnFont, sentPad, sentGap, sentJustify } = fmt;
  const LVL = levelStr || LEVEL.toUpperCase();
  const logoW = logoSize + 36;
  // sentences items now have { jpHtml, en } — jpHtml already has ruby tags
  const rows = sentences.map(({ jpHtml, en }) => `
    <div class="sr">
      <div class="sjp">${jpHtml}</div>
      <div class="sen">${en}</div>
    </div>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
  *{margin:0;padding:0;box-sizing:border-box;}
  html,body{width:${canvasW}px;height:${canvasH}px;overflow:hidden;}
  body{background:#faf7f2;font-family:'Noto Sans JP',sans-serif;display:flex;flex-direction:column;}
  .hd{width:${canvasW}px;height:${headerH}px;background:#c03a20;display:flex;align-items:center;padding:0 48px;flex-shrink:0;}
  .hl{width:${logoW}px;}
  .ht{flex:1;text-align:center;font-size:${headerFont}px;font-weight:800;color:#fff;letter-spacing:.5px;}
  .hr{color:rgba(255,255,255,.85);font-size:${levelFont}px;font-weight:800;letter-spacing:1.5px;width:${logoW}px;text-align:right;white-space:nowrap;}
  .stage{flex:1;display:flex;align-items:center;justify-content:center;}
  .card{width:${cardW}px;background:#fff;border-radius:${cardRadius}px;border:1.5px solid #e8e0d5;box-shadow:0 12px 48px rgba(0,0,0,.10);display:flex;flex-direction:column;padding:${cardPad};}
  .ch{display:flex;align-items:center;gap:24px;margin-bottom:28px;}
  .badge{font-size:${badgeFont}px;font-weight:900;color:#c03a20;line-height:1;width:${Math.round(badgeFont * 1.2)}px;text-align:center;flex-shrink:0;}
  .ctitle{font-size:${titleFont}px;font-weight:800;color:#1a1a1a;}
  .csub{font-size:${subFont}px;color:#999;margin-top:4px;}
  .div{width:100%;height:1px;background:#e8e0d5;margin-bottom:24px;flex-shrink:0;}
  .sentences{display:flex;flex-direction:column;gap:${sentGap};}
  .sr{padding:${sentPad};border-radius:16px;background:#faf7f2;border:1px solid #e8e0d5;border-left:4px solid #c03a20;}
  .sjp{font-size:${sentJpFont}px;font-weight:700;color:#1a1a1a;line-height:1.7;margin-bottom:10px;}
  .sen{font-size:${sentEnFont}px;color:#666;font-style:italic;line-height:1.4;}
</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&display=swap" rel="stylesheet">
</head><body>
  <div class="hd"><div class="hl">${logoImg(logoSize)}</div><div class="ht">朝の漢字 · Asa no Kanji</div><div class="hr">JLPT ${LVL}</div></div>
  <div class="stage"><div class="card">
    <div class="ch">
      <div class="badge">${kanji}</div>
      <div><div class="ctitle">Example Sentences</div><div class="csub">In context, JLPT ${LVL} level</div></div>
    </div>
    <div class="div"></div>
    <div class="sentences">${rows}</div>
  </div></div>
</body></html>`;
}

// ── Fetch: vocab ───────────────────────────────────────────────────────────────
// strictMode=true: reject any kanji harder than target (used for vocab)
// strictMode=false: allow 1 level looser + unknown kanji treated as N3 (used for sentences)
function isWordLevelOk(written, targetJlptNum, strictMode = true) {
  const minLvl = strictMode ? targetJlptNum : Math.max(1, targetJlptNum - 1);
  for (const ch of written) {
    const cp = ch.codePointAt(0);
    if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF)) {
      const lvl = CHAR_LEVEL_MAP.get(ch);
      // Unknown (not in JLPT): treat as N3 (level 3) — acceptable unless targeting N5 strictly
      const effectiveLvl = lvl ?? 3;
      if (effectiveLvl < minLvl) return false;
    }
  }
  return true;
}

function pickLevelWords(wordEntries, targetChar, targetJlptNum, max = 3) {
  const GLOSS_SKIP = /^(?:\w{2,3}:|\(|\[|to be |see )/i;
  const candidates = [];
  for (const entry of wordEntries) {
    const variants = (entry.variants ?? []).filter(v => v.written?.includes(targetChar));
    if (!variants.length) continue;
    const variant = variants.find(v => v.priorities?.length > 0) ?? variants[0];
    let gloss = null;
    for (const m of (entry.meanings ?? [])) {
      for (const g of (m.glosses ?? [])) {
        if (!GLOSS_SKIP.test(g)) { gloss = g; break; }
      }
      if (gloss) break;
    }
    if (!gloss) gloss = entry.meanings?.[0]?.glosses?.[0];
    if (!gloss || gloss.length < 4) continue;
    const priorities = variant.priorities ?? [];
    const nfMatch = priorities.map(p => p.match(/^nf(\d+)$/)).find(Boolean);
    const freqRank = nfMatch ? parseInt(nfMatch[1]) * 100
      : priorities.some(p => p === 'ichi1' || p === 'spec1') ? 500
      : 99999;
    candidates.push({
      w: variant.written,
      r: (variant.pronounced ?? '').replace(/[\u30A1-\u30F6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)),
      m: gloss.length > 42 ? gloss.slice(0, 40) + '…' : gloss,
      score: freqRank + (isWordLevelOk(variant.written, targetJlptNum) ? 0 : 100000),
    });
  }
  candidates.sort((a, b) => a.score - b.score);
  const seen = new Set(), out = [];
  for (const c of candidates) {
    if (!seen.has(c.w)) { seen.add(c.w); out.push({ w: c.w, r: c.r, m: c.m }); }
    if (out.length >= max) break;
  }
  return out;
}

async function fetchVocab(kanji, levelNum) {
  // 1. EXAMPLE_OVERRIDE — données curées de l'app (priorité max)
  if (EXAMPLE_OVERRIDE[kanji]?.length > 0) {
    return EXAMPLE_OVERRIDE[kanji].slice(0, 3);
  }
  // 2. Fallback : kanjiapi.dev
  try {
    const res = await fetch(`https://kanjiapi.dev/v1/words/${encodeURIComponent(kanji)}`);
    if (!res.ok) return [];
    return pickLevelWords(await res.json(), kanji, levelNum, 3);
  } catch { return []; }
}

// ── Fetch: sentences ──────────────────────────────────────────────────────────
// Polite endings — desu/masu forms (preferred)
const POLITE_RE = /(です|ます|ました|でした|ません|ませんでした|でしょう|ましょう)[。？！]?$/;

async function fetchSentences(kanji, levelNum, count = 2) {
  try {
    const url = `https://tatoeba.org/api_v0/search?query=${encodeURIComponent(kanji)}&from=jpn&to=eng&limit=200&sort=relevance`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const maxLen = { 5: 28, 4: 36, 3: 48, 2: 64, 1: 90 }[levelNum] || 36;

    const polite = [], plain = [];
    const seen = new Set();
    for (const s of (data.results || [])) {
      const jp = s.text?.trim();
      const en = s.translations?.[0]?.[0]?.text?.trim();
      if (!jp || !en || !jp.includes(kanji)) continue;
      if (jp.length > maxLen) continue;
      if (jp.replace(/[。！？\s、]/g, '').length < 4) continue;
      if (seen.has(jp)) continue;
      // Reject sentences with kanji much harder than target (1-level tolerance, loose mode)
      if (!isWordLevelOk(jp, levelNum, false)) continue;
      seen.add(jp);
      if (POLITE_RE.test(jp)) polite.push({ jp, en });
      else plain.push({ jp, en });
    }
    // Prefer polite sentences; fill remaining slots with plain
    const result = [...polite, ...plain];
    return result.slice(0, count);
  } catch { return []; }
}

// ── Playwright ────────────────────────────────────────────────────────────────
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
const ctx     = await browser.newContext({ deviceScaleFactor: 2 });
const page    = await ctx.newPage();

async function renderCard(html, outPath, fmt) {
  const { canvasW, canvasH } = fmt;
  const tmpPath = outPath.replace(/\.png$/, '_tmp.html');
  writeFileSync(tmpPath, html, 'utf8');
  await page.setViewportSize({ width: canvasW, height: canvasH });
  await page.goto(`file:///${tmpPath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: canvasW, height: canvasH } });
  unlinkSync(tmpPath);
}

// ── Main loop ─────────────────────────────────────────────────────────────────
let ok = 0;
for (const kanji of targetKanji) {
  const data = KANJI_INDEX[kanji];
  if (!data) { console.log(`⚠️  Pas de données pour ${kanji}`); continue; }

  const lvlStr = realLevel(kanji);
  const lvlNum = CHAR_LEVEL_MAP.get(kanji) ?? parseInt(LEVEL.replace('n', ''), 10);

  // Fetch une seule fois, réutilisé pour les deux formats
  const words     = await fetchVocab(kanji, lvlNum);
  const sentences = await fetchSentences(kanji, lvlNum, 2);

  // Convert sentences: known kanji shown as kanji, rest → hiragana (progressive textbook style)
  const sentencesWithFurigana = await Promise.all(
    sentences.map(async ({ jp, en }) => ({
      jpHtml: await toFuriganaHTML(jp, lvlNum, kanji),
      en,
    }))
  );
  const vocabSrc = EXAMPLE_OVERRIDE[kanji] ? 'override' : 'api';

  for (const [fmtKey, fmt] of Object.entries(FMT)) {
    const baseDir  = fmtKey === 'insta' ? INSTA_DIR : TIKTOK_DIR;
    const kanjiDir = join(baseDir, kanji);
    mkdirSync(kanjiDir, { recursive: true });

    // Carte 1 — Kanji
    await renderCard(buildKanjiHTML(kanji, data, lvlStr, fmt), join(kanjiDir, '1-kanji.png'), fmt);

    // Carte 2 — Vocab
    if (words.length > 0) {
      await renderCard(buildVocabHTML(kanji, words, lvlStr, fmt), join(kanjiDir, '2-vocab.png'), fmt);
    } else {
      console.log(`  ⚠️  [${fmtKey}] Pas de vocab pour ${kanji}`);
    }

    // Carte 3 — Phrases
    if (sentencesWithFurigana.length > 0) {
      await renderCard(buildPhrasesHTML(kanji, sentencesWithFurigana, lvlStr, fmt), join(kanjiDir, '3-phrases.png'), fmt);
    } else {
      console.log(`  ⚠️  [${fmtKey}] Pas de phrases pour ${kanji}`);
    }
  }

  console.log(`✅ ${kanji} (${lvlStr}) — vocab [${vocabSrc}]: ${words.map(w => w.w).join(', ') || '—'} — phrases: ${sentencesWithFurigana.length}/2`);
  ok++;
}

await browser.close();
console.log(`\n🎉 ${ok} kanji × 2 formats × 3 cartes`);
console.log(`   kanji-cards/insta/{kanji}/  →  1080×1080px`);
console.log(`   kanji-cards/tiktok/{kanji}/ →  1080×1920px\n`);
