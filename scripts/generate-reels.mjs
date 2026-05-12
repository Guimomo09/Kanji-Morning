/**
 * generate-reels.mjs
 *
 * Génère une vidéo Reels/TikTok pour chaque kanji :
 *   [0-4s]  Carte kanji     + voix TTS (lecture ON + KUN + signification EN)
 *   [4-9s]  Carte vocab     + voix TTS (3 mots lus en japonais)
 *   [9-16s] Carte phrases   + voix TTS (2 phrases lues en japonais)
 *
 * Output : kanji-cards/{level}/reels/{kanji}.mp4  (1080×1920, H.264)
 *
 * Dépendances :
 *   - ffmpeg dans le PATH (winget install ffmpeg)
 *   - edge-tts Python (pip install edge-tts)
 *
 * Usage :
 *   node scripts/generate-reels.mjs --kanji 日,火 --level n5
 *   node scripts/generate-reels.mjs --level n5 --count 10
 */

import { readFileSync, mkdirSync, existsSync, unlinkSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawnSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── CLI ───────────────────────────────────────────────────────────────────────
const args  = process.argv.slice(2);
const get   = (f, d) => { const i = args.indexOf(f); return i !== -1 ? args[i+1] : d; };
const LEVEL = get('--level', 'n5');
const COUNT = parseInt(get('--count', '5'), 10);
const CUSTOM = get('--kanji', null);

// ── Paths ─────────────────────────────────────────────────────────────────────
const CARDS_DIR = join(ROOT, 'kanji-cards', LEVEL);
const REELS_DIR = join(CARDS_DIR, 'reels');
mkdirSync(REELS_DIR, { recursive: true });

// ── kanji_index ───────────────────────────────────────────────────────────────
const KANJI_INDEX = JSON.parse(readFileSync(join(ROOT, 'public', 'kanji_index.json'), 'utf8'));

// ── EXAMPLE_OVERRIDE + SENTENCE_OVERRIDE ────────────────────────────────────
const loadObj = (text, varName) => {
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
  return new Function(`"use strict"; return (${text.slice(objStart, i+1)})`)();
};
const kjText = readFileSync(join(ROOT, 'src', 'kanji.js'), 'utf8');
const EXAMPLE_OVERRIDE  = loadObj(kjText, 'EXAMPLE_OVERRIDE');
const SENTENCE_OVERRIDE = loadObj(kjText, 'SENTENCE_OVERRIDE');

// ── Detect Python / edge-tts ─────────────────────────────────────────────────
function findPython() {
  // Windows Store Python 3.13 (known location)
  const store = 'C:\\Users\\Charles\\AppData\\Local\\Microsoft\\WindowsApps\\python3.13.exe';
  if (existsSync(store)) return store;
  for (const cmd of ['python3', 'python']) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return cmd;
  }
  throw new Error('Python introuvable. Installez Python 3.');
}
const PYTHON = findPython();

