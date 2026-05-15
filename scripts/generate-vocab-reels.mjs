/**
 * generate-vocab-reels.mjs
 *
 * Reels "Mot du jour" — design progressif, positions FIXES :
 *   [0-3s]   Hook   — "A very common Japanese word..."
 *   [3-7s]   Prog A — mot seul  (lecture/def/ex : visibility:hidden)
 *   [7-11s]  Prog B — + lecture  (def/ex : visibility:hidden)
 *   [11-17s] Prog C — + définition  (ex : visibility:hidden)
 *   [17-27s] Prog D — tout visible
 *   [27-34s] CTA    — identique kanji reels, fade out final
 *
 * Clé du design : tous les prog slides partagent le MÊME layout fixe.
 * Les éléments non encore révélés ont visibility:hidden (espace réservé).
 * → aucun déplacement lors des transitions.
 *
 * Usage :
 *   node scripts/generate-vocab-reels.mjs --words 食べ物
 *   node scripts/generate-vocab-reels.mjs --from-kanji 食,飲,学
 *   node scripts/generate-vocab-reels.mjs --level n5 --count 10 --bgm-vol 0.07
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── CLI ───────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const get  = (f, d) => { const i = args.indexOf(f); return i !== -1 ? args[i+1] : d; };
const has  = (f) => args.includes(f);

const CUSTOM_WORDS = get('--words', null);
const FROM_KANJI   = get('--from-kanji', null);
const LEVEL        = get('--level', 'n5');
const COUNT        = parseInt(get('--count', '10'), 10);
const BGM_VOL      = parseFloat(get('--bgm-vol', '0'));
const DRY_RUN      = has('--dry-run');
const VOICE        = get('--voice', 'ja-JP-NanamiNeural');

// ── Paths ─────────────────────────────────────────────────────────────────────
const OUT_DIR = join(ROOT, 'vocab-cards', 'reels');
const TMP     = join(ROOT, '.vocab-tmp');
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(TMP,     { recursive: true });

// ── Data ──────────────────────────────────────────────────────────────────────
const JMDICT   = JSON.parse(readFileSync(join(ROOT, 'public', 'jmdict_trans.json'), 'utf8'));
const LOGO_B64 = `data:image/png;base64,${readFileSync(join(ROOT, 'SVG', 'Logo_192.png')).toString('base64')}`;

// ── EXAMPLE_OVERRIDE ─────────────────────────────────────────────────────────
function loadObj(text, varName) {
  const marker = `${varName} = {`;
  const start  = text.indexOf(marker);
  if (start === -1) return {};
  const objStart = start + marker.length - 1;
  let depth = 0, i = objStart;
  while (i < text.length) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) break; }
    i++;
  }
  return new Function('"use strict"; return (' + text.slice(objStart, i + 1) + ')')();
}
const kjText           = readFileSync(join(ROOT, 'src', 'kanji.js'), 'utf8');
const EXAMPLE_OVERRIDE = loadObj(kjText, 'EXAMPLE_OVERRIDE');
const WORD_READING     = {};
for (const [, words] of Object.entries(EXAMPLE_OVERRIDE)) {
  for (const { w, r } of words) { if (!WORD_READING[w]) WORD_READING[w] = r; }
}

// ── Kuromoji ──────────────────────────────────────────────────────────────────
const kuromoji     = require('kuromoji');
const KUROMOJI_DIC = join(ROOT, 'node_modules', 'kuromoji', 'dict');
let _tok = null;
async function getTokenizer() {
  if (_tok) return _tok;
  return new Promise((res, rej) =>
    kuromoji.builder({ dicPath: KUROMOJI_DIC }).build((e, t) => e ? rej(e) : res(_tok = t)));
}
const kata2hira = s => s.replace(/[\u30A1-\u30F6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
async function getReading(word) {
  if (WORD_READING[word]) return WORD_READING[word];
  const t = await getTokenizer();
  return kata2hira(t.tokenize(word).map(tok => tok.reading || tok.surface_form).join(''));
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Add furigana (ruby annotations) to all kanji in the sentence, except the target word.
async function toFuriganaHTML(sentence, targetWord) {
  const t = await getTokenizer();
  const tokens = t.tokenize(sentence);
  const esc = targetWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const targetRe = new RegExp(esc);
  const parts = [];
  for (const tok of tokens) {
    const surface = tok.surface_form;
    const reading = tok.reading;
    const hasKanji = /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(surface);
    if (targetRe.test(surface)) {
      // Target word — highlight, no furigana needed (user just learned it)
      parts.push(surface.replace(new RegExp(esc, 'g'), `<span class="hl">${escHtml(targetWord)}</span>`));
    } else if (hasKanji && reading) {
      const hira = kata2hira(reading);
      if (hira === surface) {
        parts.push(escHtml(surface));
      } else {
        parts.push(`<ruby><rb>${escHtml(surface)}</rb><rt>${escHtml(hira)}</rt></ruby>`);
      }
    } else {
      parts.push(escHtml(surface));
    }
  }
  return parts.join('');
}

// ── Python / edge-tts / ffmpeg ────────────────────────────────────────────────
function findPython() {
  const store = 'C:\\Users\\Charles\\AppData\\Local\\Microsoft\\WindowsApps\\python3.13.exe';
  if (existsSync(store)) return store;
  for (const cmd of ['python3', 'python'])
    if (spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0) return cmd;
  throw new Error('Python introuvable.');
}
const PYTHON  = findPython();
const FFMPEG  = (() => { const p = join(ROOT, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'); return existsSync(p) ? p : 'ffmpeg'; })();
const FFPROBE = (() => { try { return require('ffprobe-static').path; } catch {} return FFMPEG.replace('ffmpeg.exe', 'ffprobe.exe'); })();

// ── TTS ───────────────────────────────────────────────────────────────────────
async function tts(text, outMp3) {
  const wav = outMp3.replace(/\.mp3$/, '.wav');
  const r = spawnSync(PYTHON, ['-m', 'edge_tts', '--voice', VOICE, '--text', text, '--write-media', wav],
    { encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) throw new Error(`edge-tts failed: ${r.stderr}`);
  spawnSync(FFMPEG, ['-y', '-i', wav, '-codec:a', 'libmp3lame', '-q:a', '2', outMp3], { stdio: 'ignore' });
  try { unlinkSync(wav); } catch {}
}

// ── Audio helpers ─────────────────────────────────────────────────────────────
function silence(out, dur) {
  spawnSync(FFMPEG, ['-y', '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo',
    '-codec:a', 'libmp3lame', '-q:a', '2', out], { stdio: 'ignore' });
}
function padAudio(inp, out, dur) {
  spawnSync(FFMPEG, ['-y', '-i', inp, '-af', `apad=whole_dur=${dur}`, '-t', String(dur),
    '-codec:a', 'libmp3lame', '-q:a', '2', out], { stdio: 'ignore' });
}
function prependSilence(inp, out, sec) {
  const sil = out + '.sil.mp3', lst = out + '.lst';
  silence(sil, sec);
  writeFileSync(lst, `file '${sil.replace(/\\/g,'/')}'\nfile '${inp.replace(/\\/g,'/')}'`, 'utf8');
  spawnSync(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', lst,
    '-codec:a', 'libmp3lame', '-q:a', '2', out], { stdio: 'ignore' });
  try { unlinkSync(sil); } catch {}
  try { unlinkSync(lst); } catch {}
}

// ── Video helpers ─────────────────────────────────────────────────────────────
function imageToVideo(img, audio, out, dur) {
  spawnSync(FFMPEG, ['-y',
    '-loop', '1', '-i', img, '-i', audio,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-profile:v', 'baseline', '-level', '4.0', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart', '-t', String(dur),
    '-vf', 'scale=1080:1920,setsar=1', '-r', '30', out,
  ], { stdio: 'ignore' });
}

// CTA — même fond rouge que les autres slides
function slideCTA() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box;}html,body{width:1080px;height:1920px;overflow:hidden;}
body{background:linear-gradient(160deg,#c03a20 0%,#8b2510 100%);font-family:'Noto Sans JP',sans-serif;display:flex;flex-direction:column;align-items:center;}
.hd{width:100%;height:112px;flex-shrink:0;display:flex;align-items:center;justify-content:center;gap:18px;padding:0 52px;border-bottom:1px solid rgba(255,255,255,0.10);}
.ht{color:rgba(255,255,255,0.70);font-size:32px;font-weight:700;}
.body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 80px;text-align:center;gap:48px;}
.msg{color:#fff;font-size:72px;font-weight:900;line-height:1.25;}
.link{color:rgba(255,255,255,0.70);font-size:44px;font-weight:400;letter-spacing:2px;border-bottom:2px solid rgba(255,255,255,0.30);padding-bottom:6px;}
</style><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&display=swap" rel="stylesheet">
</head><body>
<div class="hd"><img src="${LOGO_B64}" width="58" height="58" style="border-radius:50%;flex-shrink:0;" alt=""><span class="ht">Asa no Kanji</span></div>
<div class="body">
  <div class="msg">Make Japanese part of your daily routine.</div>
  <div class="link">asanokanji.com</div>
</div>
</body></html>`;
}

// Concat avec xfade entre tous les segments
function concatXFade(segments, durations, out, xf = 0.5) {
  const n = segments.length;
  let t = 0;
  const offsets = durations.slice(0, n - 1).map((d, i) => {
    const o = +(t + d - xf).toFixed(3); t += d - xf; return o;
  });
  const vParts = [], aParts = [];
  let vPrev = '0:v', aPrev = '0:a';
  for (let i = 1; i < n; i++) {
    const vOut = i === n - 1 ? 'vout' : `v${i}`;
    const aOut = i === n - 1 ? 'aout' : `a${i}`;
    vParts.push(`[${vPrev}][${i}:v]xfade=transition=fade:duration=${xf}:offset=${offsets[i-1]}[${vOut}]`);
    aParts.push(`[${aPrev}][${i}:a]acrossfade=d=${xf}[${aOut}]`);
    vPrev = vOut; aPrev = aOut;
  }
  const r = spawnSync(FFMPEG, [
    '-y', ...segments.flatMap(s => ['-i', s]),
    '-filter_complex', [...vParts, ...aParts].join(';'),
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-profile:v', 'baseline', '-level', '4.0', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart', out,
  ], { stdio: 'ignore' });
  if (r.status !== 0) throw new Error(`concatXFade failed (status=${r.status})`);
}

// Fade to black sur les N dernières secondes
function applyFadeOut(inp, out, videoDur, fadeDur = 1.5) {
  const st = +(videoDur - fadeDur).toFixed(3);
  const r = spawnSync(FFMPEG, ['-y', '-i', inp,
    '-vf', `fade=t=out:st=${st}:d=${fadeDur}`,
    '-af', `afade=t=out:st=${st}:d=${fadeDur}`,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-profile:v', 'baseline', '-level', '4.0', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart', out,
  ], { stdio: 'ignore' });
  if (r.status !== 0) throw new Error('applyFadeOut failed');
}

// ── Tatoeba ───────────────────────────────────────────────────────────────────
// Patterns suggestifs/crus à exclure
const BLOCKLIST = /寝た|寝る|殺|死ん|殴|暴力|セックス|裸|下着|酔っ|クソ|バカ|馬鹿|ふざけ/;
// Terminaisons desu/masu (forme polie)
const POLITE_END = /(ます|ました|ません|ませんでした|です|でした|でしょう|ますか|ですか|ましょう)。?$/u;

async function fetchExample(word) {
  try {
    const url = `https://tatoeba.org/api_v0/search?query=${encodeURIComponent(word)}&from=jpn&to=eng&limit=50&sort=relevance`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const candidates = [];
    for (const s of (data.results || [])) {
      const jp = s.text?.trim(), en = s.translations?.[0]?.[0]?.text?.trim();
      if (!jp || !en || !jp.includes(word)) continue;
      if (jp.length > 45 || jp.replace(/[。！？\s、]/g, '').length < 5) continue;
      if (BLOCKLIST.test(jp)) continue;
      candidates.push({ jp, en, polite: POLITE_END.test(jp) });
    }
    // Priorité : desu/masu d'abord, puis n'importe quelle phrase valide
    const polite = candidates.find(c => c.polite);
    return polite || candidates[0] || null;
  } catch {}
  return null;
}

// ── HTML slides ───────────────────────────────────────────────────────────────
// Hook
function slideHook() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box;}html,body{width:1080px;height:1920px;overflow:hidden;}
body{background:linear-gradient(160deg,#c03a20 0%,#8b2510 100%);font-family:'Noto Sans JP',sans-serif;display:flex;flex-direction:column;align-items:center;}
.hd{width:100%;height:112px;flex-shrink:0;display:flex;align-items:center;justify-content:center;gap:18px;padding:0 52px;border-bottom:1px solid rgba(255,255,255,0.10);}
.ht{color:rgba(255,255,255,0.70);font-size:32px;font-weight:700;}
.body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 80px;text-align:center;}
.q{color:#fff;font-size:96px;font-weight:900;line-height:1.1;margin-bottom:40px;}
.sub{color:rgba(255,255,255,0.40);font-size:42px;font-weight:400;letter-spacing:3px;}
</style><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&display=swap" rel="stylesheet">
</head><body>
<div class="hd"><img src="${LOGO_B64}" width="58" height="58" style="border-radius:50%;flex-shrink:0;" alt=""><span class="ht">Asa no Kanji</span></div>
<div class="body"><div class="q">A very common<br>Japanese word...</div></div>
</body></html>`;
}

// ── PROG SLIDES — layout fixe, visibility:hidden pour éléments non encore révélés ──
// showReading / showMeaning / showExample contrôlent la visibilité SANS changer la géométrie.
function buildProgSlide({ word, reading, def, jpH, exJp, exEn, showReading, showMeaning, showExample }) {
  const wfs  = Math.min(160, Math.max(96, Math.floor(480 / Math.max(word.length, 1))));
  const jraw = (exJp || '').replace(/[。、！？\s]/g, '');
  const jfs  = Math.min(52, Math.max(30, Math.floor(900 / Math.max(jraw.length, 1))));
  const enS  = (exEn || '').length > 65 ? (exEn || '').slice(0, 63) + '...' : (exEn || '');
  const _jpH = jpH || escHtml(exJp || '');

  const h = v => v ? '' : 'visibility:hidden;';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box;}html,body{width:1080px;height:1920px;overflow:hidden;}
body{background:linear-gradient(160deg,#c03a20 0%,#8b2510 100%);font-family:'Noto Sans JP',sans-serif;display:flex;flex-direction:column;align-items:center;}
.hd{width:100%;height:112px;flex-shrink:0;display:flex;align-items:center;justify-content:center;gap:18px;padding:0 52px;border-bottom:1px solid rgba(255,255,255,0.10);}
.ht{color:rgba(255,255,255,0.70);font-size:32px;font-weight:700;}
.body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 72px;text-align:center;}
.lbl{color:rgba(255,255,255,0.38);font-size:28px;font-weight:700;letter-spacing:4px;text-transform:uppercase;margin-bottom:24px;}
.w{color:#fff;font-size:${wfs}px;font-weight:900;line-height:1;margin-bottom:20px;}
.r{color:rgba(255,255,255,0.65);font-size:56px;font-weight:400;letter-spacing:5px;margin-bottom:40px;${h(showReading)}}
.div{width:64px;height:3px;background:rgba(255,255,255,0.20);border-radius:2px;margin-bottom:32px;${h(showMeaning)}}
.mlbl{color:rgba(255,255,255,0.36);font-size:26px;font-weight:700;letter-spacing:4px;text-transform:uppercase;margin-bottom:16px;${h(showMeaning)}}
.def{color:#fff;font-size:62px;font-weight:800;line-height:1.2;text-align:center;margin-bottom:44px;${h(showMeaning)}}
.exlbl{color:rgba(255,255,255,0.36);font-size:24px;font-weight:700;letter-spacing:3px;text-transform:uppercase;margin-bottom:16px;${h(showExample)}}
.bubble{background:rgba(255,255,255,0.09);border:1.5px solid rgba(255,255,255,0.14);border-radius:24px;padding:40px 56px;width:100%;${h(showExample)}}
.jp{color:#fff;font-size:${jfs}px;font-weight:700;line-height:2.4;margin-bottom:16px;}
ruby{ruby-align:center;}rt{font-size:0.42em;font-weight:400;color:rgba(255,255,255,0.60);}
.hl{color:#ffe0b2;font-weight:900;}
.en{color:rgba(255,255,255,0.45);font-size:30px;font-weight:400;line-height:1.5;font-style:italic;}
</style><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&display=swap" rel="stylesheet">
</head><body>
<div class="hd"><img src="${LOGO_B64}" width="58" height="58" style="border-radius:50%;flex-shrink:0;" alt=""><span class="ht">Asa no Kanji</span></div>
<div class="body">
  <div class="lbl">Today's word</div>
  <div class="w">${word}</div>
  <div class="r">${reading}</div>
  <div class="div"></div>
  <div class="mlbl">Meaning</div>
  <div class="def">${def}</div>
  <div class="exlbl">Example</div>
  <div class="bubble">
    <div class="jp">${_jpH}</div>
    ${enS ? `<div class="en">${enS}</div>` : ''}
  </div>
</div>
</body></html>`;
}

// ── Playwright ────────────────────────────────────────────────────────────────
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
const ctx     = await browser.newContext({ deviceScaleFactor: 2 });
const pg      = await ctx.newPage();

async function renderSlide(html, outPng) {
  const tmp = outPng.replace(/\.png$/, '_tmp.html');
  writeFileSync(tmp, html, 'utf8');
  await pg.setViewportSize({ width: 1080, height: 1920 });
  await pg.goto(`file:///${tmp.replace(/\\/g, '/')}`, { waitUntil: 'load', timeout: 30000 });
  await pg.waitForTimeout(800);
  await pg.screenshot({ path: outPng, clip: { x: 0, y: 0, width: 1080, height: 1920 } });
  unlinkSync(tmp);
}

// ── JLPT kanji list ──────────────────────────────────────────────────────────
async function fetchJLPTKanji(level) {
  const num = parseInt(level.replace('n', ''), 10);
  const res = await fetch(`https://kanjiapi.dev/v1/kanji/jlpt-${num}`);
  if (!res.ok) throw new Error(`kanjiapi.dev jlpt-${num}: HTTP ${res.status}`);
  return await res.json(); // array of kanji strings
}

// ── Build target word list ────────────────────────────────────────────────────
let targetWords = [];
if (CUSTOM_WORDS) {
  targetWords = CUSTOM_WORDS.split(',').map(w => w.trim()).filter(Boolean);
} else if (FROM_KANJI) {
  for (const k of FROM_KANJI.split(',').map(k => k.trim()))
    for (const { w } of (EXAMPLE_OVERRIDE[k] || []).slice(0, 2))
      if (w && !targetWords.includes(w)) targetWords.push(w);
} else {
  // Frequency-based: mots les plus courants du japonais quotidien (corpus FREQ)
  const freqRaw  = readFileSync(join(ROOT, 'src', 'freq.js'), 'utf8');
  // freq.js exporte "export const FREQ = {...}" — on extrait l'objet littéral directement
  const freqMatch = freqRaw.match(/FREQ\s*=\s*(\{[\s\S]*?\});/);
  const FREQ_MAP  = freqMatch ? new Function('return (' + freqMatch[1] + ')')() : {};
  const sorted   = Object.entries(FREQ_MAP)
    .sort((a, b) => a[1] - b[1])
    .map(([w]) => w);
  for (const w of sorted) {
    if (targetWords.length >= COUNT) break;
    if (w.length < 2) continue;
    if (!JMDICT[w]) continue;
    if (!/[\u3040-\u9fff]/.test(w)) continue; // doit contenir du japonais
    targetWords.push(w);
  }
}

if (targetWords.length === 0) {
  console.error('Aucun mot. Utilise --words, --from-kanji ou --level.');
  await browser.close(); process.exit(1);
}
console.log(`\nVocab Reels — ${targetWords.length} mot(s): ${targetWords.join(' ')}\n`);

if (DRY_RUN) {
  for (const w of targetWords) {
    const t = JMDICT[w];
    console.log(`  ${w}  ${WORD_READING[w] || '?'}  — ${t?.en?.split(',').slice(0,2).join(', ') || '?'}`);
  }
  await browser.close(); process.exit(0);
}

// ── CTA check ─────────────────────────────────────────────────────────────────
const CTA_FILE = join(ROOT, 'kanji-cards', 'CTA_Footage.mp4');
if (!existsSync(CTA_FILE)) {
  console.error('kanji-cards/CTA_Footage.mp4 manquant');
  await browser.close(); process.exit(1);
}

// ── Timing ────────────────────────────────────────────────────────────────────
//  D[i] = durée visible de chaque segment
const D  = [3, 3, 3, 4, 6, 7]; // hook, A, B, C, D, CTA
const XF = 0.5;                  // xfade entre tous les segments (smooth)
const FADE_OUT_DUR = 1.5;        // fondu noir final sur CTA
// durée réelle de chaque segment encodé (inclut overlap sortant sauf dernier)
const BRUTS = D.map((d, i) => i < D.length - 1 ? d + XF : d);
// durée totale du concat après xfades
const CONCAT_DUR = D.reduce((a, b) => a + b, 0) - (D.length - 1) * XF;

// ── Main loop ─────────────────────────────────────────────────────────────────
let ok = 0;

for (const word of targetWords) {
  const outFile = join(OUT_DIR, `${word}.mp4`);
  if (existsSync(outFile)) { console.log(`   ${word} — skip`); ok++; continue; }

  console.log(`Processing ${word}...`);
  try {
    const reading = await getReading(word);
    const def     = (JMDICT[word]?.en || word).split(',').slice(0, 3).join(', ');
    console.log(`   ${reading}  —  ${def}`);

    const example = await fetchExample(word);
    const exJp = example?.jp || `${word}を使った文です。`;
    const exEn = example?.en || '';
    console.log(`   ex: ${exJp}`);
    const jpH = await toFuriganaHTML(exJp, word);

    // TTS
    console.log('   TTS...');
    const mp3w1 = join(TMP, `${word}_w1.mp3`);
    const mp3w2 = join(TMP, `${word}_w2.mp3`);
    const mp3ex = join(TMP, `${word}_ex.mp3`);
    await tts(word, mp3w1);
    await tts(word, mp3w2);
    await tts(exJp, mp3ex);

    // Audio per segment
    const a0 = join(TMP, `${word}_a0.mp3`); silence(a0, BRUTS[0]);

    const a1pre = join(TMP, `${word}_a1pre.mp3`);
    const a1    = join(TMP, `${word}_a1.mp3`);
    prependSilence(mp3w1, a1pre, 0.3); padAudio(a1pre, a1, BRUTS[1]);

    const a2pre = join(TMP, `${word}_a2pre.mp3`);
    const a2    = join(TMP, `${word}_a2.mp3`);
    prependSilence(mp3w2, a2pre, 0.3); padAudio(a2pre, a2, BRUTS[2]);

    const a3 = join(TMP, `${word}_a3.mp3`); silence(a3, BRUTS[3]);

    const a4pre = join(TMP, `${word}_a4pre.mp3`);
    const a4    = join(TMP, `${word}_a4.mp3`);
    prependSilence(mp3ex, a4pre, 0.6); padAudio(a4pre, a4, BRUTS[4]);

    // Prog slide params (même layout, visibilité variable)
    const progBase = { word, reading, def, jpH, exJp, exEn };

    // Render slides
    console.log('   slides...');
    const p = n => join(TMP, `${word}_p${n}.png`);
    await renderSlide(slideHook(), p(0));
    await renderSlide(buildProgSlide({ ...progBase, showReading: false, showMeaning: false, showExample: false }), p(1)); // A
    await renderSlide(buildProgSlide({ ...progBase, showReading: true,  showMeaning: false, showExample: false }), p(2)); // B
    await renderSlide(buildProgSlide({ ...progBase, showReading: true,  showMeaning: true,  showExample: false }), p(3)); // C
    await renderSlide(buildProgSlide({ ...progBase, showReading: true,  showMeaning: true,  showExample: true  }), p(4)); // D

    await renderSlide(slideCTA(), p(5));

    // Build video segments
    console.log('   video...');
    const s = n => join(TMP, `${word}_s${n}.mp4`);
    imageToVideo(p(0), a0, s(0), BRUTS[0]);
    imageToVideo(p(1), a1, s(1), BRUTS[1]);
    imageToVideo(p(2), a2, s(2), BRUTS[2]);
    imageToVideo(p(3), a3, s(3), BRUTS[3]);
    imageToVideo(p(4), a4, s(4), BRUTS[4]);
    const a5 = join(TMP, `${word}_a5.mp3`); silence(a5, BRUTS[5]);
    imageToVideo(p(5), a5, s(5), BRUTS[5]);

    // Concat xfade
    const afterConcat = join(TMP, `${word}_concat.mp4`);
    concatXFade([s(0),s(1),s(2),s(3),s(4),s(5)], BRUTS, afterConcat, XF);

    // BGM mix (optionnel)
    const afterBgm = BGM_VOL > 0 ? join(TMP, `${word}_bgm.mp4`) : afterConcat;
    if (BGM_VOL > 0) {
      const bgmFile = join(ROOT, 'vocab-cards', 'BGM_Vocab.mp3');
      if (!existsSync(bgmFile)) throw new Error('vocab-cards/BGM_Vocab.mp3 manquant');
      const r = spawnSync(FFMPEG, ['-y',
        '-i', afterConcat, '-stream_loop', '-1', '-i', bgmFile, '-t', String(CONCAT_DUR),
        '-filter_complex',
        `[1:a]volume=${BGM_VOL},afade=t=in:st=0:d=1.5,afade=t=out:st=${CONCAT_DUR-2}:d=2[bgm];` +
        `[0:a][bgm]amix=inputs=2:duration=first:normalize=0[aout]`,
        '-map', '0:v', '-map', '[aout]',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
        '-movflags', '+faststart', afterBgm,
      ], { stdio: 'ignore' });
      if (r.status !== 0) throw new Error('BGM mix failed');
      try { if (afterConcat !== afterBgm) unlinkSync(afterConcat); } catch {}
    }

    // Fade to black final
    applyFadeOut(afterBgm, outFile, CONCAT_DUR, FADE_OUT_DUR);
    try { unlinkSync(afterBgm); } catch {}

    // Cleanup
    for (const f of [
      mp3w1, mp3w2, mp3ex,
      a0, a1pre, a1, a2pre, a2, a3, a4pre, a4,
      p(0), p(1), p(2), p(3), p(4),
      s(0), s(1), s(2), s(3), s(4), s(5),
    ]) { try { unlinkSync(f); } catch {} }

    console.log(`OK ${word} -> vocab-cards/reels/${word}.mp4`);
    ok++;
  } catch (e) {
    console.error(`ERROR ${word}: ${e.message}`);
  }
}

await browser.close();
try { require('fs').rmdirSync(TMP); } catch {}
console.log(`\n${ok}/${targetWords.length} reels generes — vocab-cards/reels/\n`);
