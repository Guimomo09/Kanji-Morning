#!/usr/bin/env node
/**
 * add-furigana.mjs
 *
 * Adds a `ruby` field (HTML <ruby> tags) to every entry in public/sentences.json.
 * Uses kuromoji for morphological analysis.
 *
 * Output format per entry:
 *   { jp: "時間がありません。", en: "...", ruby: "<ruby>時間<rt>じかん</rt></ruby>がありません。" }
 *
 * Usage: node scripts/add-furigana.mjs [--force]
 *   --force  : recompute furigana even for entries that already have it
 */

import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require   = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SENT_PATH = path.join(__dirname, '../public/sentences.json');
const DIC_PATH  = path.join(__dirname, '../node_modules/kuromoji/dict');

const FORCE = process.argv.includes('--force');

// ── Katakana → Hiragana ───────────────────────────────────────────────────────
function kataToHira(str) {
  return str.replace(/[\u30A1-\u30F6]/g, c =>
    String.fromCharCode(c.charCodeAt(0) - 0x60)
  );
}

// ── Does a string contain kanji? ─────────────────────────────────────────────
function hasKanji(str) {
  return /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(str);
}

// ── Build HTML ruby string from kuromoji tokens ───────────────────────────────
function buildRuby(tokens) {
  return tokens.map(tok => {
    const surface = tok.surface_form;
    const reading = tok.reading;

    // Only add furigana when the token contains kanji AND has a known reading
    if (reading && reading !== '*' && hasKanji(surface)) {
      const hira = kataToHira(reading);
      // Skip if surface is already the same as reading (e.g. pure kana token)
      if (surface !== hira) {
        return `<ruby>${surface}<rt>${hira}</rt></ruby>`;
      }
    }
    return surface;
  }).join('');
}

// ── Init kuromoji ─────────────────────────────────────────────────────────────
console.log('▶ Loading kuromoji dictionary…');
const kuromoji = require('kuromoji');
const tokenizer = await new Promise((resolve, reject) => {
  kuromoji.builder({ dicPath: DIC_PATH }).build((err, t) => {
    if (err) reject(err);
    else     resolve(t);
  });
});
console.log('  kuromoji ready.');

// ── Process sentences ─────────────────────────────────────────────────────────
const sentences = JSON.parse(fs.readFileSync(SENT_PATH, 'utf8'));
const total     = Object.keys(sentences).length;
console.log(`▶ Processing ${total} sentences…`);

let updated = 0, skipped = 0, noChange = 0;

for (const [word, sent] of Object.entries(sentences)) {
  if (!FORCE && sent.ruby) { skipped++; continue; }

  try {
    const tokens = tokenizer.tokenize(sent.jp);
    const ruby   = buildRuby(tokens);

    if (ruby !== sent.jp) {
      sentences[word] = { ...sent, ruby };
      updated++;
    } else {
      // No kanji in sentence — store plain text as ruby too for consistency
      if (!sent.ruby) {
        sentences[word] = { ...sent, ruby: sent.jp };
        updated++;
      } else {
        noChange++;
      }
    }
  } catch (e) {
    console.warn(`  ⚠ ${word}: ${e.message}`);
  }
}

fs.writeFileSync(SENT_PATH, JSON.stringify(sentences, null, 2));

console.log(`\n▶ Done.`);
console.log(`  Updated : ${updated}`);
console.log(`  Skipped : ${skipped} (already had furigana)`);
console.log(`  No-change: ${noChange}`);
