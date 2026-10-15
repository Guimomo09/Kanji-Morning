/**
 * capture-app-demo.mjs
 *
 * Enregistre, pour un ou plusieurs kanji, un parcours utilisateur réel sur
 * asanokanji.com (viewport mobile 390×844, tactile) : ouverture, fermeture
 * du tutoriel, recherche de sa vraie fiche dans la grille (via "New
 * Selection" répété — l'app n'a aujourd'hui aucun moyen fiable de cibler
 * un kanji précis, voir notes ci-dessous), prononciation, sauvegarde de CE
 * kanji précis dans My List, vérification.
 *
 * Sortie par kanji (nommage prévisible pour le montage) :
 *   kanji-cards/app-demo/<kanji>.mp4      — parcours complet muet (1080×1920)
 *   kanji-cards/app-demo/<kanji>-cta.mp4  — extrait court (My List, ~2.5s)
 *
 * Isolation : chaque kanji tourne dans son propre contexte navigateur
 * (nouveau localStorage/cookies), donc "My List" repart de zéro à chaque
 * capture — aucune accumulation de favoris entre les kanji.
 *
 * ── Note sur le ciblage ──────────────────────────────────────────────────
 * L'app n'expose aucun moyen fiable de charger directement la fiche d'un
 * kanji précis :
 *   - Le lien `?k=<kanji>` utilisé par les pages SEO statiques (public/
 *     jlpt-n5.html etc.) n'est câblé à aucun code dans l'app (mort).
 *   - La recherche de l'onglet Kanji (#searchInput, masqué depuis que ce
 *     tab a été "merged into tabVocab" — voir src/ui.js:34) a un bug réel
 *     en production : elle vide la grille et ne la repeuple jamais quel
 *     que soit le kanji recherché (vérifié avec plusieurs approches
 *     Playwright — appel direct de window.filterGrid(), frappe clavier
 *     réelle, attente longue : aucune ne fonctionne).
 * En attendant un correctif de l'app, ce script utilise donc le vrai
 * comportement de l'onglet Vocab (mode réellement utilisé par les
 * visiteurs), filtre "All" (pas de restriction de niveau — testé : avec le
 * filtre strict sur le niveau JLPT du kanji, la probabilité par tirage
 * s'effondre car l'app n'accepte que les mots dont TOUS les kanji sont du
 * même niveau ; ex. pour 木/N5, seuls 5 mots sur ~40 candidats fréquents
 * passent ce filtre strict, noyés dans un pool de 79 kanji N5 — quasi
 * introuvable même après 40 tirages) + clics répétés sur "New Selection"
 * (shuffle aléatoire) jusqu'à ce qu'un mot contenant ce kanji apparaisse
 * dans la grille — plafonné à --max-shuffles tentatives. Un kanji non
 * trouvé dans ce budget est signalé et n'interrompt pas les autres
 * captures.
 *
 * N'écrit sur aucun compte personnel — session anonyme à chaque fois, pas
 * de sign-in. Ne publie rien.
 *
 * Dépendances : Playwright (déjà utilisé par generate-kanji-cards.mjs),
 * ffmpeg (déjà utilisé par generate-reels.mjs). Aucune nouvelle dépendance.
 *
 * Usage :
 *   # Un seul kanji
 *   node scripts/capture-app-demo.mjs --kanji 木
 *
 *   # Liste explicite (même syntaxe que generate-reels.mjs --kanji)
 *   node scripts/capture-app-demo.mjs --kanji 木,休,出
 *
 *   # Réutilise la liste du pipeline reels quotidien (cartes déjà générées)
 *   node scripts/capture-app-demo.mjs --from-dir kanji-cards/n5/tiktok
 *
 *   # Réglages optionnels
 *   node scripts/capture-app-demo.mjs --kanji 木 --max-shuffles 20 --session-retries 2 --url https://kanji.guimo-prod.com
 *
 * Flags :
 *   --kanji <a,b,c>       liste de kanji, séparés par des virgules
 *   --from-dir <dir>      lit les kanji depuis les noms de sous-dossiers (ex: kanji-cards/n5/tiktok)
 *   --out-dir <dir>       dossier de sortie (défaut: kanji-cards/app-demo)
 *   --max-shuffles <n>    tentatives "New Selection" avant d'abandonner un kanji (défaut: 20)
 *   --session-retries <n> nb de sessions fraîches retentées si la 1ère échoue (défaut: 2)
 *   --cta-duration <s>    durée de l'extrait CTA en secondes (défaut: 2.5)
 *   --url <url>           URL de l'app (défaut: https://asanokanji.com/)
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const get = (f, d) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : d; };
const has = f => args.includes(f);

const URL          = get('--url', 'https://asanokanji.com/');
const OUT_DIR       = get('--out-dir', join(ROOT, 'kanji-cards', 'app-demo'));
const MAX_SHUFFLES = parseInt(get('--max-shuffles', '20'), 10);
const SESSION_RETRIES = parseInt(get('--session-retries', '2'), 10);
const CTA_DUR       = parseFloat(get('--cta-duration', '2.5'));

function findFfmpeg() {
  const staticPath = join(ROOT, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
  if (existsSync(staticPath)) return staticPath;
  const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (r.status === 0) return 'ffmpeg';
  throw new Error('ffmpeg introuvable.');
}
const FFMPEG = findFfmpeg();
const FFPROBE = (() => {
  try { return require('ffprobe-static').path; } catch {}
  return FFMPEG.replace('ffmpeg.exe', 'ffprobe.exe');
})();

// ── Target kanji list ─────────────────────────────────────────────────────
const KANJI_INDEX = JSON.parse(readFileSync(join(ROOT, 'public', 'kanji_index.json'), 'utf8'));

let targetKanji;
if (get('--kanji', null)) {
  targetKanji = get('--kanji').split(',').map(k => k.trim()).filter(Boolean);
} else if (get('--from-dir', null)) {
  const dir = get('--from-dir');
  if (!existsSync(dir)) {
    console.error(`❌ Dossier introuvable: ${dir}`);
    process.exit(1);
  }
  targetKanji = readdirSync(dir).filter(d => /^[一-鿿㐀-䶿]$/.test(d));
} else {
  console.error('❌ Fournis --kanji 木,休,出 ou --from-dir kanji-cards/n5/tiktok');
  process.exit(1);
}

if (!targetKanji.length) {
  console.error('❌ Aucun kanji à capturer.');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

console.log(`\n🎬 Capture démo app — ${targetKanji.length} kanji: ${targetKanji.join(' ')}\n`);

// ── Per-kanji capture ─────────────────────────────────────────────────────
// Thin wrapper: whatever captureOneInner returns (success or any failure
// status), always sweep its scratch dir afterward so a not_found/save_failed
// run doesn't leave its raw .webm recording behind.
async function captureOne(kanji) {
  const safeName = KANJI_INDEX[kanji] ? 'u' + kanji.codePointAt(0).toString(16) : null;
  const tmpDir = safeName ? join(ROOT, '.reels-tmp', `app-demo-video-${safeName}`) : null;
  try {
    return await captureOneInner(kanji, tmpDir);
  } finally {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function captureOneInner(kanji, tmpDir) {
  const data = KANJI_INDEX[kanji];
  if (!data) {
    console.warn(`⚠️  ${kanji}: absent de public/kanji_index.json — kanji introuvable dans l'app, capture ignorée.`);
    return { kanji, status: 'not_in_index' };
  }
  const jlptNum = data.j; // 5..1
  // tmpDir uses an ASCII-safe name (Unicode codepoint, e.g. "u611b" for 愛)
  // — Node's rmSync crashes the whole process (exit 127, no JS error/stack)
  // when called (even with force:true, even on an empty existing dir) on a
  // path containing a kanji character on this Windows/Node setup. The final
  // output filename still uses the real kanji — only the *deleted* scratch
  // dir needs to dodge the bug (see the captureOne wrapper above too).
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  // Fresh, isolated browser context per kanji — no shared localStorage/cookies,
  // so My List / saved favorites never accumulate across captures.
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    recordVideo: { dir: tmpDir, size: { width: 390, height: 844 } },
  });
  const page = await ctx.newPage();

  let found = false;
  let attempts = 0;

  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1200);

    const tutClose = page.locator('.tutorial-close');
    if (await tutClose.isVisible().catch(() => false)) {
      await tutClose.click();
    }
    await page.waitForTimeout(900);

    await page.locator('#tabVocab').click({ timeout: 10000 });
    await page.waitForSelector('.level-filter', { timeout: 10000 });

    // Filter "All" (no level restriction). Filtering to the kanji's own JLPT
    // level was tried first but makes the target near-unreachable: the app
    // only accepts words whose EVERY kanji is at that exact level, which
    // eliminates most real compounds (e.g. for 木/N5, only 5 of ~40 frequent
    // candidate words qualify, diluted across a 79-kanji pool).
    await page.locator('.level-filter button[data-level="all"]').click().catch(() => {});
    await page.waitForTimeout(600);
    await page.waitForSelector('.card:not(.skeleton)', { timeout: 20000 });
    await page.waitForTimeout(800);

    // Look for the target kanji among the rendered word cards' kanji breakdown,
    // reshuffling ("New Selection") until found or budget exhausted.
    let targetCard = null;
    for (attempts = 1; attempts <= MAX_SHUFFLES; attempts++) {
      const vkc = page.locator(`.vkc-card[data-char="${kanji}"]`).first();
      if (await vkc.count() > 0) {
        targetCard = vkc;
        found = true;
        break;
      }
      await page.locator('#btnRefresh').click();
      await page.waitForSelector('.card:not(.skeleton)', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(500);
    }

    if (!found) {
      console.warn(`⚠️  ${kanji}: introuvable après ${MAX_SHUFFLES} "New Selection" — capture ignorée.`);
      return { kanji, status: 'not_found', attempts: MAX_SHUFFLES };
    }

    console.log(`   ${kanji} (N${jlptNum}) trouvé après ${attempts} tentative(s)`);

    // The kanji-breakdown block for every card on screen enriches itself
    // asynchronously and rewrites its own innerHTML once ready (src/vocab.js
    // _enrichKanjiComponents), re-attaching its .vkc-save click listener each
    // time. Give the whole grid time to settle before touching anything, so
    // a click doesn't land on a node about to be replaced.
    await page.waitForTimeout(1500);

    // Re-resolve fresh right before interacting — a locator held across the
    // wait above may point at a node the enrichment step already replaced.
    targetCard = page.locator(`.vkc-card[data-char="${kanji}"]`).first();
    if (await targetCard.count() === 0) {
      console.warn(`⚠️  ${kanji}: la carte a disparu après le délai de stabilisation — capture ignorée.`);
      return { kanji, status: 'card_vanished', attempts };
    }

    // Nearest ancestor with the exact "card" class (not "card-body"/"card-cover" etc.)
    const wordCard = targetCard.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " card ")][1]');
    await wordCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await targetCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);

    // Pronounce the word containing it
    const speakBtn = wordCard.locator('.vocab-speak-btn').first();
    if (await speakBtn.isVisible().catch(() => false)) {
      await speakBtn.click();
      await page.waitForTimeout(1800);
    }

    // Save this specific kanji (not just the word) to My List — verify the
    // star actually flips to saved (★ / .saved class) before moving on;
    // retry with a freshly re-resolved locator if the click didn't register
    // (the kanji-breakdown block can still be mid-async-enrichment — see
    // _enrichKanjiComponents in src/vocab.js — which replaces its own
    // innerHTML and re-attaches listeners, orphaning a previously-held node).
    let saved = false;
    for (let saveTry = 1; saveTry <= 3; saveTry++) {
      const saveBtn = page.locator(`.vkc-card[data-char="${kanji}"] .vkc-save`).first();
      await saveBtn.click();
      await page.waitForTimeout(1400);
      saved = await saveBtn.evaluate(el => el.classList.contains('saved') || el.textContent.includes('★')).catch(() => false);
      if (saved) break;
      console.warn(`   ${kanji}: le clic de sauvegarde n'a pas pris effet (tentative ${saveTry}), nouvel essai...`);
      await page.waitForTimeout(800);
    }
    if (!saved) {
      console.warn(`⚠️  ${kanji}: sauvegarde non confirmée après 2 essais — capture ignorée.`);
      return { kanji, status: 'save_failed', attempts };
    }

    // Open My List to confirm it landed there
    await page.locator('#tabMyList').click();
    await page.waitForSelector('.saved-list, [class*="saved" i]', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2200);
  } finally {
    await page.close();
    await ctx.close();
    await browser.close();
  }

  // ── Convert recording → vertical MP4 ────────────────────────────────────
  const files = readdirSync(tmpDir).filter(f => f.endsWith('.webm'));
  if (!files.length) {
    console.warn(`⚠️  ${kanji}: aucune vidéo enregistrée par Playwright.`);
    return { kanji, status: 'no_recording' };
  }
  const rawVideo = join(tmpDir, files[0]);
  const outFile = join(OUT_DIR, `${kanji}.mp4`);

  const r = spawnSync(FFMPEG, ['-y',
    '-i', rawVideo,
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=#faf7f2,setsar=1',
    '-r', '30',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
    '-profile:v', 'baseline', '-level', '4.0', '-pix_fmt', 'yuv420p',
    '-an',
    '-movflags', '+faststart',
    outFile,
  ], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg conversion failed (${kanji}): ` + r.stderr.slice(-800));

  // ── Trim a short CTA excerpt from the tail (My List reveal) ─────────────
  const ctaFile = join(OUT_DIR, `${kanji}-cta.mp4`);
  const probe = spawnSync(FFPROBE, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', outFile,
  ], { encoding: 'utf8' });
  const totalDur = parseFloat(probe.stdout?.trim()) || 0;
  const ctaStart = Math.max(0, totalDur - CTA_DUR - 0.3); // land just before the very end

  const rCta = spawnSync(FFMPEG, ['-y',
    '-ss', String(ctaStart), '-t', String(CTA_DUR), '-i', outFile,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
    '-profile:v', 'baseline', '-level', '4.0', '-pix_fmt', 'yuv420p',
    '-an', '-movflags', '+faststart',
    ctaFile,
  ], { encoding: 'utf8' });
  if (rCta.status !== 0) console.warn(`⚠️  ${kanji}: extrait CTA non généré (${rCta.stderr.slice(-300)})`);

  console.log(`✅ ${kanji} → ${outFile} (${totalDur.toFixed(1)}s) + ${kanji}-cta.mp4`);
  return { kanji, status: 'ok', attempts, totalDur };
}

// ── Main loop ─────────────────────────────────────────────────────────────
// Each kanji gets its own fresh browser session; occasional failures (not
// found within budget, or a save click that didn't register — see notes
// above) are retried in a brand-new session up to --session-retries times
// before being reported as a final failure and moving on.
const results = [];
for (const kanji of targetKanji) {
  console.log(`▶ ${kanji}`);
  let result;
  for (let sessionTry = 1; sessionTry <= SESSION_RETRIES; sessionTry++) {
    try {
      result = await captureOne(kanji);
    } catch (e) {
      console.error(`❌ ${kanji}: ${e.message}`);
      result = { kanji, status: 'error', error: e.message };
    }
    if (result.status === 'ok' || result.status === 'not_in_index') break;
    if (sessionTry < SESSION_RETRIES) {
      console.log(`   ${kanji}: nouvelle session (tentative ${sessionTry + 1}/${SESSION_RETRIES})...`);
    }
  }
  results.push(result);
}

const ok = results.filter(r => r.status === 'ok');
const failed = results.filter(r => r.status !== 'ok');

console.log(`\n🎉 ${ok.length}/${results.length} captures réussies → ${OUT_DIR}/`);
if (failed.length) {
  console.log(`⚠️  Échecs (${failed.length}):`);
  for (const f of failed) console.log(`   - ${f.kanji}: ${f.status}${f.attempts ? ` (${f.attempts} tentatives)` : ''}`);
}
console.log('   Vidéos muettes (Playwright ne capture pas l\'audio) — utilisables comme B-roll sous narration/TTS.\n');
