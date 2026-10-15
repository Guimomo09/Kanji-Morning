/**
 * render-engine.mjs — moteur de rendu partagé pour les nouveaux formats de reels.
 *
 * Sépare le CONTENU (scènes JS : texte, timing, kanji cités) du RENDU
 * (Playwright HTML→PNG pour chaque frame visuelle, edge-tts pour la voix,
 * ffmpeg pour l'assemblage). Réutilise exactement les mêmes briques que
 * generate-kanji-cards.mjs / generate-reels.mjs (aucune nouvelle dépendance).
 *
 * Un "scénario" (voir scripts/reels/scenes/*.mjs) est une liste de shots :
 *   { html, duration, audioText? | audioFile?, captionText? }
 * Chaque shot devient un segment vidéo ; les segments sont enchaînés avec
 * un fondu (xfade/acrossfade), comme dans generate-reels.mjs.
 */

import { readFileSync, mkdirSync, existsSync, unlinkSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..', '..');

// ── CTA générique (extraits app réels, capturés une fois pour toutes) ─────────
// scripts/capture-app-demo.mjs produit kanji-cards/app-demo/<kanji>-cta.mp4.
// Comme le kanji filmé ne correspond pas forcément à celui du reel, on pioche
// un extrait existant (round-robin déterministe sur un id) plutôt que de
// prétendre montrer le kanji du reel — le CTA reste une invitation générale.
const APP_DEMO_DIR = join(ROOT, 'kanji-cards', 'app-demo');
export function pickCtaVideo(seedId = '') {
  if (!existsSync(APP_DEMO_DIR)) return null;
  const files = require('fs').readdirSync(APP_DEMO_DIR).filter(f => f.endsWith('-cta.mp4')).sort();
  if (files.length === 0) return null;
  let hash = 0;
  for (const ch of String(seedId)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return join(APP_DEMO_DIR, files[hash % files.length]);
}

// ── Binaries ──────────────────────────────────────────────────────────────────
export function findFfmpeg() {
  const staticPath = join(ROOT, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
  if (existsSync(staticPath)) return staticPath;
  const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (r.status === 0) return 'ffmpeg';
  throw new Error('ffmpeg introuvable.');
}
export const FFMPEG = findFfmpeg();
export const FFPROBE = (() => {
  try { return require('ffprobe-static').path; } catch {}
  return FFMPEG.replace('ffmpeg.exe', 'ffprobe.exe');
})();

function findPython() {
  const store = 'C:\\Users\\Charles\\AppData\\Local\\Microsoft\\WindowsApps\\python3.13.exe';
  if (existsSync(store)) return store;
  for (const cmd of ['python3', 'python']) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return cmd;
  }
  throw new Error('Python introuvable. Installez Python 3.');
}
export const PYTHON = findPython();

// ── TTS (edge-tts) ────────────────────────────────────────────────────────────
// voice: e.g. 'ja-JP-NanamiNeural' (JP) or 'fr-FR-DeniseNeural' (narration FR)
export async function tts(text, outMp3, voice = 'ja-JP-NanamiNeural', rate = '+0%') {
  const outWav = outMp3.replace(/\.mp3$/, '.wav');
  const r = spawnSync(PYTHON, [
    '-m', 'edge_tts',
    '--voice', voice,
    `--rate=${rate}`,
    '--text', text,
    '--write-media', outWav,
  ], { encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) throw new Error(`edge-tts failed: ${r.stderr}`);
  spawnSync(FFMPEG, ['-y', '-i', outWav, '-codec:a', 'libmp3lame', '-q:a', '2', outMp3], { encoding: 'utf8' });
  unlinkSync(outWav);
}

// ── Audio helpers ─────────────────────────────────────────────────────────────
export function getAudioDuration(file) {
  const r = spawnSync(FFPROBE, [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ], { encoding: 'utf8' });
  return parseFloat(r.stdout.trim()) || 0;
}

export function padAudio(inp, outFile, dur) {
  spawnSync(FFMPEG, ['-y', '-i', inp, '-af', `apad=whole_dur=${dur}`, '-t', String(dur), outFile], { encoding: 'utf8' });
}

export function silentAudio(outFile, dur) {
  spawnSync(FFMPEG, ['-y', '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo', outFile], { encoding: 'utf8' });
}

// Prepend silence before an audio file
export function prependSilence(inp, outFile, silenceSec) {
  if (silenceSec <= 0) { spawnSync(FFMPEG, ['-y', '-i', inp, '-c', 'copy', outFile], { encoding: 'utf8' }); return; }
  spawnSync(FFMPEG, ['-y',
    '-f', 'lavfi', '-t', String(silenceSec), '-i', 'anullsrc=r=44100:cl=stereo',
    '-i', inp,
    '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[aout]',
    '-map', '[aout]',
    outFile,
  ], { encoding: 'utf8' });
}

// Center an audio clip within totalDur (equal silence before/after, min buffer)
export function centerAudio(inp, outFile, totalDur, minBuf = 0.3) {
  const voiceDur = getAudioDuration(inp);
  const pre = Math.max(minBuf, (totalDur - voiceDur) / 2);
  const tmp = outFile + '.pre.mp3';
  prependSilence(inp, tmp, pre);
  padAudio(tmp, outFile, totalDur);
  try { unlinkSync(tmp); } catch {}
}

// Lead an audio clip near the START of totalDur (small fixed pre-roll, the
// rest of the segment is trailing silence). Used instead of centerAudio when
// shots with narration are placed back-to-back with no silent shot between
// them: centering can push a voice clip's tail right up against the segment's
// xfade boundary, where the 0.3s acrossfade into the next (also-narrated)
// clip blends/clips both voices together. Leading keeps the voice's tail far
// from that boundary so consecutive narrations never bleed into each other.
export function leadAudio(inp, outFile, totalDur, pre = 0.15) {
  const tmp = outFile + '.pre.mp3';
  prependSilence(inp, tmp, pre);
  padAudio(tmp, outFile, totalDur);
  try { unlinkSync(tmp); } catch {}
}

// ── Playwright HTML → PNG ─────────────────────────────────────────────────────
let _browser = null;
export async function getBrowser() {
  if (_browser) return _browser;
  const { chromium } = await import('playwright');
  _browser = await chromium.launch({ headless: true });
  return _browser;
}
export async function closeBrowser() {
  if (_browser) { await _browser.close(); _browser = null; }
}

// CJK text (e.g. 聞く) mixes dense glyphs (聞) with thin/diagonal ones (く) that
// leave uneven side-bearing — the CSS box centers correctly, but the visible
// ink doesn't, so it looks off-center. This measures each [data-optical-center]
// element's actual rendered ink bounding box via canvas.measureText and nudges
// it with a transform so the ink — not just the box — sits on the true center.
const OPTICAL_CENTER_SCRIPT = `
  document.querySelectorAll('[data-optical-center]').forEach(el => {
    const style = getComputedStyle(el);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = \`\${style.fontWeight} \${style.fontSize} \${style.fontFamily}\`;
    const m = ctx.measureText(el.textContent);
    const boxWidth = el.getBoundingClientRect().width;
    const inkCenter = (m.actualBoundingBoxLeft !== undefined
      ? (-m.actualBoundingBoxLeft + m.actualBoundingBoxRight) / 2
      : m.width / 2);
    const boxCenter = boxWidth / 2;
    const shift = boxCenter - inkCenter - (boxWidth - m.width) / 2;
    el.style.transform = \`translateX(\${shift}px)\`;
  });
`;

export async function renderHtmlToPng(html, outPath, width = 1080, height = 1920, transparent = false) {
  const browser = await getBrowser();
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const tmpPath = outPath.replace(/\.png$/, '_tmp.html');
  writeFileSync(tmpPath, html, 'utf8');
  try {
    await page.goto(`file:///${tmpPath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(350);
    await page.evaluate(OPTICAL_CENTER_SCRIPT);
    await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width, height }, omitBackground: transparent });
  } finally {
    unlinkSync(tmpPath);
    await ctx.close();
  }
}

// ── Video segment builders ────────────────────────────────────────────────────
// Static image + audio → video segment of exactly `dur` seconds
export function imageToVideo(img, audio, outFile, dur, bg = '#faf7f2') {
  const r = spawnSync(FFMPEG, ['-y',
    '-loop', '1', '-i', img,
    '-i', audio,
    '-t', String(dur),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-profile:v', 'baseline', '-level', '4.0', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart',
    '-vf', `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=${bg}`,
    '-r', '30',
    outFile,
  ], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('imageToVideo failed: ' + r.stderr.slice(-500));
}

// Video clip (e.g. app demo capture), trimmed/padded to `dur`, with given audio.
// textLines (optional) burns a short CTA directly onto the footage (readable
// box, bottom third) instead of a separate static "ad" screen before it.
export function clipToVideo(srcVideo, audio, outFile, dur, srcStart = 0, textLines = null) {
  const scalePad = 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=#faf7f2';
  let vf = scalePad;
  if (textLines && textLines.length) {
    const esc = s => String(s).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\u2019");
    const boxH = 90 + textLines.length * 100;
    const drawBox = `drawbox=x=0:y=ih-${boxH}:w=iw:h=${boxH}:color=#c03a20@0.92:t=fill`;
    const drawTexts = textLines.map((line, i) => {
      const y = `h-${boxH - 40 - i * 100}`;
      const size = i === 0 ? 46 : 34;
      return `drawtext=text='${esc(line)}':fontcolor=white:fontsize=${size}:fontfile='C\\:/Windows/Fonts/arial.ttf':x=(w-text_w)/2:y=${y}`;
    }).join(',');
    vf = `${scalePad},${drawBox},${drawTexts}`;
  }
  const r = spawnSync(FFMPEG, ['-y',
    '-ss', String(srcStart), '-i', srcVideo,
    '-i', audio,
    '-t', String(dur),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-profile:v', 'baseline', '-level', '4.0', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart',
    '-vf', vf,
    '-r', '30',
    outFile,
  ], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('clipToVideo failed: ' + r.stderr.slice(-800));
}

// Concatenate video segments with xfade dissolve + acrossfade between each.
// fadeOutDur (optional) adds a fade-to-background (cream #faf7f2, matching
// the brand) + audio fade-out over the last N seconds of the final output.
export function concatWithXFade(segments, durations, outFile, fadeDur = 0.35, fadeOutDur = 0) {
  const n = segments.length;
  const totalDur = durations.reduce((a, b) => a + b, 0) - fadeDur * Math.max(0, n - 1);
  const fadeOutStart = Math.max(0, totalDur - fadeOutDur);

  if (n === 1) {
    if (fadeOutDur > 0) {
      const r = spawnSync(FFMPEG, ['-y', '-i', segments[0],
        '-vf', `fade=t=out:st=${fadeOutStart}:d=${fadeOutDur}:color=#faf7f2`,
        '-af', `afade=t=out:st=${fadeOutStart}:d=${fadeOutDur}`,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-profile:v', 'baseline', '-level', '4.0', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        outFile,
      ], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error('concatWithXFade (fadeOut, n=1) failed: ' + r.stderr.slice(-800));
    } else {
      spawnSync(FFMPEG, ['-y', '-i', segments[0], '-c', 'copy', outFile], { encoding: 'utf8' });
    }
    return;
  }
  const inputs = segments.flatMap(s => ['-i', s]);
  const fades = Array(n - 1).fill(fadeDur);

  const offsets = [];
  let t = 0;
  for (let i = 0; i < n - 1; i++) {
    t += durations[i] - fades[i];
    offsets.push(+t.toFixed(3));
  }

  let vPrev = '0:v';
  const vParts = [];
  for (let i = 1; i < n; i++) {
    const out = i === n - 1 ? (fadeOutDur > 0 ? 'vxf' : 'vout') : `v${i}`;
    vParts.push(`[${vPrev}][${i}:v]xfade=transition=fade:duration=${fades[i - 1]}:offset=${offsets[i - 1]}[${out}]`);
    vPrev = out;
  }
  if (fadeOutDur > 0) {
    vParts.push(`[vxf]fade=t=out:st=${fadeOutStart}:d=${fadeOutDur}:color=#faf7f2[vout]`);
  }

  let aPrev = '0:a';
  const aParts = [];
  for (let i = 1; i < n; i++) {
    const out = i === n - 1 ? (fadeOutDur > 0 ? 'axf' : 'aout') : `a${i}`;
    aParts.push(`[${aPrev}][${i}:a]acrossfade=d=${fades[i - 1]}[${out}]`);
    aPrev = out;
  }
  if (fadeOutDur > 0) {
    aParts.push(`[axf]afade=t=out:st=${fadeOutStart}:d=${fadeOutDur}[aout]`);
  }

  const filterComplex = [...vParts, ...aParts].join(';');
  const r = spawnSync(FFMPEG, ['-y',
    ...inputs,
    '-filter_complex', filterComplex,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-profile:v', 'baseline', '-level', '4.0', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart',
    outFile,
  ], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('concatWithXFade failed: ' + r.stderr.slice(-800));
}

// Mux background music under the final track (kept optional, off by default per brief)
export function mixBgm(rawFile, bgmFile, outFile, totalDur, vol = 0.06) {
  const r = spawnSync(FFMPEG, ['-y',
    '-i', rawFile,
    '-stream_loop', '-1', '-i', bgmFile,
    '-t', String(totalDur),
    '-filter_complex', `[1:a]volume=${vol},afade=t=in:st=0:d=1,afade=t=out:st=${totalDur - 1.5}:d=1.5[bgm];[0:a][bgm]amix=inputs=2:duration=first:normalize=0[aout]`,
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart',
    outFile,
  ], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('mixBgm failed: ' + r.stderr.slice(-500));
}

// ── High-level: render a full scenario (list of shots) to one MP4 ────────────
/**
 * shot = {
 *   html: string,                     // full HTML doc for this shot's visual
 *   duration: number,                 // desired visible seconds (before fade padding)
 *   audioText?: string,                // JP text to synthesize via edge-tts
 *   audioVoice?: string,               // edge-tts voice, default ja-JP-NanamiNeural
 *   audioFile?: string,                // pre-existing audio file (skips TTS)
 *   silent?: boolean,                  // no audio (hook/pause beats)
 *   sourceVideo?: string,              // use a real video clip instead of a static PNG
 *   sourceVideoStart?: number,
 *   textLines?: string[],              // burn CTA text directly onto sourceVideo footage
 * }
 */
export async function renderScenario(shots, outFile, { tmpDir, fadeDur = 0.35, fadeOutDur = 0, bgmFile = null, bgmVol = 0.06 } = {}) {
  mkdirSync(tmpDir, { recursive: true });
  const segFiles = [];
  const rawDurations = shots.map(s => s.duration);
  // Raw segment length = visible + fade (except last), so post-xfade output = sum(visible)
  const bruts = rawDurations.map((d, i) => i < rawDurations.length - 1 ? d + fadeDur : d);

  const cleanupFiles = [];

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const segFile = join(tmpDir, `seg${i}.mp4`);
    let audioFile;

    if (shot.silent) {
      audioFile = join(tmpDir, `sil${i}.mp3`);
      silentAudio(audioFile, bruts[i]);
      cleanupFiles.push(audioFile);
    } else if (shot.audioFile) {
      audioFile = join(tmpDir, `aud${i}_padded.mp3`);
      padAudio(shot.audioFile, audioFile, bruts[i]);
      cleanupFiles.push(audioFile);
    } else if (shot.audioText) {
      const raw = join(tmpDir, `aud${i}_raw.mp3`);
      await tts(shot.audioText, raw, shot.audioVoice || 'ja-JP-NanamiNeural', shot.audioRate || '+0%');
      audioFile = join(tmpDir, `aud${i}_padded.mp3`);
      // audioLead: place the voice near the segment start instead of centering
      // it — use for narrated shots placed back-to-back (no silent shot between
      // them), so a voice's tail never sits against the xfade into the next
      // narrated clip (see leadAudio doc comment).
      if (shot.audioLead) leadAudio(raw, audioFile, bruts[i], 0.15);
      else centerAudio(raw, audioFile, bruts[i], 0.2);
      cleanupFiles.push(raw, audioFile);
    } else {
      audioFile = join(tmpDir, `sil${i}.mp3`);
      silentAudio(audioFile, bruts[i]);
      cleanupFiles.push(audioFile);
    }

    if (shot.sourceVideo) {
      clipToVideo(shot.sourceVideo, audioFile, segFile, bruts[i], shot.sourceVideoStart || 0, shot.textLines || null);
    } else {
      const imgFile = join(tmpDir, `shot${i}.png`);
      await renderHtmlToPng(shot.html, imgFile);
      imageToVideo(imgFile, audioFile, segFile, bruts[i]);
      cleanupFiles.push(imgFile);
    }

    segFiles.push(segFile);
    cleanupFiles.push(segFile);
  }

  const totalDur = rawDurations.reduce((a, b) => a + b, 0);
  const rawOut = bgmFile ? join(tmpDir, 'raw_nobgm.mp4') : outFile;
  concatWithXFade(segFiles, bruts, rawOut, fadeDur, fadeOutDur);

  if (bgmFile) {
    mixBgm(rawOut, bgmFile, outFile, totalDur, bgmVol);
    cleanupFiles.push(rawOut);
  }

  for (const f of cleanupFiles) { try { unlinkSync(f); } catch {} }

  return { outFile, totalDur };
}

export function cleanTmpDir(tmpDir) {
  // Guard against a Node/Windows crash (exit 127, no JS error) triggered by
  // rmSync on a non-ASCII path that doesn't exist — see capture-app-demo.mjs.
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
}
