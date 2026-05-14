/**
 * Génère kanji-cards/text-intro.png uniquement (hook d'entrée)
 * Pour le CTA, déposer manuellement kanji-cards/text-cta.png
 * Usage: node scripts/generate-hook-png.mjs
 */
import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const ROOT     = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT      = join(ROOT, 'kanji-cards', 'text-intro.png');
mkdirSync(join(ROOT, 'kanji-cards'), { recursive: true });

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@700;900&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1080px;
    height: 1920px;
    background: transparent;
    font-family: 'Noto Sans JP', 'Segoe UI', sans-serif;
    position: relative;
  }
  .hook {
    position: absolute;
    top: 120px;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
  }
  .question {
    font-size: 68px;
    font-weight: 900;
    color: #1a1a1a;
    letter-spacing: 1px;
    text-align: center;
    line-height: 1.2;
  }
  .arrow {
    font-size: 64px;
    color: #c0392b;
    line-height: 1;
  }
</style>
</head>
<body>
  <div class="hook">
    <div class="question">Can you read this?</div>
    <div class="arrow">↓</div>
  </div>
</body>
</html>`;

const browser = await chromium.launch({ headless: true });
const ctx     = await browser.newContext();
const page    = await ctx.newPage();
await page.setViewportSize({ width: 1080, height: 1920 });

// Intro PNG uniquement
await page.setContent(html, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.screenshot({ path: OUT, omitBackground: true });
console.log(`✅ ${OUT}`);

await browser.close();
