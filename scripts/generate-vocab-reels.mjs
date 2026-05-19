/**
 * generate-vocab-reels.mjs
 *
 * Reels "Mot du jour" 窶・design progressif, positions FIXES :
 *   [0-3s]   Hook   窶・"A very common Japanese word..."
 *   [3-7s]   Prog A 窶・mot seul  (lecture/def/ex : visibility:hidden)
 *   [7-11s]  Prog B 窶・+ lecture  (def/ex : visibility:hidden)
 *   [11-17s] Prog C 窶・+ dﾃｩfinition  (ex : visibility:hidden)
 *   [17-27s] Prog D 窶・tout visible
 *   [27-34s] CTA    窶・identique kanji reels, fade out final
 *
 * Clﾃｩ du design : tous les prog slides partagent le Mﾃ凱E layout fixe.
 * Les ﾃｩlﾃｩments non encore rﾃｩvﾃｩlﾃｩs ont visibility:hidden (espace rﾃｩservﾃｩ).
 * 竊・aucun dﾃｩplacement lors des transitions.
 *
 * Usage :
 *   node scripts/generate-vocab-reels.mjs --words 鬟溘∋迚ｩ
 *   node scripts/generate-vocab-reels.mjs --from-kanji 鬟・鬟ｲ,蟄ｦ
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

// 笏笏 CLI 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
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

// 笏笏 Paths 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
const OUT_DIR = join(ROOT, 'vocab-cards', 'reels');
const TMP     = join(ROOT, '.vocab-tmp');
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(TMP,     { recursive: true });

// 笏笏 Data 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
const JMDICT   = JSON.parse(readFileSync(join(ROOT, 'public', 'jmdict_trans.json'), 'utf8'));
const LOGO_B64 = `data:image/png;base64,${readFileSync(join(ROOT, 'SVG', 'Logo_192.png')).toString('base64')}`;

// 笏笏 EXAMPLE_OVERRIDE 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
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

// ── sentences.json (AI-generated, furigana-verified) ─────────────────────────
let SENTENCES_JSON = {};
try {
  SENTENCES_JSON = JSON.parse(readFileSync(join(ROOT, 'public', 'sentences.json'), 'utf8'));
} catch { /* optional */ }

// 笏笏 Kuromoji 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
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
      // Target word 窶・highlight, no furigana needed (user just learned it)
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

// 笏笏 Python / edge-tts / ffmpeg 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
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

