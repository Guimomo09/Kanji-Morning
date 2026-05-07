/**
 * generate-seo-pages.mjs
 * Generates static indexable HTML pages for JLPT N5-N1 kanji lists.
 * Output: public/jlpt-n5.html ... public/jlpt-n1.html
 * Run: node scripts/generate-seo-pages.mjs
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dir, '..', 'public');

const LEVELS = [5, 4, 3, 2, 1];
const BASE_URL = 'https://kanjiapi.dev/v1';

const LEVEL_META = {
  5: { label: 'N5', name: 'Beginner', count: '~80',  color: '#4caf93', desc: 'The most essential Japanese kanji for absolute beginners. Master these 80 kanji and you have a solid foundation for daily life in Japan.' },
  4: { label: 'N4', name: 'Elementary', count: '~170', color: '#81c784', desc: 'Elementary-level kanji building on N5. These ~170 kanji cover everyday situations — school, work, travel.' },
  3: { label: 'N3', name: 'Intermediate', count: '~370', color: '#64b5f6', desc: 'Intermediate kanji required for the JLPT N3 exam. Understanding newspapers, books and casual conversation.' },
  2: { label: 'N2', name: 'Upper Intermediate', count: '~380', color: '#9575cd', desc: 'Upper-intermediate kanji for reading authentic Japanese texts, news and literature.' },
  1: { label: 'N1', name: 'Advanced', count: '~600+', color: '#e57373', desc: 'Advanced kanji mastery. JLPT N1 is the highest Japanese proficiency certificate — covering nuanced, literary and specialized vocabulary.' },
};

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.json();
}

async function fetchKanjiList(level) {
  return fetchJSON(`${BASE_URL}/kanji/jlpt-${level}`);
}

async function fetchKanjiDetail(char) {
  try {
    return await fetchJSON(`${BASE_URL}/kanji/${encodeURIComponent(char)}`);
  } catch {
    return null;
  }
}

// Batch with rate limiting — kanjiapi allows ~10 req/s
async function batchFetch(chars, batchSize = 10, delayMs = 120) {
  const results = [];
  for (let i = 0; i < chars.length; i += batchSize) {
    const batch = chars.slice(i, i + batchSize);
    const res   = await Promise.all(batch.map(c => fetchKanjiDetail(c)));
    results.push(...res);
    if (i + batchSize < chars.length) await new Promise(r => setTimeout(r, delayMs));
    process.stdout.write(`\r  fetching details: ${Math.min(i + batchSize, chars.length)}/${chars.length}`);
  }
  console.log();
  return results;
}

function buildPage(level, kanji, details) {
  const m = LEVEL_META[level];
  const rows = kanji.map((char, idx) => {
    const d = details[idx];
    if (!d) return '';
    const meanings = (d.meanings || []).slice(0, 3).join(', ');
    const on  = (d.on_readings  || []).slice(0, 3).join('、');
    const kun = (d.kun_readings || []).slice(0, 3).join('、');
    return `
      <div class="kanji-item">
        <a href="https://asanokanji.com/?k=${encodeURIComponent(char)}" class="kanji-char" title="${char} — ${meanings}">${char}</a>
        <div class="kanji-info">
          <div class="kanji-meanings">${meanings || '—'}</div>
          <div class="kanji-readings">${on ? `<span class="on">${on}</span>` : ''}${kun ? `<span class="kun">${kun}</span>` : ''}</div>
        </div>
      </div>`;
  }).join('');

  const otherLevels = LEVELS.filter(l => l !== level)
    .map(l => `<a href="/jlpt-n${l}.html">JLPT N${l} (${LEVEL_META[l].name})</a>`)
    .join(' · ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>JLPT ${m.label} Kanji List — ${kanji.length} Kanji with Meanings & Readings | 朝の漢字</title>
  <meta name="description" content="Complete JLPT ${m.label} kanji list — all ${kanji.length} kanji with English meanings, on/kun readings. Study daily with 朝の漢字 (Asa no Kanji), the free spaced-repetition kanji app."/>
  <meta name="keywords" content="JLPT ${m.label}, JLPT ${m.label} kanji list, Japanese ${m.name.toLowerCase()} kanji, learn Japanese kanji, kanji meanings readings, 朝の漢字"/>
  <link rel="canonical" href="https://asanokanji.com/jlpt-n${level}.html"/>
  <meta property="og:title" content="JLPT ${m.label} Kanji List — ${kanji.length} Kanji | 朝の漢字"/>
  <meta property="og:description" content="${m.desc}"/>
  <meta property="og:url" content="https://asanokanji.com/jlpt-n${level}.html"/>
  <meta property="og:type" content="website"/>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f5f0; color: #1a1a1a; line-height: 1.6; }
    header { background: #b91c1c; color: #fff; padding: 20px 24px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
    header a { color: #fff; text-decoration: none; font-weight: 700; font-size: 20px; }
    .cta-btn { background: #fff; color: #b91c1c; border-radius: 8px; padding: 8px 18px; font-weight: 700; font-size: 14px; text-decoration: none; white-space: nowrap; }
    .hero { max-width: 860px; margin: 40px auto 32px; padding: 0 20px; }
    .badge { display: inline-block; background: ${m.color}22; color: ${m.color}; border: 1.5px solid ${m.color}66; border-radius: 20px; font-size: 13px; font-weight: 800; padding: 3px 14px; margin-bottom: 14px; letter-spacing: 1px; }
    h1 { font-size: clamp(26px, 5vw, 38px); font-weight: 900; margin-bottom: 12px; }
    .hero-sub { font-size: 16px; color: #555; margin-bottom: 24px; }
    .app-promo { background: #fff; border: 1.5px solid #e8e0d5; border-radius: 12px; padding: 18px 22px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 40px; }
    .app-promo p { flex: 1; font-size: 14px; color: #555; min-width: 200px; }
    .app-promo a { background: #b91c1c; color: #fff; border-radius: 8px; padding: 10px 20px; font-weight: 700; font-size: 14px; text-decoration: none; white-space: nowrap; }
    .kanji-grid { max-width: 860px; margin: 0 auto 48px; padding: 0 20px; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
    .kanji-item { background: #fff; border: 1px solid #e8e0d5; border-radius: 10px; padding: 14px 16px; display: flex; align-items: flex-start; gap: 14px; transition: box-shadow .15s; }
    .kanji-item:hover { box-shadow: 0 4px 16px rgba(0,0,0,.08); }
    .kanji-char { font-size: 40px; font-weight: 900; color: #111; text-decoration: none; line-height: 1; flex-shrink: 0; width: 44px; text-align: center; }
    .kanji-char:hover { color: #b91c1c; }
    .kanji-info { flex: 1; min-width: 0; }
    .kanji-meanings { font-size: 13px; font-weight: 700; color: #1a1a1a; margin-bottom: 4px; }
    .kanji-readings { font-size: 11px; display: flex; gap: 6px; flex-wrap: wrap; }
    .on  { background: #fdecea; color: #b91c1c; border-radius: 4px; padding: 1px 6px; font-weight: 600; }
    .kun { background: #e8f5e9; color: #2e7d32; border-radius: 4px; padding: 1px 6px; font-weight: 600; }
    .nav-levels { max-width: 860px; margin: 0 auto 48px; padding: 0 20px; font-size: 14px; color: #888; }
    .nav-levels a { color: #b91c1c; text-decoration: none; font-weight: 600; }
    .nav-levels a:hover { text-decoration: underline; }
    footer { text-align: center; padding: 32px 20px; font-size: 13px; color: #aaa; border-top: 1px solid #e8e0d5; }
    footer a { color: #b91c1c; text-decoration: none; }
  </style>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"WebPage","name":"JLPT ${m.label} Kanji List","description":"${m.desc}","url":"https://asanokanji.com/jlpt-n${level}.html","isPartOf":{"@type":"WebSite","name":"朝の漢字 · Asa no Kanji","url":"https://asanokanji.com"}}
  </script>
</head>
<body>
  <header>
    <a href="https://asanokanji.com">朝の漢字 · Asa no Kanji</a>
    <a href="https://asanokanji.com" class="cta-btn">Study for free →</a>
  </header>

  <div class="hero">
    <div class="badge">JLPT ${m.label} · ${m.name}</div>
    <h1>JLPT ${m.label} Kanji List — All ${kanji.length} Kanji</h1>
    <p class="hero-sub">${m.desc}</p>
    <div class="app-promo">
      <p><strong>朝の漢字</strong> is a free daily kanji app — 10 new kanji every morning, quiz, spaced repetition and personal word list. No subscription.</p>
      <a href="https://asanokanji.com">Start studying for free →</a>
    </div>
  </div>

  <div class="kanji-grid">
    ${rows}
  </div>

  <div class="nav-levels">
    Other levels: ${otherLevels}
  </div>

  <footer>
    <p>Data source: <a href="https://kanjiapi.dev" rel="noopener">kanjiapi.dev</a> · JLPT kanji lists · <a href="https://asanokanji.com">朝の漢字</a> · <a href="/privacy.html">Privacy</a></p>
  </footer>
</body>
</html>`;
}

async function main() {
  for (const level of LEVELS) {
    const m = LEVEL_META[level];
    console.log(`\n▶ JLPT N${level} (${m.name})`);

    console.log('  fetching kanji list...');
    const kanji = await fetchKanjiList(level);
    console.log(`  ${kanji.length} kanji found`);

    console.log('  fetching kanji details...');
    const details = await batchFetch(kanji);

    const html = buildPage(level, kanji, details);
    const outPath = join(PUBLIC, `jlpt-n${level}.html`);
    writeFileSync(outPath, html, 'utf8');
    console.log(`  ✓ written → public/jlpt-n${level}.html`);
  }
  console.log('\n✅ Done! All 5 pages generated.');
}

main().catch(err => { console.error(err); process.exit(1); });
