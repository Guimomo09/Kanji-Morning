/**
 * repair-example-override.mjs
 * Fixes the corruption caused by fill-n1-gaps.mjs:
 *   - EXAMPLE_OVERRIDE had {jp,en} sentence objects mistakenly inserted
 *   - This script removes them from EXAMPLE_OVERRIDE
 *   - And properly appends them as 2nd sentences to SENTENCE_OVERRIDE
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const KANJI_PATH = join(ROOT, 'src', 'kanji.js');

let src = readFileSync(KANJI_PATH, 'utf8');
const lines = src.split('\n');

// Find where SENTENCE_OVERRIDE starts (line index, 0-based)
const soLineIdx = lines.findIndex(l => l.includes('export const SENTENCE_OVERRIDE = {'));
if (soLineIdx === -1) { console.error('SENTENCE_OVERRIDE not found'); process.exit(1); }

console.log(`SENTENCE_OVERRIDE starts at line ${soLineIdx + 1}`);

// ── Step 1: Find all {jp,en} lines within EXAMPLE_OVERRIDE block ──────────────
// These are lines before soLineIdx that match the sentence object pattern
const jpPattern = /^\s+\{ jp: '(.*?)',\s*en: '(.*?)' \},\s*$/;
const keyPattern = /^\s+'(.)':\s*\[/;  // single kanji key

const toFix = []; // { lineIdx, kanji, jp, en }

// Walk backwards from soLineIdx-1 to find all {jp,en} lines in EXAMPLE_OVERRIDE
let currentKey = null;
for (let i = 0; i < soLineIdx; i++) {
  const line = lines[i];
  const km = line.match(keyPattern);
  if (km) currentKey = km[1];

  const jpm = line.match(jpPattern);
  if (jpm && currentKey) {
    toFix.push({ lineIdx: i, kanji: currentKey, jp: jpm[1], en: jpm[2] });
  }
}

console.log(`Found ${toFix.length} corrupted {jp,en} entries in EXAMPLE_OVERRIDE`);

if (toFix.length === 0) {
  console.log('Nothing to fix.');
  process.exit(0);
}

// ── Step 2: Remove those lines from src (process in reverse order) ────────────
// Also remove the blank line immediately before if present (artifact of insertion)
const linesToRemove = new Set();
for (const { lineIdx } of toFix) {
  linesToRemove.add(lineIdx);
  // Check if the line before is blank (was inserted as padding)
  if (lineIdx > 0 && lines[lineIdx - 1].trim() === '') {
    linesToRemove.add(lineIdx - 1);
  }
}

const cleanedLines = lines.filter((_, i) => !linesToRemove.has(i));
let cleanedSrc = cleanedLines.join('\n');

console.log(`Removed ${linesToRemove.size} lines from EXAMPLE_OVERRIDE`);

// ── Step 3: Add each extracted sentence to its SENTENCE_OVERRIDE entry ────────
// Group by kanji, keep only the first occurrence per kanji (some may appear twice
// if EXAMPLE_OVERRIDE had multiple vocab entries for same kanji - shouldn't happen
// but be safe)
const sentencesByKanji = {};
for (const { kanji, jp, en } of toFix) {
  if (!sentencesByKanji[kanji]) sentencesByKanji[kanji] = { jp, en };
}

// For each kanji, find its SENTENCE_OVERRIDE entry and append the sentence
let fixedCount = 0;
let addedNewCount = 0;

for (const [kanji, { jp, en }] of Object.entries(sentencesByKanji)) {
  const esc = kanji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const jpEsc = jp.replace(/'/g, "\\'");
  const enEsc = en.replace(/'/g, "\\'");
  const newLine = `    { jp: '${jpEsc}', en: '${enEsc}' },`;

  // Find SENTENCE_OVERRIDE entry for this kanji: look for '${kanji}': [ AFTER 'export const SENTENCE_OVERRIDE'
  const soMarkerIdx = cleanedSrc.indexOf('export const SENTENCE_OVERRIDE = {');
  const exampleEnd = soMarkerIdx; // everything before this is EXAMPLE_OVERRIDE

  // Search for the key in SENTENCE_OVERRIDE section only
  const soSection = cleanedSrc.slice(soMarkerIdx);
  const entryRe = new RegExp(`'${esc}'\\s*:\\s*\\[`);
  const m = soSection.match(entryRe);

  if (m) {
    // Find the entry's closing ] in soSection
    const entryStart = soSection.indexOf(m[0]);
    let depth = 0, j = entryStart + m[0].length - 1;
    while (j < soSection.length) {
      if (soSection[j] === '[') depth++;
      else if (soSection[j] === ']') { depth--; if (depth === 0) break; }
      j++;
    }
    // j points to closing ] in soSection; convert to position in cleanedSrc
    const absJ = soMarkerIdx + j;
    cleanedSrc = cleanedSrc.slice(0, absJ) + '\n' + newLine + '\n  ' + cleanedSrc.slice(absJ);
    fixedCount++;
  } else {
    // No existing entry — this kanji has 0 sentences in SENTENCE_OVERRIDE
    // Find the closing brace of SENTENCE_OVERRIDE and insert before it
    const soEnd = cleanedSrc.lastIndexOf('// ── N1 gap fill');
    if (soEnd !== -1) {
      const insertion = `  '${kanji}': [\n${newLine}\n  ],\n`;
      cleanedSrc = cleanedSrc.slice(0, soEnd) + insertion + cleanedSrc.slice(soEnd);
    } else {
      // Fallback: insert just before the closing }; of SENTENCE_OVERRIDE
      // Find the last }; which closes SENTENCE_OVERRIDE
      const lastBrace = cleanedSrc.lastIndexOf('\n};');
      const insertion = `  '${kanji}': [\n${newLine}\n  ],\n`;
      cleanedSrc = cleanedSrc.slice(0, lastBrace) + '\n' + insertion + cleanedSrc.slice(lastBrace);
    }
    addedNewCount++;
    console.log(`  [NEW] Added ${kanji} to SENTENCE_OVERRIDE`);
  }
}

writeFileSync(KANJI_PATH, cleanedSrc, 'utf8');

console.log(`\n✅ Done:`);
console.log(`   ${fixedCount} entries moved from EXAMPLE_OVERRIDE → SENTENCE_OVERRIDE (appended 2nd sentence)`);
console.log(`   ${addedNewCount} new entries added to SENTENCE_OVERRIDE`);
console.log(`   src/kanji.js updated`);
