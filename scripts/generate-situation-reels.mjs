/**
 * generate-situation-reels.mjs — Concept 3 "Japonais en situation"
 * Usage :
 *   node scripts/generate-situation-reels.mjs --id deguchi-station
 *   node scripts/generate-situation-reels.mjs --all
 */

import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { ROOT, renderScenario, cleanTmpDir, closeBrowser } from './reels/render-engine.mjs';
import { SITUATION_ITEMS, getSituationItem } from './reels/scenes/situation.mjs';
import { buildSituationShots } from './reels/scenes/build-situation-scenario.mjs';

const args = process.argv.slice(2);
const get = (f, d) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : d; };
const has = f => args.includes(f);

const OUT_DIR = get('--out-dir', join(ROOT, 'kanji-cards', 'reels-v2', 'situation'));
mkdirSync(OUT_DIR, { recursive: true });

const ids = has('--all') ? SITUATION_ITEMS.map(s => s.id) : [get('--id', SITUATION_ITEMS[0].id)];

console.log(`\n🎬 Japonais en situation — ${ids.length} reel(s): ${ids.join(', ')}\n`);

let ok = 0;
for (const id of ids) {
  const item = getSituationItem(id);
  const outFile = get('--out', join(OUT_DIR, `${id}.mp4`));
  const tmpDir = join(ROOT, '.reels-tmp', `situation-${id}`);

  console.log(`▶ ${id} — "${item.question}"`);
  try {
    const shots = buildSituationShots(item);
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
