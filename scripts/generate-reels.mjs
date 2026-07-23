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

import { readFileSync, mkdirSync, existsSync, unlinkSync, writeFileSync, rmSync } from 'fs';
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
const LEVEL   = get('--level', 'n5');
const COUNT   = parseInt(get('--count', '5'), 10);
const CUSTOM  = get('--kanji', null);
const DIR     = get('--dir', LEVEL);
const BGM_VOL = parseFloat(get('--bgm-vol', '0'));

// ── VOICEVOX config ───────────────────────────────────────────────────────────
const VOICEVOX_URL    = 'http://localhost:50021';
const VOICEVOX_SPEAKER = parseInt(get('--speaker', '16'), 10); // 16=九州そら, 8=春日部つむぎ
const VOICEVOX_SPEED   = parseFloat(get('--speed', '1.1'));    // 1.1=mid, 0.85=slow

// ── Paths ─────────────────────────────────────────────────────────────────────
const CARDS_DIR   = join(ROOT, 'kanji-cards', DIR);
const STAGING_DIR = join(CARDS_DIR, 'tiktok');     // PNGs 1080×1920 TikTok
const REELS_DIR   = join(CARDS_DIR, 'reels');      // MP4 output
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

// ── TTS helper (edge-tts) ─────────────────────────────────────────────────────
const EDGE_TTS_VOICE = get('--voice', 'ja-JP-NanamiNeural');
async function tts(text, outMp3) {
  const outWav = outMp3.replace(/\.mp3$/, '.wav');
  const r = spawnSync(PYTHON, [
    '-m', 'edge_tts',
    '--voice', EDGE_TTS_VOICE,
    '--text', text,
    '--write-media', outWav,
  ], { encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) throw new Error(`edge-tts failed: ${r.stderr}`);
  spawnSync(FFMPEG, ['-y', '-i', outWav, '-codec:a', 'libmp3lame', '-q:a', '2', outMp3],
    { encoding: 'utf8' });
  unlinkSync(outWav);
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

// Get audio duration in seconds via ffprobe
function getAudioDuration(file) {
  const r = spawnSync(FFPROBE, [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ], { encoding: 'utf8' });
  return parseFloat(r.stdout.trim()) || 0;
}

// Center audio within totalDur: equal silence before and after, minimum minBuf on each side.
// If voice is longer than (totalDur - 2*minBuf), just uses minBuf as pre-silence.
function centerAudio(inp, outFile, totalDur, minBuf = 1.0) {
  const voiceDur = getAudioDuration(inp);
  const pre = Math.max(minBuf, (totalDur - voiceDur) / 2);
  const centered = outFile + '.pre.mp3';
  prependSilence(inp, centered, pre);
  padAudio(centered, outFile, totalDur);
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
// fadeDurs: single number applied to all transitions, or array of (n-1) values
function concatWithXFade(segments, durations, outFile, fadeDurs = 0.3) {
  const n = segments.length;
  const inputs = segments.flatMap(s => ['-i', s]);
  // Normalize fadeDurs to array
  const fades = Array.isArray(fadeDurs)
    ? fadeDurs
    : Array(n - 1).fill(fadeDurs);

  // xfade offsets: cumulative (dur_i - fade_i) for each transition
  const offsets = [];
  let t = 0;
  for (let i = 0; i < n - 1; i++) {
    t += durations[i] - fades[i];
    offsets.push(+t.toFixed(3));
  }

  // Video xfade chain
  let vPrev = '0:v';
  const vParts = [];
  for (let i = 1; i < n; i++) {
    const out = i === n - 1 ? 'vout' : `v${i}`;
    vParts.push(`[${vPrev}][${i}:v]xfade=transition=fade:duration=${fades[i-1]}:offset=${offsets[i-1]}[${out}]`);
    vPrev = out;
  }

  // Audio acrossfade chain
  let aPrev = '0:a';
  const aParts = [];
  for (let i = 1; i < n; i++) {
    const out = i === n - 1 ? 'aout' : `a${i}`;
    aParts.push(`[${aPrev}][${i}:a]acrossfade=d=${fades[i-1]}[${out}]`);
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
// Hook intro: kanji grand sur fond propre + text-intro.png overlay + audio
// Si text-intro.png absent → juste le kanji sur fond crème
function blurIntroVideo(img, outFile, duration, audioFile = null) {
  const textPng = join(ROOT, 'kanji-cards', 'text-intro.png');
  const hasText = existsSync(textPng);
  const audioArgs = audioFile
    ? ['-i', audioFile]
    : ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo'];
  // Fond = carte kanji floutée + assombrie (darken), texte intro par-dessus
  const inputs = ['-loop', '1', '-i', img, ...audioArgs];
  let filterComplex, mapV;
  if (hasText) {
    inputs.push('-i', textPng);
    filterComplex = [
      '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=#faf7f2,boxblur=luma_radius=22:luma_power=3,eq=brightness=-0.35[bg]',
      '[bg][2:v]overlay=(W-w)/2:(H-h)/2[vout]',
    ].join(';');
    mapV = '[vout]';
  } else {
    console.warn('⚠️  kanji-cards/text-intro.png manquant — intro fond flou seul');
    filterComplex = '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=#faf7f2,boxblur=luma_radius=22:luma_power=3,eq=brightness=-0.35[vout]';
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
// CTA: image statique + texte overlay qui apparaît après TEXT_DELAY secondes
// Fallback sur la vidéo de l'app si CTA_Static.png absent
function ctaVideo(footageMp4, outFile, duration) {
  const TEXT_DELAY = 1.5;
  const staticPng  = join(ROOT, 'kanji-cards', 'CTA_Static.png');
  const textPng    = join(ROOT, 'kanji-cards', 'text-cta.png');
  const useStatic  = existsSync(staticPng);
  const hasText    = existsSync(textPng);

  if (useStatic) {
    // Image statique : fond fixe + texte overlay après TEXT_DELAY
    const inputs = ['-loop', '1', '-i', staticPng,
                    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo'];
    let fc;
    if (hasText) {
      inputs.push('-i', textPng);
      fc = [
        '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=#faf7f2[base]',
        `[2:v]scale=iw*0.8:ih*0.8[txt]`,
        `[base][txt]overlay=(W-w)/2:(H-h)/2:enable='gte(t,${TEXT_DELAY})'[vout]`,
      ].join(';');
    } else {
      fc = '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=#faf7f2[vout]';
    }
    const r = spawnSync(FFMPEG, ['-y',
      ...inputs,
      '-t', String(duration),
      '-filter_complex', fc,
      '-map', '[vout]', '-map', '1:a',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-profile:v', 'baseline', '-level', '4.0', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
      '-movflags', '+faststart', '-r', '30',
      outFile,
    ], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('ctaVideo (static) failed: ' + r.stderr.slice(-400));
  } else {
    // Fallback: vidéo de l'app floutée avec texte centré dès TEXT_DELAY
    console.log('⚠️  kanji-cards/CTA_Static.png absent — fallback vidéo');
    const inputs = ['-i', footageMp4];
    let fc;
    if (hasText) {
      inputs.push('-i', textPng);
      fc = [
        '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=25,eq=brightness=-0.2[base]',
        `[1:v]scale=iw*0.8:ih*0.8[txt]`,
        `[base][txt]overlay=(W-w)/2:(H-h)/2:enable='gte(t,${TEXT_DELAY})'[vout]`,
      ].join(';');
    } else {
      fc = '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=25,eq=brightness=-0.2[vout]';
    }
    const r = spawnSync(FFMPEG, ['-y',
      ...inputs,
      '-t', String(duration),
      '-filter_complex', fc,
      '-map', '[vout]', '-map', '0:a',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-profile:v', 'baseline', '-level', '4.0', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
      '-movflags', '+faststart', '-r', '30',
      outFile,
    ], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('ctaVideo (video) failed: ' + r.stderr.slice(-400));
  }
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

// Assemble audio files with dynamic equal gaps: | gap | f1 | gap | f2 | ... | fN | gap |
// gap = max(minGap, (totalDur - sum(durations)) / (n+1))
// The result is then padded to totalDur by the caller.
function assembleWithDynamicGaps(files, totalDur, minGap, outFile) {
  const durations = files.map(f => getAudioDuration(f));
  const sumDur    = durations.reduce((a, b) => a + b, 0);
  const gap       = Math.max(minGap, (totalDur - sumDur) / (files.length + 1));

  const inputs = [];
  let idx = 0;
  const labels = [];

  for (let i = 0; i < files.length; i++) {
    // gap before each item
    inputs.push('-f', 'lavfi', '-t', String(gap), '-i', 'anullsrc=r=44100:cl=stereo');
    labels.push(`[${idx++}:a]`);
    inputs.push('-i', files[i]);
    labels.push(`[${idx++}:a]`);
  }

  spawnSync(FFMPEG, ['-y',
    ...inputs,
    '-filter_complex', `${labels.join('')}concat=n=${labels.length}:v=0:a=1[aout]`,
    '-map', '[aout]',
    outFile,
  ], { encoding: 'utf8' });
}

// ── Target kanji ─────────────────────────────────────────────────────────────
let targetKanji;
if (CUSTOM) {
  targetKanji = CUSTOM.split(',').map(k => k.trim()).filter(k => KANJI_INDEX[k]);
} else {
  // Pick from staging dir (tiktok PNGs generated by generate-kanji-cards.mjs)
  const { readdirSync } = await import('fs');
  if (!existsSync(STAGING_DIR)) {
    console.error(`\u274c Dossier ${STAGING_DIR} introuvable.\n   G\u00e9n\u00e8re d'abord les cartes : node scripts/generate-kanji-cards.mjs --level ${LEVEL} --count 999`);
    process.exit(1);
  }
  targetKanji = readdirSync(STAGING_DIR)
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

  const stagingDir = join(STAGING_DIR, kanji);
  const card1 = join(stagingDir, '1-kanji.png');
  const card2 = join(stagingDir, '2-vocab.png');
  const card3 = join(stagingDir, '3-phrases.png');

  if (![card1, card2, card3].every(existsSync)) {
    console.warn(`⚠️  Cartes TikTok manquantes pour ${kanji} dans tiktok/ — génère-les d'abord`);
    continue;
  }

  const outFile = join(REELS_DIR, `${kanji}.mp4`);
  if (existsSync(outFile)) { console.log(`⏩ skip ${kanji}`); ok++; continue; }

  console.log(`🔊 ${kanji} — TTS...`);

  // ── Build TTS scripts ────────────────────────────────────────────────────
  const meanings = (data.m || '').split(',').slice(0, 2).join(', ');
  // Clean readings: strip '-' prefix, strip okurigana after '.', katakana→hiragana, reverse (kanjiapi = least→most common)
  const cleanKun = [...new Set((data.k || []).map(r => r.replace(/^-/, '').replace(/\..+$/, '')).reverse())];
  const cleanOn  = [...new Set((data.o || []).map(r =>
    r.replace(/^-/, '').replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60)).replace(/\s.+$/, '')
  ).filter(Boolean).reverse())];
  const kunReads = cleanKun.join('。');
  const onReads  = cleanOn.join('。');
  const readings = [kunReads, onReads].filter(Boolean).join('。');

  // Card 1: KUN readings → ON readings — 1 TTS par lecture pour spacing dynamique
  const tts1Items = [...cleanKun, ...cleanOn].slice(0, 6); // max 6 lectures

  // Card 2: vocab words — 3 TTS séparés pour spacing chirurgical
  const vocabWords = (EXAMPLE_OVERRIDE[kanji] || []).slice(0, 3);
  const vocabTtsTexts = vocabWords.length
    ? vocabWords.map(w => w.w)
    : [`${kanji}`];

  // Card 3: example sentences — read sentences.json sidecar first (written by generate-kanji-cards.mjs
  // to guarantee TTS matches the phrase card exactly), then fall back to SENTENCE_OVERRIDE.
  // sentences.json sidecar : cherche d'abord dans tiktok/, puis cards/, puis SENTENCE_OVERRIDE
  const sentencesJsonPath = join(stagingDir, 'sentences.json');
  const sentencesJsonFallback = join(CARDS_DIR, 'cards', kanji, 'sentences.json');
  const sentencesData = existsSync(sentencesJsonPath)
    ? JSON.parse(readFileSync(sentencesJsonPath, 'utf8')).slice(0, 2)
    : existsSync(sentencesJsonFallback)
      ? JSON.parse(readFileSync(sentencesJsonFallback, 'utf8')).slice(0, 2)
      : (SENTENCE_OVERRIDE[kanji] || []).slice(0, 2);
  const tts3aText  = sentencesData[0]?.jp || `${kanji}を使った文です。`;
  const tts3bText  = sentencesData[1]?.jp || null;

  try {
    // Generate TTS audio files — intro is silent (hook visuel uniquement)
    // Card 1: 1 mp3 per reading
    const read1Files = [];
    for (let i = 0; i < tts1Items.length; i++) {
      const f = join(TMP, `${kanji}_1r${i}.mp3`);
      await tts(tts1Items[i], f);
      read1Files.push(f);
    }
    // Card 2: 1 mp3 per vocab word
    const mp3_2a = join(TMP, `${kanji}_2a.mp3`);
    const mp3_2b = join(TMP, `${kanji}_2b.mp3`);
    const mp3_2c = join(TMP, `${kanji}_2c.mp3`);
    const mp3_3a = join(TMP, `${kanji}_3a.mp3`);
    const mp3_3b = join(TMP, `${kanji}_3b.mp3`);
    const vocab2Files = [];
    for (let i = 0; i < vocabTtsTexts.length; i++) {
      const f = [mp3_2a, mp3_2b, mp3_2c][i];
      await tts(vocabTtsTexts[i], f);
      vocab2Files.push(f);
    }
    await tts(tts3aText, mp3_3a);
    if (tts3bText) await tts(tts3bText, mp3_3b);

    // Durées visibles souhaitées (ce que l'utilisateur voit réellement)
    const INTRO_DUR = 3;   // intro floue
    const DUR1      = 8;   // carte kanji
    const DUR2      = 8;   // carte vocab
    const DUR3      = 9;   // carte phrases
    const CTA_DUR   = 8;   // CTA
    const TOTAL     = INTRO_DUR + DUR1 + DUR2 + DUR3 + CTA_DUR; // = 36s output réel

    // xfade entre chaque segment : pour que l'output = durées visibles,
    // chaque segment brut = durée visible + XFADE (sauf le dernier)
    // output = sum(bruts) - (n-1)*XFADE = sum(visibles) ✓
    const XFADE     = 0.5;
    const s = [INTRO_DUR, DUR1, DUR2, DUR3, CTA_DUR];
    const bruts = s.map((d, i) => i < s.length - 1 ? d + XFADE : d);

    // Audio card 1 : calé sur la durée visible DUR1
    const mp3_1raw = join(TMP, `${kanji}_1raw.mp3`);
    assembleWithDynamicGaps(read1Files, DUR1, 0.8, mp3_1raw);

    // Audio card 2
    const mp3_2raw = join(TMP, `${kanji}_2raw.mp3`);
    assembleWithDynamicGaps(vocab2Files, DUR2, 0.8, mp3_2raw);

    // Audio card 3 : gap adaptatif | gap | phrase1 | gap | phrase2 | gap |
    const mp3_3pre = join(TMP, `${kanji}_3pre.mp3`);
    const mp3_3raw = join(TMP, `${kanji}_3raw.mp3`);
    {
      const dur3a = getAudioDuration(mp3_3a);
      const dur3b = (tts3bText && existsSync(mp3_3b)) ? getAudioDuration(mp3_3b) : 0;
      const gap3  = Math.max(1.0, (DUR3 - dur3a - dur3b) / 3);
      prependSilence(mp3_3a, mp3_3pre, gap3);
      if (tts3bText && existsSync(mp3_3b)) {
        concatAudioWithGap(mp3_3pre, mp3_3b, gap3, mp3_3raw);
      } else {
        spawnSync(FFMPEG, ['-y', '-i', mp3_3pre, '-c', 'copy', mp3_3raw], { encoding: 'utf8' });
      }
    }

    // Pad audios aux durées brutes (visible + XFADE) sauf CTA (pas de pad)
    const pad1 = join(TMP, `${kanji}_1p.mp3`);
    const pad2 = join(TMP, `${kanji}_2p.mp3`);
    const pad3 = join(TMP, `${kanji}_3p.mp3`);
    padAudio(mp3_1raw, pad1, bruts[1]);
    padAudio(mp3_2raw, pad2, bruts[2]);
    padAudio(mp3_3raw, pad3, bruts[3]);

    // CTA footage
    const appScreenshot = join(ROOT, 'kanji-cards', 'CTA_Footage.mp4');
    if (!existsSync(appScreenshot)) throw new Error('kanji-cards/CTA_Footage.mp4 manquant');

    console.log(`   📹 [${s.join('+')}s = ${TOTAL}s output — segments bruts ${bruts.map(b=>b.toFixed(1)).join('+')}s]`);

    // Build segments avec durées brutes
    const seg0 = join(TMP, `${kanji}_seg0.mp4`);
    const seg1 = join(TMP, `${kanji}_seg1.mp4`);
    const seg2 = join(TMP, `${kanji}_seg2.mp4`);
    const seg3 = join(TMP, `${kanji}_seg3.mp4`);
    const seg4 = join(TMP, `${kanji}_seg4.mp4`);
    blurIntroVideo(card1, seg0, bruts[0], null);
    imageToVideo(card1, pad1, seg1);
    imageToVideo(card2, pad2, seg2);
    imageToVideo(card3, pad3, seg3);
    ctaVideo(appScreenshot, seg4, bruts[4]);

    const rawFile = BGM_VOL > 0 ? join(TMP, `${kanji}_raw.mp4`) : outFile;
    concatWithXFade(
      [seg0, seg1, seg2, seg3, seg4],
      bruts,
      rawFile,
      XFADE   // même fade partout
    );

    // Mix BGM
    if (BGM_VOL > 0) {
      const bgmFile = join(ROOT, 'kanji-cards', 'bgm.mp3');
      if (!existsSync(bgmFile)) throw new Error('kanji-cards/bgm.mp3 manquant (requis pour --bgm-vol)');
      const r = spawnSync(FFMPEG, ['-y',
        '-i', rawFile,
        '-stream_loop', '-1', '-i', bgmFile,
        '-t', String(TOTAL),
        '-filter_complex', `[1:a]volume=${BGM_VOL},afade=t=in:st=0:d=1.5,afade=t=out:st=${TOTAL - 2}:d=2[bgm];[0:a][bgm]amix=inputs=2:duration=first:normalize=0[aout]`,
        '-map', '0:v', '-map', '[aout]',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
        '-movflags', '+faststart',
        outFile,
      ], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error('BGM mix failed: ' + r.stderr.slice(-400));
      try { unlinkSync(rawFile); } catch {}
    }

    // Cleanup tmp files
    for (const f of [...read1Files, mp3_1raw, mp3_2a, mp3_2b, mp3_2c, mp3_2raw, mp3_3a, mp3_3b, mp3_3pre, mp3_3raw, pad1, pad2, pad3, seg0, seg1, seg2, seg3, seg4]) {
      try { unlinkSync(f); } catch {}
    }
    try { unlinkSync(pad1 + '.pre.mp3'); } catch {}

    // Cards kept permanently — ne pas supprimer

    console.log(`✅ ${kanji} → reels/${kanji}.mp4`);
    ok++;
  } catch (e) {
    console.error(`❌ ${kanji}: ${e.message}`);
  }
}

// Cleanup tmp dir if empty
// (ne pas supprimer cards/ — contenu permanent)
// Cards conservées (ne pas supprimer)

console.log(`\n🎉 ${ok}/${targetKanji.length} reels générés`);
console.log(`   kanji-cards/${DIR}/reels/*.mp4\n`);
