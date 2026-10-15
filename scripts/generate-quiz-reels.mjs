/**
 * generate-quiz-reels.mjs
 *
 * "Quick review" quiz reel — recall format testing a word already published
 * in an earlier reel/card (see source field in scripts/reels/scenes/quiz.mjs).
 * Reuses the shared render engine (scripts/reels/render-engine.mjs).
 *
 * Usage :
 *   node scripts/generate-quiz-reels.mjs --id kiku-listen
 *   node scripts/generate-quiz-reels.mjs --all
 *   node scripts/generate-quiz-reels.mjs --id kiku-listen --out kanji-cards/reels-v3/quiz-kiku-listen.mp4
 */

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ROOT, renderScenario, cleanTmpDir, closeBrowser } from './reels/render-engine.mjs';
import { QUIZ_ITEMS, getQuizItem } from './reels/scenes/quiz.mjs';
import { buildQuizShots } from './reels/scenes/build-quiz-scenario.mjs';

const args = process.argv.slice(2);
const get = (f, d) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : d; };
const has = f => args.includes(f);

const OUT_DIR = get('--out-dir', join(ROOT, 'kanji-cards', 'reels-v3', 'quiz'));
mkdirSync(OUT_DIR, { recursive: true });

// Soft background bed under the whole reel — without it, the silent countdown
// and suspense beats leave long dead-air stretches that make the reel feel
// empty. Low volume (0.05) so it never competes with narration/JP pronunciation.
const BGM_FILE = join(ROOT, 'kanji-cards', 'bgm.mp3');
const bgmFile = existsSync(BGM_FILE) ? BGM_FILE : null;
if (!bgmFile) console.warn('⚠️  kanji-cards/bgm.mp3 absent — reels générés sans musique de fond');

let ids;
if (has('--all')) {
  ids = QUIZ_ITEMS.map(q => q.id);
} else {
  const id = get('--id', QUIZ_ITEMS[0].id);
  ids = [id];
}

console.log(`\n🎬 Quick review quiz — ${ids.length} reel(s): ${ids.join(', ')}\n`);

let ok = 0;
for (const id of ids) {
  const item = getQuizItem(id);
  const outFile = get('--out', join(OUT_DIR, `${id}.mp4`));
  const tmpDir = join(ROOT, '.reels-tmp', `quiz-${id}`);

  console.log(`▶ ${id} — "${item.question}"`);
  try {
    const shots = buildQuizShots(item);
    const { totalDur } = await renderScenario(shots, outFile, { tmpDir, fadeDur: 0.3, fadeOutDur: 0.8, bgmFile, bgmVol: 0.05 });
    cleanTmpDir(tmpDir);
    console.log(`✅ ${id} → ${outFile} (${totalDur.toFixed(1)}s)`);
    ok++;
  } catch (e) {
    console.error(`❌ ${id}: ${e.message}`);
  }
}

await closeBrowser();
console.log(`\n🎉 ${ok}/${ids.length} reels générés dans ${OUT_DIR}\n`);