function findFfmpeg() {
  const staticPath = join(ROOT, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
  if (existsSync(staticPath)) return staticPath;
  const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (r.status === 0) return 'ffmpeg';
  throw new Error('ffmpeg introuvable. Lancez: npm install ffmpeg-static --save-dev');
}
const FFMPEG = findFfmpeg();
const FFPROBE = (() => {
  try { return require('ffprobe-static').path; } catch {}
  return FFMPEG.replace('ffmpeg.exe', 'ffprobe.exe');
})();

// ── TTS helper ────────────────────────────────────────────────────────────────
// Voice: ja-JP-NanamiNeural · rate -10% for more natural pacing
async function tts(text, outMp3) {
  const r = spawnSync(PYTHON, ['-m', 'edge_tts',
    '--voice', 'ja-JP-NanamiNeural',
    '--rate=-10%',
    '--text',  text,
    '--write-media', outMp3,
  ], { encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) {
    throw new Error(`edge-tts error: ${r.stderr || r.stdout}`);
  }
}

// Get audio duration in seconds via ffprobe
function audioDuration(file) {
  const r = spawnSync(FFPROBE, [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ], { encoding: 'utf8' });
  return parseFloat(r.stdout.trim()) || 3;
}

// ── ffmpeg helpers ────────────────────────────────────────────────────────────
// Pad audio to exactly `dur` seconds (add silence if shorter)
function padAudio(inp, outFile, dur) {
  spawnSync(FFMPEG, ['-y',
    '-i', inp,
    '-af', `apad=whole_dur=${dur}`,
    '-t', String(dur),
    outFile,
  ], { encoding: 'utf8' });
}

// Create a video segment: static image + audio, `dur` seconds
function imageToVideo(img, audio, outFile) {
  spawnSync(FFMPEG, ['-y',
    '-loop', '1', '-i', img,
    '-i', audio,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-profile:v', 'baseline', '-level', '4.0', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart',
    '-shortest',
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=#faf7f2',
    '-r', '30',
    outFile,
  ], { encoding: 'utf8' });
}

// Concatenate video segments with smooth xfade dissolve between each
function concatWithXFade(segments, durations, outFile, fadeDur = 0.3) {
  const n = segments.length;
  const inputs = segments.flatMap(s => ['-i', s]);

  // xfade offsets: cumulative (dur_i - fadeDur) for each transition
  const offsets = [];
  let t = 0;
  for (let i = 0; i < n - 1; i++) {
    t += durations[i] - fadeDur;
    offsets.push(+t.toFixed(3));
  }

  // Video xfade chain
  let vPrev = '0:v';
  const vParts = [];
  for (let i = 1; i < n; i++) {
    const out = i === n - 1 ? 'vout' : `v${i}`;
    vParts.push(`[${vPrev}][${i}:v]xfade=transition=fade:duration=${fadeDur}:offset=${offsets[i-1]}[${out}]`);
    vPrev = out;
  }

  // Audio acrossfade chain
  let aPrev = '0:a';
  const aParts = [];
  for (let i = 1; i < n; i++) {
    const out = i === n - 1 ? 'aout' : `a${i}`;
    aParts.push(`[${aPrev}][${i}:a]acrossfade=d=${fadeDur}[${out}]`);
    aPrev = out;
  }

  const filterComplex = [...vParts, ...aParts].join(';');

  const r = spawnSync(FFMPEG, [
    '-y',
    ...inputs,
    '-filter_complex', filterComplex,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-profile:v', 'baseline', '-level', '4.0', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart',
    outFile,
  ], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('concatWithXFade failed: ' + r.stderr);
}

// Prepend silence before audio (intro delay)
function prependSilence(inp, outFile, silenceSec) {
  spawnSync(FFMPEG, ['-y',
    '-f', 'lavfi', '-t', String(silenceSec), '-i', 'anullsrc=r=44100:cl=stereo',
    '-i', inp,
    '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[aout]',
    '-map', '[aout]',
    outFile,
  ], { encoding: 'utf8' });
}

// Blur intro: blurred card1 + optional text-intro.png overlay + optional audio
function blurIntroVideo(img, outFile, duration, audioFile = null) {
  const textPng = join(ROOT, 'kanji-cards', 'text-intro.png');
  const hasText = existsSync(textPng);
  const audioArgs = audioFile
    ? ['-i', audioFile]
    : ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo'];
  const inputs = ['-loop', '1', '-i', img, ...audioArgs];
  let filterComplex, mapV;
  if (hasText) {
    inputs.push('-i', textPng);
    // audio is input 1, text png is input 2
    filterComplex = [
      '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=#faf7f2,gblur=sigma=20[bg]',
      '[bg][2:v]overlay=(W-w)/2:(H-h)/2[vout]',
    ].join(';');
    mapV = '[vout]';
  } else {
    console.warn('⚠️  kanji-cards/text-intro.png manquant — intro sans texte');
    filterComplex = '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=#faf7f2,gblur=sigma=20[vout]';
    mapV = '[vout]';
  }
  const audioIdx = audioFile ? '1:a' : '1:a';
  const r = spawnSync(FFMPEG, ['-y',
    ...inputs,
    '-t', String(duration),
    '-filter_complex', filterComplex,
    '-map', mapV,
    '-map', audioIdx,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-profile:v', 'baseline', '-level', '4.0', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart',
    '-r', '30',
    outFile,
  ], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('blurIntroVideo failed: ' + r.stderr.slice(-400));
}

// CTA: 0→10s raw footage, 10s→end blurred + text-cta.png overlay centered
function ctaVideo(footageMp4, outFile, duration) {
  const BLUR_START = 10;
  const textPng = join(ROOT, 'kanji-cards', 'text-cta.png');
  const hasText = existsSync(textPng);
  const inputs = ['-i', footageMp4];
  let fc;
  if (hasText) {
    inputs.push('-i', textPng);
    fc = [
      '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[base]',
      '[base]split[v1][v2]',
      '[v2]gblur=sigma=25[blurred]',
      `[v1][blurred]overlay=enable='gte(t,${BLUR_START})'[blended]`,
      `[blended][1:v]overlay=(W-w)/2:(H-h)/2:enable='gte(t,${BLUR_START})'[vout]`,
    ].join(';');
  } else {
    console.warn('⚠️  kanji-cards/text-cta.png manquant — CTA sans texte');
    fc = [
      '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[base]',
      '[base]split[v1][v2]',
      '[v2]gblur=sigma=25[blurred]',
      `[v1][blurred]overlay=enable='gte(t,${BLUR_START})'[vout]`,
    ].join(';');
  }
  const r = spawnSync(FFMPEG, ['-y',
    ...inputs,
    '-t', String(duration),
    '-filter_complex', fc,
    '-map', '[vout]',
    '-map', '0:a',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-profile:v', 'baseline', '-level', '4.0', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart',
    '-r', '30',
    outFile,
  ], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ctaVideo failed: ' + r.stderr.slice(-400));
}

// Fade to black: solid black + silence
function fadeToBlackVideo(outFile, duration) {
  const r = spawnSync(FFMPEG, ['-y',
    '-f', 'lavfi', '-i', `color=c=black:size=1080x1920:duration=${duration}:rate=30`,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', String(duration),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-profile:v', 'baseline', '-level', '4.0', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart',
    outFile,
  ], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('fadeToBlackVideo failed: ' + r.stderr);
}

// Concatenate 2 audio files with a silence gap in between
function concatAudioWithGap(file1, file2, gapSec, outFile) {
  spawnSync(FFMPEG, ['-y',
    '-i', file1,
    '-f', 'lavfi', '-t', String(gapSec), '-i', 'anullsrc=r=44100:cl=stereo',
    '-i', file2,
    '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1[aout]',
    '-map', '[aout]',
    outFile,
  ], { encoding: 'utf8' });
}

// ── Target kanji ─────────────────────────────────────────────────────────────
let targetKanji;
if (CUSTOM) {
  targetKanji = CUSTOM.split(',').map(k => k.trim()).filter(k => KANJI_INDEX[k]);
} else {
  // Pick from generated cards
  const { readdirSync } = await import('fs');
  const tiktokDir = join(CARDS_DIR, 'tiktok');
  if (!existsSync(tiktokDir)) {
    console.error(`❌ Dossier ${tiktokDir} introuvable. Génère d'abord les cartes avec generate-kanji-cards.mjs`);
    process.exit(1);
  }
  targetKanji = readdirSync(tiktokDir)
    .filter(d => KANJI_INDEX[d])
    .slice(0, COUNT);
}

console.log(`\n🎬 ${targetKanji.length} kanji — Reels ${LEVEL.toUpperCase()}`);
console.log(`   ${targetKanji.join(' ')}\n`);

// ── Main loop ─────────────────────────────────────────────────────────────────
const TMP = join(ROOT, '.reels-tmp');
mkdirSync(TMP, { recursive: true });

let ok = 0;
for (const kanji of targetKanji) {
  const data = KANJI_INDEX[kanji];
  if (!data) { console.warn(`⚠️  Pas de données pour ${kanji}`); continue; }

  const tiktokDir = join(CARDS_DIR, 'tiktok', kanji);
  const card1 = join(tiktokDir, '1-kanji.png');
  const card2 = join(tiktokDir, '2-vocab.png');
  const card3 = join(tiktokDir, '3-phrases.png');

  if (![card1, card2, card3].every(existsSync)) {
    console.warn(`⚠️  Cartes manquantes pour ${kanji} — génère-les d'abord`);
    continue;
  }

  console.log(`🔊 ${kanji} — TTS...`);

  // ── Build TTS scripts ────────────────────────────────────────────────────
  const meanings = (data.m || '').split(',').slice(0, 2).join(', ');
  // Clean readings: strip '-' prefix, strip okurigana after '.', katakana→hiragana, reverse (kanjiapi = least→most common)
  const cleanKun = [...new Set((data.k || []).map(r => r.replace(/^-/, '').replace(/\..+$/, '')).reverse())];
  const cleanOn  = [...new Set((data.o || []).map(r =>
    r.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60)).replace(/\s.+$/, '')
  ).reverse())];
  const kunReads = cleanKun.join('。');
  const onReads  = cleanOn.join('。');
  const readings = [kunReads, onReads].filter(Boolean).join('。');

  // Card 1: KUN readings → ON readings only (no kanji, no meaning)
  const tts1Text = [...cleanKun, ...cleanOn].join('。') + '。';

  // Card 2: vocab words
  const vocabWords = (EXAMPLE_OVERRIDE[kanji] || []).slice(0, 3);
  const tts2Text = vocabWords.length
    ? vocabWords.map(w => `${w.w}。`).join(' ')
    : `${kanji}の言葉。`;

  // Card 3: example sentences (2 TTS séparés pour le gap 1s)
  const sentences  = (SENTENCE_OVERRIDE[kanji] || []).slice(0, 2);
  const tts3aText  = sentences[0]?.jp || `${kanji}を使った文です。`;
  const tts3bText  = sentences[1]?.jp || null;

  try {
    // Generate TTS audio files
    const mp3_0  = join(TMP, `${kanji}_0.mp3`);  // intro
    const mp3_1  = join(TMP, `${kanji}_1.mp3`);
    const mp3_2  = join(TMP, `${kanji}_2.mp3`);
    const mp3_3a = join(TMP, `${kanji}_3a.mp3`);
    const mp3_3b = join(TMP, `${kanji}_3b.mp3`);
    const mp3_3  = join(TMP, `${kanji}_3.mp3`);
    await tts('本日の漢字', mp3_0);
    await tts(tts1Text,  mp3_1);
    await tts(tts2Text,  mp3_2);
    await tts(tts3aText, mp3_3a);
    if (tts3bText) await tts(tts3bText, mp3_3b);

    // Card 1: ajouter 0.8s de silence avant la voix
    const mp3_1d = join(TMP, `${kanji}_1d.mp3`);
    prependSilence(mp3_1, mp3_1d, 0.8);

    // Card 3: combiner les 2 phrases avec 1s de pause
    if (tts3bText && existsSync(mp3_3b)) {
      concatAudioWithGap(mp3_3a, mp3_3b, 1, mp3_3);
    } else {
      spawnSync(FFMPEG, ['-y', '-i', mp3_3a, '-c', 'copy', mp3_3], { encoding: 'utf8' });
    }

    // Fixed durations per template
    const INTRO_DUR = 3;   // intro floue
    const DUR1      = 10;  // carte kanji
    const DUR2      = 10;  // carte vocab
    const DUR3      = 10;  // carte phrases
    const CTA_DUR   = 15;  // CTA app (0-10s raw, 10-15s blurred + texte)
    const FADE_DUR  = 2;   // fondu noir
    const TOTAL     = INTRO_DUR + DUR1 + DUR2 + DUR3 + CTA_DUR + FADE_DUR;

    // Pad intro audio to INTRO_DUR
    const pad0 = join(TMP, `${kanji}_0p.mp3`);
    padAudio(mp3_0, pad0, INTRO_DUR);

    // Pad all audio to fixed durations
    const pad1 = join(TMP, `${kanji}_1p.mp3`);
    const pad2 = join(TMP, `${kanji}_2p.mp3`);
    const pad3 = join(TMP, `${kanji}_3p.mp3`);
    padAudio(mp3_1d, pad1, DUR1);
    padAudio(mp3_2,  pad2, DUR2);
    padAudio(mp3_3,  pad3, DUR3);

    // CTA footage
    const appScreenshot = join(ROOT, 'kanji-cards', 'CTA_Footage.mp4');
    if (!existsSync(appScreenshot)) throw new Error('kanji-cards/CTA_Footage.mp4 manquant');

    console.log(`   📹 [${INTRO_DUR}s intro + ${DUR1}s + ${DUR2}s + ${DUR3}s + ${CTA_DUR}s CTA + ${FADE_DUR}s fade = ${TOTAL}s]`);

    // Build all segments
    const seg0 = join(TMP, `${kanji}_seg0.mp4`);  // intro floue
    const seg1 = join(TMP, `${kanji}_seg1.mp4`);  // kanji
    const seg2 = join(TMP, `${kanji}_seg2.mp4`);  // vocab
    const seg3 = join(TMP, `${kanji}_seg3.mp4`);  // phrases
    const seg4 = join(TMP, `${kanji}_seg4.mp4`);  // CTA
    const seg5 = join(TMP, `${kanji}_seg5.mp4`);  // fade noir
    blurIntroVideo(card1, seg0, INTRO_DUR, pad0);
    imageToVideo(card1, pad1, seg1);
    imageToVideo(card2, pad2, seg2);
    imageToVideo(card3, pad3, seg3);
    ctaVideo(appScreenshot, seg4, CTA_DUR);
    fadeToBlackVideo(seg5, FADE_DUR);

    // Concatenate all with 0.3s crossfade between each segment
    const outFile = join(REELS_DIR, `${kanji}.mp4`);
    concatWithXFade(
      [seg0, seg1, seg2, seg3, seg4, seg5],
      [INTRO_DUR, DUR1, DUR2, DUR3, CTA_DUR, FADE_DUR],
      outFile
    );

    // Cleanup tmp files
    for (const f of [mp3_0, mp3_1, mp3_1d, mp3_2, mp3_3, mp3_3a, mp3_3b, pad0, pad1, pad2, pad3, seg0, seg1, seg2, seg3, seg4, seg5]) {
      try { unlinkSync(f); } catch {}
    }

    console.log(`✅ ${kanji} → reels/${kanji}.mp4`);
    ok++;
  } catch (e) {
    console.error(`❌ ${kanji}: ${e.message}`);
  }
}

// Cleanup tmp dir if empty
try { require('fs').rmdirSync(TMP); } catch {}

console.log(`\n🎉 ${ok}/${targetKanji.length} reels générés`);
console.log(`   kanji-cards/${LEVEL}/reels/*.mp4\n`);
