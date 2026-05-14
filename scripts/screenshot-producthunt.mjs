/**
 * screenshot-producthunt.mjs
 * Génère les 5 screenshots ProductHunt (1270×952px) depuis asanokanji.com
 *
 * Usage :
 *   node scripts/screenshot-producthunt.mjs
 *
 * Les fichiers sont sauvegardés dans ./screenshots/
 * Installe playwright automatiquement si absent.
 */

import { execSync } from 'child_process';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'screenshots');
mkdirSync(OUT_DIR, { recursive: true });

// -- Vérifier / installer playwright ------------------------------------------
try {
  await import('playwright');
} catch {
  console.log('📦 Installation de playwright...');
  execSync('npm install -D playwright', { stdio: 'inherit', cwd: join(__dirname, '..') });
  execSync('npx playwright install chromium', { stdio: 'inherit', cwd: join(__dirname, '..') });
}

const { chromium } = await import('playwright');

const BASE = 'https://asanokanji.com';
const W = 1270;
const H = 952;

// Délai utilitaire
const wait = ms => new Promise(r => setTimeout(r, ms));

async function shot(page, filename, label) {
  await page.screenshot({ path: join(OUT_DIR, filename), clip: { x: 0, y: 0, width: W, height: H } });
  console.log(`✅ ${label} → screenshots/${filename}`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,           // retina → qualité max
  locale: 'en-US',
  colorScheme: 'light',
});

const page = await context.newPage();

// --------------------------------------------------------------------------
// 1. HOME — la page d'accueil avec le kanji du jour
// --------------------------------------------------------------------------
console.log('\n🔄 1/5 — Home screen...');
await page.goto(BASE, { waitUntil: 'networkidle' });
await wait(2500);                  // laisser Firebase + rendu JS
// Fermer le tutorial si présent
const tutorialClose = page.locator('[data-action="close-tutorial"], .tutorial-close, #tutorial-skip');
if (await tutorialClose.count() > 0) await tutorialClose.first().click();
await wait(500);
await shot(page, '1-home.png', 'Home screen');

// --------------------------------------------------------------------------
// 2. KANJI — onglet Kanji (liste du jour + lancement quiz)
// --------------------------------------------------------------------------
console.log('🔄 2/5 — Kanji screen...');
await page.click('#tabKanji');
await wait(2000);
await shot(page, '2-kanji.png', 'Kanji screen');

// --------------------------------------------------------------------------
// 3. VOCAB — onglet Vocab
// --------------------------------------------------------------------------
console.log('🔄 3/5 — Vocab screen...');
await page.click('#tabVocab');
await wait(1500);
await shot(page, '3-vocab.png', 'Vocab screen');

// --------------------------------------------------------------------------
// 4. STATS — onglet Stats
// --------------------------------------------------------------------------
console.log('🔄 4/5 — Stats screen...');
await page.click('#tabStats');
await wait(1500);
await shot(page, '4-stats.png', 'Stats screen');

// --------------------------------------------------------------------------
// 5. PAGE JLPT N5 — page SEO statique
// --------------------------------------------------------------------------
console.log('🔄 5/5 — JLPT N5 page...');
await page.goto(`${BASE}/jlpt-n5.html`, { waitUntil: 'networkidle' });
await wait(1000);
await shot(page, '5-jlpt-n5.png', 'JLPT N5 page');

// --------------------------------------------------------------------------
await browser.close();
console.log(`\n🎉 5 screenshots sauvegardés dans ./screenshots/`);
console.log('   Dimensions : 1270×952 @2x — prêts pour ProductHunt\n');
