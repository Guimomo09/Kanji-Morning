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

import { readFileSync, mkdirSync, writeFileSync, unlinkSync, existsSync } from 'fs';
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
const DIR    = get('--dir', LEVEL);
const FORCE  = args.includes('--force');

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
 * Convert a Japanese sentence to HTML with 3-tier progressive kanji logic:
 *
 * 1. Token contains the card's main kanji
 *    → show in kanji with ruby furigana, main kanji char(s) in red
 * 2. Token has only kanji at targetLevel or easier (same/higher JLPT num)
 *    → show in kanji with ruby furigana
 * 3. Token has kanji harder than targetLevel (lower JLPT num, e.g. N4 in an N5 card)
 *    → convert entirely to hiragana (no ruby)
 */
// Irregular readings: kuromoji gets these wrong (dates, counters)
// Longer entries must come first to avoid partial matches
const IRREGULAR_MAP = [
  ['二十四日','にじゅうよっか'],['二十日','はつか'],['十四日','じゅうよっか'],
  ['一日','ついたち'],['二日','ふつか'],['三日','みっか'],['四日','よっか'],['五日','いつか'],
  ['六日','むいか'],['七日','なのか'],['八日','ようか'],['九日','ここのか'],['十日','とおか'],
  ['二人','ふたり'],['一人','ひとり'],
];

// Split text into segments: [{text, hira}] where hira is set only for irregular forms
function splitIrregulars(text) {
  const segments = [];
  let remaining = text;
  while (remaining.length > 0) {
    let found = false;
    for (const [surface, hira] of IRREGULAR_MAP) {
      const idx = remaining.indexOf(surface);
      if (idx === -1) continue;
      if (idx > 0) segments.push({ text: remaining.slice(0, idx), hira: null });
      segments.push({ text: surface, hira });
      remaining = remaining.slice(idx + surface.length);
      found = true;
      break;
    }
    if (!found) { segments.push({ text: remaining, hira: null }); break; }
  }
  return segments;
}

async function toFuriganaHTML(text, targetLevelNum = 5, mainKanji = '') {
  const tokenizer = await getTokenizer();
  const segments = splitIrregulars(text);
  const htmlParts = [];

  for (const seg of segments) {
    if (seg.hira) {
      // Render irregular form directly with correct ruby
      const displaySurface = [...seg.text].map(ch =>
        mainKanji.includes(ch) ? `<span class="mk">${escHtml(ch)}</span>` : escHtml(ch)
      ).join('');
      htmlParts.push(`<ruby><rb>${displaySurface}</rb><rt>${escHtml(seg.hira)}</rt></ruby>`);
      continue;
    }
    // Normal segment: tokenize with kuromoji
    const tokens = tokenizer.tokenize(seg.text);
    for (const tok of tokens) {
      const surface = tok.surface_form;
      const reading = tok.reading; // katakana
      const hasKanji = /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(surface);
      if (!hasKanji) { htmlParts.push(escHtml(surface)); continue; }

      const hira = reading ? katakanaToHiragana(reading) : null;
      const containsMain = [...surface].some(ch => mainKanji.includes(ch));

      let hasHarder = false;
      for (const ch of surface) {
        const cp = ch.codePointAt(0);
        if (!((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF))) continue;
        if (mainKanji.includes(ch)) continue;
        const lvl = CHAR_LEVEL_MAP.get(ch);
        if (lvl === undefined || lvl < targetLevelNum) { hasHarder = true; break; }
      }

      if (hasHarder && !containsMain) {
        htmlParts.push(hira ? escHtml(hira) : escHtml(surface)); continue;
      }
      if (!hira || hira === surface) { htmlParts.push(escHtml(surface)); continue; }

      const displaySurface = [...surface].map(ch =>
        mainKanji.includes(ch) ? `<span class="mk">${escHtml(ch)}</span>` : escHtml(ch)
      ).join('');
      htmlParts.push(`<ruby><rb>${displaySurface}</rb><rt>${escHtml(hira)}</rt></ruby>`);
    }
  }
  return htmlParts.join('');
}