// 笏笏 TTS 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
async function tts(text, outMp3) {
  const wav = outMp3.replace(/\.mp3$/, '.wav');
  const r = spawnSync(PYTHON, ['-m', 'edge_tts', '--voice', VOICE, '--text', text, '--write-media', wav],
    { encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) throw new Error(`edge-tts failed: ${r.stderr}`);
  spawnSync(FFMPEG, ['-y', '-i', wav, '-codec:a', 'libmp3lame', '-q:a', '2', outMp3], { stdio: 'ignore' });
  try { unlinkSync(wav); } catch {}
}

// 笏笏 Audio helpers 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
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

// 笏笏 Video helpers 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
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

// CTA 窶・mﾃｪme fond rouge que les autres slides
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

// Fade to black sur les N derniﾃｨres secondes
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

// 笏笏 Dictionary forms for verb/adj stems from FREQ_MAP 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
const WORD_DICT_FORM = {
  '蛻・°':   '蛻・°繧・,
  '蜃ｺ譚･':   '蜃ｺ譚･繧・,
  '謨吶∴':   '謨吶∴繧・,
  '蜈･繧・:   '蜈･繧後ｋ',
  '陦後￠':   '陦後￥',
  '逕溘″':   '逕溘″繧・,
  '豁｢繧・:   '豁｢繧√ｋ',
  '騾｣繧・:   '騾｣繧後ｋ',
  '襍ｷ縺・:   '襍ｷ縺阪ｋ',
  '襍ｷ縺・:   '襍ｷ縺薙ｋ',
  '鬟溘∋':   '鬟溘∋繧・,
  '邯壹￠':   '邯壹￠繧・,
  '蟋九ａ':   '蟋九ａ繧・,
  '隱ｿ縺ｹ':   '隱ｿ縺ｹ繧・,
  '荳九＆':   '縺上□縺輔＞',
  '讌ｽ縺・:   '讌ｽ縺励＞',
  '諢溘§':   '諢溘§繧・,
  '螟峨ｏ':   '螟峨ｏ繧・,
  '閨槭％縺・: '閨槭％縺医ｋ',
  '荳弱∴':   '荳弱∴繧・,
  '髢九￠':   '髢九￠繧・,
  '髮｢繧・:   '髮｢繧後ｋ',
};

// 笏笏 Definition overrides (fix bad/inappropriate JMDICT entries) 笏笏笏笏笏笏笏笏笏笏笏笏笏笏
const WORD_DEF_OVERRIDE = {
  '諱ｯ蟄・: 'son',
  '莉ｲ髢・: 'companion, colleague, fellow',
};

// 笏笏 Curated desu/masu sentences (priority over Tatoeba) 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
const VOCAB_SENTENCE_OVERRIDE = {
  '蠖ｼ螂ｳ':   { jp: '蠖ｼ螂ｳ縺ｯ遘√・蜿矩＃縺ｧ縺吶・,           en: 'She is my friend.' },
  '縺雁燕':   { jp: '縺雁燕縺ｮ縺薙→縺悟ｿ・・縺ｧ縺吶・,           en: "I'm worried about you." },
  '蛻・°':   { jp: '蟆代＠蛻・°繧翫∪縺吶・,                en: 'I understand a little.' },
  '蠢・ｦ・:   { jp: '繝代せ繝昴・繝医′蠢・ｦ√〒縺吶・,           en: 'A passport is necessary.' },
  '螟ｧ荳亥､ｫ': { jp: '螟ｧ荳亥､ｫ縺ｧ縺吶°縲・,                  en: 'Are you alright?' },
  '閾ｪ蛻・:   { jp: '閾ｪ蛻・〒繧・ｊ縺ｾ縺吶・,                en: "I'll do it myself." },
  '譛ｬ蠖・:   { jp: '譛ｬ蠖薙〒縺吶°縲・,                    en: 'Really?' },
  '譎る俣':   { jp: '譎る俣縺後≠繧翫∪縺吶°縲・,              en: 'Do you have time?' },
  '謌代・:   { jp: '謌代・・荳邱偵↓陦後″縺ｾ縺吶・,           en: "We'll go together." },
  '莉穂ｺ・:   { jp: '莉穂ｺ九〒譌･譛ｬ縺ｫ譚･縺ｾ縺励◆縲・,           en: 'I came to Japan for work.' },
  '荳邱・:   { jp: '荳邱偵↓陦後″縺ｾ縺励ｇ縺・・,            en: "Let's go together." },
  '蜃ｺ譚･':   { jp: '莠育ｴ・′蜃ｺ譚･縺ｾ縺吶・,                en: 'A reservation is possible.' },
  '髮ｻ隧ｱ':   { jp: '髮ｻ隧ｱ縺励※繧ゅ＞縺・〒縺吶°縲・,           en: 'May I call you?' },
  '蜷後§':   { jp: '蜷後§繧ゅ・繧偵￥縺縺輔＞縲・,            en: 'Please give me the same thing.' },
  '蝣ｴ謇':   { jp: '縺薙・蝣ｴ謇縺ｯ髱吶°縺ｧ縺吶・,            en: 'This place is quiet.' },
  '蝠城｡・:   { jp: '蝠城｡後≠繧翫∪縺帙ｓ縲・,                en: 'No problem.' },
  '蟄蝉ｾ・:   { jp: '蟄蝉ｾ帙′莠御ｺｺ縺・∪縺吶・,              en: 'I have two children.' },
  '蜷榊燕':   { jp: '縺雁錐蜑阪・菴輔〒縺吶°縲・,              en: 'What is your name?' },
  '蟆代＠':   { jp: '蟆代＠蠕・▲縺ｦ縺上□縺輔＞縲・,            en: 'Please wait a little.' },
  '蜈ｨ縺ｦ':   { jp: '蜈ｨ縺ｦ繧上°繧翫∪縺励◆縲・,              en: 'I understand everything.' },
  '荳也阜':   { jp: '荳也阜荳ｭ繧呈羅縺励◆縺・〒縺吶・,           en: 'I want to travel the whole world.' },
  '謨吶∴':   { jp: '驕薙ｒ謨吶∴縺ｦ縺上□縺輔＞縲・,            en: 'Please tell me the way.' },
  '騾壹ｊ':   { jp: '縺薙・騾壹ｊ繧堤悄縺｣逶ｴ縺占｡後″縺ｾ縺吶・,    en: 'Go straight down this street.' },
  '譚･繧・:   { jp: '蜿矩＃縺梧擂縺ｾ縺吶・,                  en: 'My friend is coming.' },
  '蜈･繧・:   { jp: '闕ｷ迚ｩ繧偵％縺薙↓蜈･繧後※縺上□縺輔＞縲・,    en: 'Please put your luggage here.' },
  '莠ｺ髢・:   { jp: '莠ｺ髢薙・險闡峨ｒ菴ｿ縺・∪縺吶・,          en: 'Humans use language.' },
  '陦後￠':   { jp: '莉翫☆縺占｡後￠縺ｾ縺吶°縲・,              en: 'Can you go right now?' },
  '莉頑律':   { jp: '莉頑律縺ｯ縺・＞螟ｩ豌励〒縺吶・,            en: 'The weather is nice today.' },
  '逕溘″':   { jp: '豈取律讌ｽ縺励￥逕溘″縺ｦ縺・∪縺吶・,        en: "I'm living happily every day." },
  '豁｢繧・:   { jp: '縺薙％縺ｧ豁｢繧√※縺上□縺輔＞縲・,          en: 'Please stop here.' },
  '蠢・・':   { jp: '蠢・・縺励↑縺・〒縺上□縺輔＞縲・,          en: "Please don't worry." },
  '騾｣繧・:   { jp: '蜿矩＃繧帝｣繧後※縺阪∪縺吶・,            en: "I'll bring a friend along." },
  '髢｢菫・:   { jp: '遘√◆縺｡縺ｯ縺・＞髢｢菫ゅ〒縺吶・,          en: 'We have a good relationship.' },
  '螳ｶ譌・:   { jp: '螳ｶ譌上→譌・｡後＠縺ｾ縺吶・,              en: "I'm traveling with my family." },
  '襍ｷ縺・:   { jp: '豈取悃蜈ｭ譎ゅ↓襍ｷ縺阪∪縺吶・,            en: 'I wake up at six every morning.' },
  '諢丞袖':   { jp: '縺薙・險闡峨・諢丞袖縺ｯ菴輔〒縺吶°縲・,      en: 'What does this word mean?' },
  '隴ｦ蟇・:   { jp: '隴ｦ蟇溘↓騾｣邨｡縺励∪縺吶・,              en: "I'll contact the police." },
  '譛蠕・:   { jp: '譛蠕後・髮ｻ霆翫↓荵励ｊ縺ｾ縺吶・,          en: "I'll take the last train." },
  '諱ｯ蟄・:   { jp: '諱ｯ蟄舌・蟄ｦ譬｡縺ｫ陦後▲縺ｦ縺・∪縺吶・,      en: 'My son is at school.' },
  '蜈ｨ驛ｨ':   { jp: '蜈ｨ驛ｨ縺ｧ縺・￥繧峨〒縺吶°縲・,            en: 'How much is it in total?' },
  '謐懈渊':   { jp: '隴ｦ蟇溘′謐懈渊縺励※縺・∪縺吶・,          en: 'The police are investigating.' },
  '襍ｷ縺・:   { jp: '譛昴∫ｧ√ｒ襍ｷ縺薙＠縺ｦ縺上□縺輔＞縲・,      en: 'Please wake me up in the morning.' },
  '諢溘§':   { jp: '縺・＞諢溘§縺ｧ縺吶・,                  en: 'It feels good.' },
  '諠・ｱ':   { jp: '諠・ｱ繧偵≠繧翫′縺ｨ縺・＃縺悶＞縺ｾ縺吶・,    en: 'Thank you for the information.' },
  '逅・罰':   { jp: '逅・罰繧呈蕗縺医※縺上□縺輔＞縲・,          en: 'Please tell me the reason.' },
  '荳莠ｺ':   { jp: '荳莠ｺ縺ｧ譚･縺ｾ縺励◆縲・,                en: 'I came alone.' },
  '驛ｨ螻・:   { jp: '驛ｨ螻九・縺阪ｌ縺・〒縺吶・,              en: 'The room is clean.' },
  '莉･荳・:   { jp: '隱ｬ譏弱・莉･荳翫〒縺吶・,                en: "That's all for the explanation." },
  '莠ｺ逕・:   { jp: '莠ｺ逕溘・遏ｭ縺・〒縺吶・,                en: 'Life is short.' },
  '鬟溘∋':   { jp: '豈取律縺秘｣ｯ繧帝｣溘∋縺ｾ縺吶・,            en: 'I eat rice every day.' },
  '螂ｳ諤ｧ':   { jp: '縺ゅ・螂ｳ諤ｧ縺ｯ蜈育函縺ｧ縺吶・,            en: 'That woman is a teacher.' },
  '邯壹￠':   { jp: '豈取律邱ｴ鄙偵ｒ邯壹￠縺ｾ縺吶・,            en: "I'll keep practicing every day." },
  '莠倶ｻｶ':   { jp: '莠倶ｻｶ縺瑚ｵｷ縺阪∪縺励◆縲・,              en: 'An incident occurred.' },
  '蟋九ａ':   { jp: '譌･譛ｬ隱槭・蜍牙ｼｷ繧貞ｧ九ａ縺ｾ縺励◆縲・,      en: 'I started studying Japanese.' },
  '譛蛻・:   { jp: '譛蛻昴・繧縺壹°縺励＞縺ｧ縺吶・,          en: "It's difficult at first." },
  '騾｣邨｡':   { jp: '蠕後〒騾｣邨｡縺励∪縺吶・,                en: "I'll contact you later." },
  '隱ｿ縺ｹ':   { jp: '繧､繝ｳ繧ｿ繝ｼ繝阪ャ繝医〒隱ｿ縺ｹ縺ｾ縺吶・,      en: "I'll look it up on the internet." },
  '螳牙・':   { jp: '縺薙％縺ｯ螳牙・縺ｧ縺吶・,                en: "It's safe here." },
  '荳九＆':   { jp: '繧ゅ≧蟆代＠蠕・▲縺ｦ荳九＆縺・・,          en: 'Please wait a little longer.' },
  '讌ｽ縺・:   { jp: '譌・｡後・縺ｨ縺ｦ繧よ･ｽ縺励°縺｣縺溘〒縺吶・,    en: 'The trip was very enjoyable.' },
  '谿ｺ莠ｺ':   { jp: '谿ｺ莠ｺ莠倶ｻｶ縺ｮ繝九Η繝ｼ繧ｹ繧定ｦ九∪縺励◆縲・,  en: 'I saw news of a murder case.' },
  '蜿矩＃':   { jp: '蜿矩＃縺ｨ隧ｱ縺励※縺・∪縺吶・,            en: "I'm talking with a friend." },
  '邏・據':   { jp: '邏・據繧貞ｮ医ｊ縺ｾ縺吶・,                en: "I'll keep my promise." },
  '邨仙ｩ・:   { jp: '譚･蟷ｴ邨仙ｩ壹＠縺ｾ縺吶・,                en: "I'll get married next year." },
  '辟｡逅・:   { jp: '辟｡逅・・縺励↑縺・〒縺上□縺輔＞縲・,        en: "Please don't overdo it." },
  '諢溘§':   { jp: '縺・＞諢溘§縺ｧ縺吶・,                  en: 'It feels good.' },
  '譛鬮・:   { jp: '縺薙・譎ｯ濶ｲ縺ｯ譛鬮倥〒縺吶・,            en: 'This view is the best.' },
  '險育判':   { jp: '譌・｡後・險育判繧堤ｫ九※縺ｾ縺励◆縲・,        en: 'I made travel plans.' },
  '莉ｲ髢・:   { jp: '莉ｲ髢薙→荳邱偵↓蜒阪″縺ｾ縺吶・,          en: 'I work together with my colleagues.' },
  '蜿ｯ閭ｽ':   { jp: '莠育ｴ・・蜿ｯ閭ｽ縺ｧ縺吶°縲・,              en: 'Is a reservation possible?' },
  '譏取律':   { jp: '譏取律縲√∪縺滓擂縺ｾ縺吶・,              en: "I'll come again tomorrow." },
  '螟峨ｏ':   { jp: '險育判縺悟､峨ｏ繧翫∪縺励◆縲・,            en: 'The plan has changed.' },
  '閨槭％縺・: { jp: '繧医￥閨槭％縺医∪縺帙ｓ縲・,              en: "I can't hear well." },
  '遒ｺ隱・:   { jp: '莠育ｴ・ｒ遒ｺ隱阪＠縺ｦ縺上□縺輔＞縲・,        en: 'Please confirm the reservation.' },
  '荳弱∴':   { jp: '蟄蝉ｾ帙↓譛ｬ繧剃ｸ弱∴縺ｾ縺吶・,            en: 'I give a book to the child.' },
  '蜈ｨ蜩｡':   { jp: '蜈ｨ蜩｡縺碁寔縺ｾ繧翫∪縺励◆縲・,            en: 'Everyone gathered.' },
  '逅・ｧ｣':   { jp: '繧医￥逅・ｧ｣縺ｧ縺阪∪縺励◆縲・,            en: 'I understood well.' },
  '莠御ｺｺ':   { jp: '莠御ｺｺ縺ｧ譌・｡後＠縺ｾ縺吶・,              en: "We're traveling together." },
  '髢九￠':   { jp: '繝峨い繧帝幕縺代※縺上□縺輔＞縲・,          en: 'Please open the door.' },
  '蜿倶ｺｺ':   { jp: '蜿倶ｺｺ縺ｫ莨壹＞縺ｾ縺励◆縲・,              en: 'I met a friend.' },
  '髮｢繧・:   { jp: '蟆代＠髮｢繧後※縺上□縺輔＞縲・,            en: 'Please step back a little.' },
};

// 笏笏 Tatoeba 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
// Patterns suggestifs/crus ﾃ exclure
const BLOCKLIST = /蟇昴◆|蟇昴ｋ|谿ｺ|豁ｻ繧倒谿ｴ|證ｴ蜉斈繧ｻ繝・け繧ｹ|陬ｸ|荳狗捩|驟斐▲|繧ｯ繧ｽ|繝舌き|鬥ｬ鮖ｿ|縺ｵ縺悶￠/;
// Terminaisons desu/masu (forme polie)
const POLITE_END = /(縺ｾ縺處縺ｾ縺励◆|縺ｾ縺帙ｓ|縺ｾ縺帙ｓ縺ｧ縺励◆|縺ｧ縺處縺ｧ縺励◆|縺ｧ縺励ｇ縺・縺ｾ縺吶°|縺ｧ縺吶°|縺ｾ縺励ｇ縺・縲・$/u;

async function fetchExample(word) {
  try {
    const url = `https://tatoeba.org/api_v0/search?query=${encodeURIComponent(word)}&from=jpn&to=eng&limit=100&sort=relevance`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    for (const s of (data.results || [])) {
      const jp = s.text?.trim(), en = s.translations?.[0]?.[0]?.text?.trim();
      if (!jp || !en || !jp.includes(word)) continue;
      if (jp.length > 45 || jp.replace(/[縲ゑｼ・ｼ歃s縲‐/g, '').length < 5) continue;
      if (BLOCKLIST.test(jp)) continue;
      if (!POLITE_END.test(jp)) continue; // 竊・polite only, no fallback
      return { jp, en };
    }
  } catch {}
  return null;
}

// 笏笏 HTML slides 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
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

// 笏笏 PROG SLIDES 窶・layout fixe, visibility:hidden pour ﾃｩlﾃｩments non encore rﾃｩvﾃｩlﾃｩs 笏笏
// showReading / showMeaning / showExample contrﾃｴlent la visibilitﾃｩ SANS changer la gﾃｩomﾃｩtrie.
function buildProgSlide({ word, reading, def, jpH, exJp, exEn, showReading, showMeaning, showExample }) {
  const wfs  = Math.min(160, Math.max(96, Math.floor(480 / Math.max(word.length, 1))));
  const jraw = (exJp || '').replace(/[縲ゅ・ｼ・ｼ歃s]/g, '');
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

// 笏笏 Playwright 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
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

// 笏笏 JLPT kanji list 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
async function fetchJLPTKanji(level) {
  const num = parseInt(level.replace('n', ''), 10);
  const res = await fetch(`https://kanjiapi.dev/v1/kanji/jlpt-${num}`);
  if (!res.ok) throw new Error(`kanjiapi.dev jlpt-${num}: HTTP ${res.status}`);
  return await res.json(); // array of kanji strings
}

// 笏笏 Build target word list 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
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
  // freq.js exporte "export const FREQ = {...}" 窶・on extrait l'objet littﾃｩral directement
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
console.log(`\nVocab Reels 窶・${targetWords.length} mot(s): ${targetWords.join(' ')}\n`);

if (DRY_RUN) {
  for (const w of targetWords) {
    const t = JMDICT[w];
    console.log(`  ${w}  ${WORD_READING[w] || '?'}  窶・${t?.en?.split(',').slice(0,2).join(', ') || '?'}`);
  }
  await browser.close(); process.exit(0);
}

// 笏笏 CTA check 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
const CTA_FILE = join(ROOT, 'kanji-cards', 'CTA_Footage.mp4');
if (!existsSync(CTA_FILE)) {
  console.error('kanji-cards/CTA_Footage.mp4 manquant');
  await browser.close(); process.exit(1);
}

// 笏笏 Timing 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
//  D[i] = durﾃｩe visible de chaque segment
const D  = [3, 3, 3, 4, 6, 7]; // hook, A, B, C, D, CTA
const XF = 0.5;                  // xfade entre tous les segments (smooth)
const FADE_OUT_DUR = 1.5;        // fondu noir final sur CTA
// durﾃｩe rﾃｩelle de chaque segment encodﾃｩ (inclut overlap sortant sauf dernier)
const BRUTS = D.map((d, i) => i < D.length - 1 ? d + XF : d);
// durﾃｩe totale du concat aprﾃｨs xfades
const CONCAT_DUR = D.reduce((a, b) => a + b, 0) - (D.length - 1) * XF;

// 笏笏 Main loop 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
let ok = 0;

for (const word of targetWords) {
  const outFile = join(OUT_DIR, `${word}.mp4`);
  if (existsSync(outFile)) { console.log(`   ${word} 窶・skip`); ok++; continue; }

  console.log(`Processing ${word}...`);
  try {
    const disp    = WORD_DICT_FORM[word] || word;
    const reading = await getReading(disp);
    const def     = WORD_DEF_OVERRIDE[word] || WORD_DEF_OVERRIDE[disp] || (JMDICT[disp]?.en || JMDICT[word]?.en || disp).split(',').slice(0, 3).join(', ');
    console.log(`   ${reading}  窶・ ${def}`);
    const example = VOCAB_SENTENCE_OVERRIDE[word]
      || (SENTENCES_JSON[word] ? { jp: SENTENCES_JSON[word].jp, en: SENTENCES_JSON[word].en } : null)
      || await fetchExample(word);
    const exJp = example?.jp || `${disp}縺ｯ繧医￥菴ｿ繧上ｌ縺ｾ縺吶Ａ;
    const exEn = example?.en || `"${disp}" is commonly used.`;
    console.log(`   ex: ${exJp}`);
    const jpH = await toFuriganaHTML(exJp, word);

    // TTS
    console.log('   TTS...');
    const mp3w1 = join(TMP, `${word}_w1.mp3`);
    const mp3ex = join(TMP, `${word}_ex.mp3`);
    await tts(disp, mp3w1);
    await tts(exJp, mp3ex);

    // Audio per segment
    const a0 = join(TMP, `${word}_a0.mp3`); silence(a0, BRUTS[0]);

    // ProgA (kanji only) 窶・silent
    const a1 = join(TMP, `${word}_a1.mp3`); silence(a1, BRUTS[1]);

    // ProgB (reading revealed) 窶・voice plays here
    const a2pre = join(TMP, `${word}_a2pre.mp3`);
    const a2    = join(TMP, `${word}_a2.mp3`);
    prependSilence(mp3w1, a2pre, 0.3); padAudio(a2pre, a2, BRUTS[2]);

    const a3 = join(TMP, `${word}_a3.mp3`); silence(a3, BRUTS[3]);

    const a4pre = join(TMP, `${word}_a4pre.mp3`);
    const a4    = join(TMP, `${word}_a4.mp3`);
    prependSilence(mp3ex, a4pre, 0.6); padAudio(a4pre, a4, BRUTS[4]);

    // Prog slide params (mﾃｪme layout, visibilitﾃｩ variable)
    const progBase = { word: disp, reading, def, jpH, exJp, exEn };

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
      mp3w1, mp3ex,
      a0, a1, a2pre, a2, a3, a4pre, a4,
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
console.log(`\n${ok}/${targetWords.length} reels generes 窶・vocab-cards/reels/\n`);
