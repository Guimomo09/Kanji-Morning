/**
 * generate-memo-reels.mjs — Concept 2 "Mémo visuel"
 * Usage :
 *   node scripts/generate-memo-reels.mjs --id yasumu-rest
 *   node scripts/generate-memo-reels.mjs --all
 */

import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { ROOT, renderScenario, cleanTmpDir, closeBrowser } from './reels/render-engine.mjs';
import { MEMO_ITEMS, getMemoItem } from './reels/scenes/memo.mjs';
import { buildMemoShots } from './reels/scenes/build-memo-scenario.mjs';

const args = process.argv.slice(2);
const get = (f, d) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : d; };
const has = f => args.includes(f);

const OUT_DIR = get('--out-dir', join(ROOT, 'kanji-cards', 'reels-v2', 'memo'));
mkdirSync(OUT_DIR, { recursive: true });

const ids = has('--all') ? MEMO_ITEMS.map(m => m.id) : [get('--id', MEMO_ITEMS[0].id)];

console.log(`\n🎬 Mémo visuel — ${ids.length} reel(s): ${ids.join(', ')}\n`);

let ok = 0;
for (const id of ids) {
  const item = getMemoItem(id);
  const outFile = get('--out', join(OUT_DIR, `${id}.mp4`));
  const tmpDir = join(ROOT, '.reels-tmp', `memo-${id}`);

  console.log(`▶ ${id} — "${item.hookQuestion}"`);
  try {
    const shots = buildMemoShots(item);
    const { totalDur } = await renderScenario(shots, outFile, { tmpDir, fadeDur: 0.3 });
    cleanTmpDir(tmpDir);
    console.log(`✅ ${id} → ${outFile} (${totalDur.toFixed(1)}s)`);
    ok++;
  } catch (e) {
    console.error(`❌ ${id}: ${e.message}`);
  }
}

await closeBrowser();
console.log(`\n🎉 ${ok}/${ids.length} reels générés dans ${OUT_DIR}\n`);