function katakanaToHiragana(str) {
  return str.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Output dirs ───────────────────────────────────────────────────────────────
const INSTA_DIR  = join(ROOT, 'kanji-cards', DIR, 'cards');
const TIKTOK_DIR = join(ROOT, 'kanji-cards', DIR, 'reels');
mkdirSync(INSTA_DIR,  { recursive: true });
mkdirSync(TIKTOK_DIR, { recursive: true });

// ── JLPT data ─────────────────────────────────────────────────────────────────
const KANJI_INDEX = JSON.parse(readFileSync(join(ROOT, 'public', 'kanji_index.json'), 'utf8'));

// ── Kanji lock status ─────────────────────────────────────────────────────────
const STATUS_FILE_PATH = join(ROOT, 'kanji-status.json');
const KANJI_STATUS = existsSync(STATUS_FILE_PATH)
  ? JSON.parse(readFileSync(STATUS_FILE_PATH, 'utf8'))
  : {};

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

// ── EXAMPLE_OVERRIDE + SENTENCE_OVERRIDE (app curated data) ──────────────────
let EXAMPLE_OVERRIDE = {};
let SENTENCE_OVERRIDE = {};
try {
  const kjText = readFileSync(join(ROOT, 'src', 'kanji.js'), 'utf8');

  const loadObj = (varName) => {
    // handles both `const FOO = {` and `export const FOO = {`
    const marker = `${varName} = {`;
    const start = kjText.indexOf(marker);
    if (start === -1) return {};
    const objStart = start + marker.length - 1;
    // find matching closing brace
    let depth = 0, i = objStart;
    while (i < kjText.length) {
      if (kjText[i] === '{') depth++;
      else if (kjText[i] === '}') { depth--; if (depth === 0) break; }
      i++;
    }
    const objStr = kjText.slice(objStart, i + 1);
    return new Function(`"use strict"; return (${objStr})`)();
  };

  EXAMPLE_OVERRIDE  = loadObj('EXAMPLE_OVERRIDE');
  SENTENCE_OVERRIDE = loadObj('SENTENCE_OVERRIDE');
  console.log(`✅ EXAMPLE_OVERRIDE: ${Object.keys(EXAMPLE_OVERRIDE).length} kanji  |  SENTENCE_OVERRIDE: ${Object.keys(SENTENCE_OVERRIDE).length} kanji`);
} catch (e) {
  console.warn(`⚠️  Overrides non chargés: ${e.message}`);
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
    key: 'reels',
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

  const onVals   = [...new Set((data.o || []).slice(0, 3).map(r => r.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60)).replace(/\s.+$/, '')).reverse())].join('\u30fb');
  const kunVals  = [...new Set((data.k || []).slice(0, 3).map(r => r.replace(/^-/, '')).reverse())].join('\u30fb');
  const meanings = (data.m || '').split(',').slice(0, 3).join(', ');
  const kunBlock = kunVals ? `<div class="r-sect"><span class="rl-big">Kun</span><span class="tag kun-tag">${kunVals}</span></div>` : '';
  const onBlock  = onVals  ? `<div class="r-sect"><span class="rl-sm">On</span><span class="tag on-tag">${onVals}</span></div>`  : '';
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
  .readings{display:flex;flex-direction:column;gap:${readingGap * 2}px;align-items:center;width:100%;}
  .r-sect{display:flex;flex-direction:column;align-items:center;gap:${Math.round(readingGap * 0.7)}px;}
  .rl-big{font-size:${Math.round(labelFont * 1.3)}px;font-weight:900;letter-spacing:2px;color:#888;text-transform:uppercase;}
  .rl-sm{font-size:${labelFont}px;font-weight:700;letter-spacing:1.5px;color:#bbb;text-transform:uppercase;}
  .tag{border-radius:14px;font-weight:700;}
  .kun-tag{background:#e8f5e9;color:#2e7d32;font-size:${Math.round(tagFont * 1.25)}px;padding:${tagPad};}
  .on-tag{background:#fdecea;color:#b91c1c;font-size:${tagFont}px;padding:${tagPad};}
</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&display=swap" rel="stylesheet">
</head><body>
  <div class="hd"><div class="hl">${logoImg(logoSize)}</div><div class="ht">朝の漢字 · Asa no Kanji</div><div class="hr">JLPT ${LVL}</div></div>
  <div class="stage"><div class="card">
    <div class="kanji">${kanji}</div>
    <div class="meaning">${meanings}</div>
    <div class="divider"></div>
    <div class="readings">${kunBlock}${onBlock}</div>
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
  // sentences items have { jpHtml, en, readingType, reading } — reading is actual kana (ひ, ニチ…)
  const rows = sentences.map(({ jpHtml, en, readingType, reading }) => {
    const badgeText = readingType === 'kun' ? 'KUN' : readingType === 'on' ? 'ON' : null;
    const badge = badgeText
      ? `<span class="rbadge ${readingType}-badge">${badgeText}</span>`
      : '';
    // Auto-fit: scale down font so JP phrase fits on one line
    const rawJp = jpHtml.replace(/<rt>[^<]*<\/rt>/g, '').replace(/<[^>]+>/g, '');
    const hCardPad = parseInt(cardPad.trim().split(/\s+/)[1] ?? cardPad);
    const hSentPad = parseInt(sentPad.trim().split(/\s+/)[1] ?? sentPad);
    const availW = cardW - hCardPad * 2 - hSentPad * 2;
    const fitFont = rawJp.length > 0
      ? Math.min(sentJpFont, Math.max(18, Math.floor(availW / rawJp.length)))
      : sentJpFont;
    return `
    <div class="sr">
      ${badge ? `<div class="badge-row">${badge}</div>` : ''}
      <div class="sjp" style="font-size:${fitFont}px">${jpHtml}</div>
      <div class="sen">${en}</div>
    </div>`;
  }).join('');

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
  .sjp{font-size:${sentJpFont}px;font-weight:700;color:#1a1a1a;line-height:2.8;margin-bottom:10px;}
  ruby{display:inline ruby;}
  rb{display:inline;}
  rt{font-size:0.38em;font-weight:400;color:#888;line-height:1;}
  .mk{color:#c03a20;font-weight:900;}
  .rbadge{display:inline-block;font-size:${Math.round(sentJpFont*0.52)}px;font-weight:900;border-radius:6px;padding:2px 10px;margin-bottom:6px;line-height:1.6;}
  .kun-badge{background:#e8f5e9;color:#2e7d32;}
  .on-badge{background:#fdecea;color:#b91c1c;}
  .badge-row{margin-bottom:4px;}
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
  const kanjiData = KANJI_INDEX[kanji] || {};

  // Build pool: EXAMPLE_OVERRIDE (curated, priority) + kanjiapi.dev (supplement)
  // Combining both ensures KUN+ON coverage even when one source is one-sided.
  const overrideWords = EXAMPLE_OVERRIDE[kanji] || [];

  // If we have 3+ curated words, use them directly — no API needed.
  // This prevents API words from displacing curated words in the final 3 slots.
  if (overrideWords.length >= 3) return overrideWords.slice(0, 3);
  let apiWords = [];
  try {
    const res = await fetch(`https://kanjiapi.dev/v1/words/${encodeURIComponent(kanji)}`);
    if (res.ok) apiWords = pickLevelWords(await res.json(), kanji, levelNum, 30);
  } catch {}

  // Merge: override words first (priority), then api words (dedup by written form)
  const seenW = new Set(overrideWords.map(w => w.w));
  const pool = [...overrideWords, ...apiWords.filter(w => !seenW.has(w.w))];

  if (pool.length === 0) return [];

  // Classify and order: KUN first, ON second, fill with others
  // Override words keep their curated readings; api words use pickLevelWords readings.
  const { kun, on, other } = classifyVocab(pool, kanjiData, kanji);
  const result = [];
  const seen = new Set();
  const add = w => { if (!seen.has(w.w)) { seen.add(w.w); result.push({ w: w.w, r: w.r, m: w.m }); } };

  if (kun[0]) add(kun[0]);
  if (on[0])  add(on[0]);
  for (const w of [...other, ...kun.slice(1), ...on.slice(1)]) {
    if (result.length >= 3) break;
    add(w);
  }

  return result;
}

// ── Fetch: sentences ──────────────────────────────────────────────────────────
// Polite endings — desu/masu forms (preferred)
const POLITE_RE = /(です|ます|ました|でした|ません|ませんでした|でしょう|ましょう)[。？！]?$/;

// Check that a sentence contains the vocab word as a standalone word —
// not as a substring of a longer compound (火 should not match 火元).
function containsWordExact(sentence, word) {
  let idx = 0;
  while ((idx = sentence.indexOf(word, idx)) !== -1) {
    const before = idx > 0 ? sentence[idx - 1] : null;
    const after  = sentence[idx + word.length];
    const isKanjiOrKana = ch => {
      if (!ch) return false;
      const cp = ch.codePointAt(0);
      return (cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF) || (cp >= 0x30A0 && cp <= 0x30FF);
    };
    if (!isKanjiOrKana(before) && !isKanjiOrKana(after)) return true;
    idx += word.length;
  }
  return false;
}

// Search Tatoeba for candidates containing a vocab word.
// Scores each sentence: lower = better  (levelOk×1000 + polite×100 + length)
async function fetchTatoebaCandidates(word, maxLen, levelNum) {
  try {
    const url = `https://tatoeba.org/api_v0/search?query=${encodeURIComponent(word)}&from=jpn&to=eng&limit=200&sort=relevance`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const candidates = [];
    for (const s of (data.results || [])) {
      const jp = s.text?.trim();
      const en = s.translations?.[0]?.[0]?.text?.trim();
      if (!jp || !en) continue;
      if (!containsWordExact(jp, word)) continue;
      if (jp.length > maxLen) continue;
      if (jp.replace(/[。！？\s、]/g, '').length < 8) continue;
      const levelOk = isWordLevelOk(jp, levelNum, false);
      const polite  = POLITE_RE.test(jp);
      const score   = (levelOk ? 0 : 1000) + (polite ? 0 : 100) + jp.length;
      candidates.push({ jp, en, score });
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates;
  } catch { return []; }
}

// Search Massif (native Japanese corpus) for sentences.
// massif.la has no official API but responds to JSON requests.
async function fetchMassifCandidates(word, maxLen, levelNum) {
  try {
    const url = `https://massif.la/ja/search?q=${encodeURIComponent(word)}&fmt=json`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json();
    const candidates = [];
    for (const item of (data.results || [])) {
      // Massif returns { text } — no English translation
      // We only use it as a fallback when Tatoeba finds nothing
      const jp = item.text?.trim();
      if (!jp) continue;
      if (!jp.includes(word)) continue;
      if (jp.length > maxLen) continue;
      if (jp.replace(/[。！？\s、]/g, '').length < 8) continue;
      if (!isWordLevelOk(jp, levelNum, false)) continue;
      const polite = POLITE_RE.test(jp);
      candidates.push({ jp, en: null, score: (polite ? 0 : 100) + jp.length });
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates;
  } catch { return []; }
}

// Rendaku: voiced equivalent of first mora (ひ→び, か→が, etc.)
function voiced(r) {
  const map = {'か':'が','き':'ぎ','く':'ぐ','け':'げ','こ':'ご',
               'さ':'ざ','し':'じ','す':'ず','せ':'ぜ','そ':'ぞ',
               'た':'だ','ち':'ぢ','つ':'づ','て':'で','と':'ど',
               'は':'ば','ひ':'び','ふ':'ぶ','へ':'べ','ほ':'ぼ'};
  if (!r) return r;
  return (map[r[0]] ?? r[0]) + r.slice(1);
}

// Classify vocab words as KUN or ON based on their reading vs kanji readings
// Each classified word gets a `matchedReading` (hiragana for KUN, katakana for ON)
function classifyVocab(words, kanjiData, targetKanji = '') {
  const kunRoots   = (kanjiData.k || []).map(r => r.replace(/^-/, '').replace(/\..+$/, '').trim()).filter(Boolean);
  const onRootsKata = (kanjiData.o || []).map(r => r.replace(/\s.+$/, '').trim()).filter(Boolean);
  const onRootsHira = onRootsKata.map(r =>
    r.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
  );
  const kun = [], on = [], other = [];
  for (const w of words) {
    const r = w.r || '';
    const pos = targetKanji ? (w.w || '').indexOf(targetKanji) : 0;
    let classified = false;
    if (pos === 0) {
      // Kanji leads — match reading prefix
      const km = kunRoots.find(k => r.startsWith(k)) ?? kunRoots.find(k => r.startsWith(voiced(k)));
      if (km) {
        kun.push({ ...w, matchedReading: r.startsWith(voiced(km)) ? voiced(km) : km });
        classified = true;
      } else {
        const oi = onRootsHira.findIndex(o => r.startsWith(o));
        if (oi >= 0) { on.push({ ...w, matchedReading: onRootsKata[oi] }); classified = true; }
      }
    } else {
      // Kanji is suffix — match anywhere in reading
      const km = kunRoots.find(k => r.includes(k)) ?? kunRoots.find(k => r.includes(voiced(k)));
      if (km) {
        kun.push({ ...w, matchedReading: r.includes(voiced(km)) ? voiced(km) : km });
        classified = true;
      } else {
        const oi = onRootsHira.findIndex(o => r.includes(o));
        if (oi >= 0) { on.push({ ...w, matchedReading: onRootsKata[oi] }); classified = true; }
      }
    }
    if (!classified) other.push({ ...w, matchedReading: null });
  }
  return { kun, on, other };
}

// Detect whether the kanji's reading in this sentence is KUN or ON.
// Tokenizes JP, finds the token containing the kanji, reads its kana,
// then matches against the kanji's known KUN/ON roots.
async function detectReadingType(jp, kanji, kanjiData) {
  try {
    const tokenizer = await getTokenizer();
    const tokens = tokenizer.tokenize(jp);
    const kunRoots = (kanjiData.k || []).map(r => r.replace(/^-/, '').replace(/\..+$/, '').trim()).filter(Boolean);
    const onKata   = (kanjiData.o || []).map(r => r.replace(/\s.+$/, '').trim()).filter(Boolean);
    const onHira   = onKata.map(r => r.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60)));
    for (const tok of tokens) {
      if (!tok.surface_form.includes(kanji)) continue;
      const rd = tok.reading ? tok.reading.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60)) : '';
      if (!rd) continue;
      const pos = tok.surface_form.indexOf(kanji);
      // KUN: reading at pos starts with kun root (handle rendaku via voiced())
      const km = kunRoots.find(k => rd.startsWith(k) || rd.includes(k) || rd.startsWith(voiced(k)) || rd.includes(voiced(k)));
      if (km) return { type: 'kun', reading: km };
      const oi = onHira.findIndex(o => rd.startsWith(o) || rd.includes(o));
      if (oi >= 0) return { type: 'on', reading: onKata[oi] };
    }
  } catch {}
  return { type: null, reading: null };
}

// Fetch 2 example sentences: priority 1 KUN+1 ON > 2 KUN > 2 ON > any 2.
// Combines SENTENCE_OVERRIDE (curated) + Tatoeba to find the best possible pair.
async function fetchSentences(kanji, levelNum, displayWords, count = 2) {
  const kanjiData = KANJI_INDEX[kanji] || {};
  let results = [];
  const seenJp = new Set();

  // ── 1) SENTENCE_OVERRIDE — type all entries, keep as candidates ──
  const overrideRaw = (SENTENCE_OVERRIDE[kanji] || []).filter(s => s.jp && s.en);
  const overrideTyped = [];
  for (const s of overrideRaw) {
    const { type, reading } = await detectReadingType(s.jp, kanji, kanjiData);
    overrideTyped.push({ jp: s.jp, en: s.en, readingType: type, reading, src: 'override' });
  }
  const overrideKuns = overrideTyped.filter(s => s.readingType === 'kun');
  const overrideOns  = overrideTyped.filter(s => s.readingType === 'on');

  // If we already have 1 KUN + 1 ON from override alone → done, no Tatoeba needed
  // Mark override sentences as seen (needed for all downstream dedup)
  for (const s of overrideTyped) seenJp.add(s.jp);

  if (overrideKuns.length >= 1 && overrideOns.length >= 1) {
    results = [overrideKuns[0], overrideOns[0]];
  }

  // ── 2) Tatoeba — search by vocab words to supplement override ──
  if (results.length < 2) {
    let pool = [];
    try {
      const res = await fetch(`https://kanjiapi.dev/v1/words/${encodeURIComponent(kanji)}`);
      if (res.ok) pool = pickLevelWords(await res.json(), kanji, levelNum, 20);
    } catch {}
    const seenW = new Set(pool.map(w => w.w));
    for (const w of displayWords) if (!seenW.has(w.w)) { pool.push(w); seenW.add(w.w); }

    const { kun: wordsKun, on: wordsOn, other: wordsOther } = classifyVocab(pool, kanjiData, kanji);
    const maxLen = { 5: 35, 4: 50, 3: 65, 2: 80, 1: 100 }[levelNum] || 50;

    const fetchOneFor = async (wordList, readingType) => {
      for (const w of wordList) {
        const cands = await fetchTatoebaCandidates(w.w, maxLen, levelNum);
        for (const c of cands) {
          if (seenJp.has(c.jp)) continue;
          seenJp.add(c.jp);
          return { jp: c.jp, en: c.en, readingType, reading: w.matchedReading };
        }
      }
      const cands = await fetchTatoebaCandidates(kanji, maxLen, levelNum);
      for (const c of cands) {
        if (seenJp.has(c.jp)) continue;
        seenJp.add(c.jp);
        return { jp: c.jp, en: c.en, readingType, reading: null };
      }
      return null;
    };

    const haveKun = overrideKuns.length > 0;
    const haveOn  = overrideOns.length > 0;

    // Fetch the missing type(s) from Tatoeba
    let tatKun = null, tatOn = null;
    if (!haveKun) {
      tatKun = await fetchOneFor(wordsKun.length ? wordsKun : wordsOther, 'kun');
    }
    if (!haveOn) {
      tatOn = await fetchOneFor(wordsOn.length ? wordsOn : wordsOther, 'on');
    }

    // Build final pair using all candidates, priority: KUN+ON > 2KUN > 2ON > any 2
    const allKuns = [...overrideKuns, ...(tatKun ? [tatKun] : [])];
    const allOns  = [...overrideOns,  ...(tatOn  ? [tatOn]  : [])];
    const allAny  = [...overrideTyped, ...(tatKun ? [tatKun] : []), ...(tatOn ? [tatOn] : [])];

    if (allKuns.length >= 1 && allOns.length >= 1) {
      results = [allKuns[0], allOns[0]];
    } else if (allKuns.length >= 2) {
      results = allKuns.slice(0, 2);
    } else if (allOns.length >= 2) {
      results = allOns.slice(0, 2);
    } else {
      results = allAny.slice(0, 2);
      while (results.length < count) {
        const s = await fetchOneFor([...wordsKun, ...wordsOn, ...wordsOther], null);
        if (!s) break;
        results.push(s);
      }
    }
  }

  // ── 3) Vocab coverage pass ─────────────────────────────────────────────────
  // Ensure the 2 phrases each cover a different display vocab word where possible.
  // If both sentences contain the same word (or sentence 2 contains none), try Tatoeba.
  if (results.length === 2 && displayWords.length >= 2) {
    const maxLenVP = { 5: 35, 4: 50, 3: 65, 2: 80, 1: 100 }[levelNum] || 50;
    const vocabWords = displayWords.map(w => w.w);
    const cov0 = vocabWords.findIndex(w => results[0].jp.includes(w));
    const cov1 = vocabWords.findIndex(w => results[1].jp.includes(w));
    if (cov0 >= 0 && (cov1 === -1 || cov1 === cov0)) {
      const altWord = vocabWords.find((_, i) => i !== cov0);
      if (altWord) {
        const cands = await fetchTatoebaCandidates(altWord, maxLenVP, levelNum);
        for (const c of cands) {
          if (seenJp.has(c.jp)) continue;
          const { type, reading } = await detectReadingType(c.jp, kanji, kanjiData);
          results[1] = { jp: c.jp, en: c.en, readingType: type, reading };
          seenJp.add(c.jp);
          break;
        }
      }
    }
  }

  return results;
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
  await page.goto(`file:///${tmpPath.replace(/\\/g, '/')}`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: canvasW, height: canvasH } });
  unlinkSync(tmpPath);
}

// ── Main loop ─────────────────────────────────────────────────────────────────
let ok = 0, skipped = 0;
for (const kanji of targetKanji) {
  const data = KANJI_INDEX[kanji];
  if (!data) { console.log(`⚠️  Pas de données pour ${kanji}`); continue; }

  // Skip kanji already validated and locked (unless --force)
  if (!FORCE && KANJI_STATUS[kanji]?.status === 'ok' && KANJI_STATUS[kanji]?.locked) {
    console.log(`🔒 ${kanji} — déjà OK (locked ${KANJI_STATUS[kanji].locked}), skipped`);
    skipped++;
    continue;
  }

  const lvlStr = realLevel(kanji);
  const lvlNum = CHAR_LEVEL_MAP.get(kanji) ?? parseInt(LEVEL.replace('n', ''), 10);

  try {
  // Fetch une seule fois, réutilisé pour les deux formats
  const words     = await fetchVocab(kanji, lvlNum);
  const sentences = await fetchSentences(kanji, lvlNum, words, 2);

  // Convert sentences: known kanji shown as kanji, rest → hiragana (progressive textbook style)
  const sentencesWithFurigana = await Promise.all(
    sentences.map(async ({ jp, en, readingType, reading }) => ({
      jpHtml: await toFuriganaHTML(jp, lvlNum, kanji),
      en,
      readingType,
      reading,
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
  } catch (e) {
    console.error(`❌ ${kanji}: ${e.message?.slice(0, 120)}`);
  }
}

await browser.close();
console.log(`\n🎉 ${ok} kanji générés × 2 formats × 3 cartes`);
if (skipped > 0) console.log(`🔒 ${skipped} kanji skippés (déjà locked OK)`);
console.log(`   kanji-cards/${DIR}/cards/{kanji}/  →  1080×1080px (insta square)`);
  console.log(`   kanji-cards/${DIR}/reels/{kanji}/ →  1080×1920px (portrait)\n`);
