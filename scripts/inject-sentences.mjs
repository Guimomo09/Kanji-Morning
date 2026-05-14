/**
 * inject-sentences.mjs
 * Reads scripts/generated-sentences.json and appends entries to
 * the SENTENCE_OVERRIDE object in src/kanji.js.
 *
 * Usage:  node scripts/inject-sentences.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const inputPath  = join(ROOT, 'scripts', 'generated-sentences.json');
const kanjiPath  = join(ROOT, 'src', 'kanji.js');

const generated = JSON.parse(readFileSync(inputPath, 'utf8'));
let   src       = readFileSync(kanjiPath, 'utf8');

// Find the closing brace of SENTENCE_OVERRIDE
const marker = 'SENTENCE_OVERRIDE = {';
const start  = src.indexOf(marker);
if (start === -1) { console.error('SENTENCE_OVERRIDE not found'); process.exit(1); }

let depth = 0, i = start + marker.length - 1;
while (i < src.length) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { depth--; if (depth === 0) break; }
  i++;
}
// i now points to the closing `}` of SENTENCE_OVERRIDE

// Load existing to avoid duplicates
function loadObj(varName, text) {
  const mk = `${varName} = {`;
  const s  = text.indexOf(mk);
  if (s === -1) return {};
  let d2 = 0, j = s + mk.length - 1;
  while (j < text.length) {
    if (text[j] === '{') d2++;
    else if (text[j] === '}') { d2--; if (d2 === 0) break; }
    j++;
  }
  try {
    return new Function(`"use strict"; return (${text.slice(s + mk.length - 1, j + 1)})`)();
  } catch { return {}; }
}
const existing = loadObj('SENTENCE_OVERRIDE', src);

// Build injection string
const entries = Object.entries(generated).filter(([k]) => !existing[k]);
if (entries.length === 0) {
  console.log('Nothing to inject — all entries already present.');
  process.exit(0);
}

// Group by category comment (we'll just append at the end)
let injection = '\n  // ── Auto-generated from Tatoeba ──\n';
for (const [kanji, sentences] of entries) {
  injection += `  '${kanji}': [\n`;
  for (const { jp, en } of sentences) {
    const safeEn = en.replace(/'/g, "\\'");
    injection += `    { jp: '${jp}', en: '${safeEn}' },\n`;
  }
  injection += `  ],\n`;
}

// Insert before the closing }
const newSrc = src.slice(0, i) + injection + src.slice(i);
writeFileSync(kanjiPath, newSrc, 'utf8');

console.log(`✅ Injected ${entries.length} entries into src/kanji.js`);
console.log(`   (${Object.keys(generated).length - entries.length} were already present, skipped)`);
