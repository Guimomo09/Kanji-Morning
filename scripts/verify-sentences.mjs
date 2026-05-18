#!/usr/bin/env node
/**
 * verify-sentences.mjs
 *
 * Verifies public/sentences.json against three quality criteria
 * that were NOT applied during initial generation:
 *
 *  1. BLACKLIST  — sentence contains an offensive word from content-blacklist.mjs
 *  2. EXACT-WORD — the target word appears isolated (not embedded inside another word)
 *  3. LEVEL-OK   — all kanji in the sentence are at/easier than the word's JLPT level
 *                  (using kanji_index.json, strict mode; N2/N1 words are exempt)
 *
 * Usage:
 *   node scripts/verify-sentences.mjs            # report only
 *   node scripts/verify-sentences.mjs --fix      # remove BLACKLIST entries only (safe)
 *   node scripts/verify-sentences.mjs --fix --exact  # also remove exact-word fails
 *   node scripts/verify-sentences.mjs --fix --level  # also remove level-too-hard
 */

import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORD_BLACKLIST } from './content-blacklist.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SENT_PATH  = path.join(__dirname, '../public/sentences.json');
const DB_PATH    = path.join(__dirname, 'vocab-db.json');
const KANJI_PATH = path.join(__dirname, '../public/kanji_index.json');

const FIX        = process.argv.includes('--fix');
const WITH_EXACT  = process.argv.includes('--exact');
const WITH_LEVEL  = process.argv.includes('--level');

const sentences  = JSON.parse(fs.readFileSync(SENT_PATH,  'utf8'));
const db         = JSON.parse(fs.readFileSync(DB_PATH,    'utf8'));
const kanjiIndex = JSON.parse(fs.readFileSync(KANJI_PATH, 'utf8'));

// ── Build lookup maps ──────────────────────────────────────────────────────────

// word → jlptNum (5=N5 easiest, 1=N1 hardest)
const wordLevel = new Map(db.map(w => [w.word, w.jlptNum]));

// kanji char → JLPT level number (from kanji_index.json field `j`)
const charLevel = new Map(
  Object.entries(kanjiIndex).map(([k, v]) => [k, v.j])
);

// ── Blacklist regex ────────────────────────────────────────────────────────────
// Build a single regex from all blacklisted words
const escaped = [...WORD_BLACKLIST].map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const BLACKLIST_RE = new RegExp(escaped.join('|'));

// ── containsWordExact ──────────────────────────────────────────────────────────
// Returns true if `word` appears in `sentence` not immediately adjacent to
// another kanji/kana character (i.e. not part of a larger compound).
function containsWordExact(sentence, word) {
  const isKanjiKana = ch => {
    if (!ch) return false;
    const cp = ch.codePointAt(0);
    return (
      (cp >= 0x4E00 && cp <= 0x9FFF) ||   // CJK unified
      (cp >= 0x3400 && cp <= 0x4DBF) ||   // CJK extension A
      (cp >= 0x30A0 && cp <= 0x30FF)       // Katakana
    );
  };

  let idx = 0;
  while ((idx = sentence.indexOf(word, idx)) !== -1) {
    const before = idx > 0 ? sentence[idx - 1] : null;
    const after  = sentence[idx + word.length]  ?? null;
    if (!isKanjiKana(before) && !isKanjiKana(after)) return true;
    idx += word.length;
  }
  return false;
}

// ── isWordLevelOk ──────────────────────────────────────────────────────────────
// All kanji in the sentence must be at or easier than the target JLPT level.
// Unknown kanji are treated as N3 (level 3).
// N1/N2 words are not checked (too loose a restriction would be useless there).
function isWordLevelOk(sentence, jlptNum) {
  if (jlptNum <= 2) return true; // N2/N1: exempt
  for (const ch of sentence) {
    const cp = ch.codePointAt(0);
    if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF)) {
      const lvl = charLevel.get(ch) ?? 3; // unknown → treat as N3
      if (lvl < jlptNum) return false;    // harder than target level
    }
  }
  return true;
}

// ── Main verification loop ─────────────────────────────────────────────────────
const issues = { blacklist: [], exactFail: [], levelFail: [] };

for (const [word, sent] of Object.entries(sentences)) {
  const jp      = sent.jp;
  const jlptNum = wordLevel.get(word) ?? 1;

  // 1. Blacklist
  if (BLACKLIST_RE.test(jp)) {
    issues.blacklist.push({ word, jp });
    continue; // no need to check further
  }

  // 2. Exact word match (only for multi-char words containing kanji)
  if (word.length > 1 && /[\u4E00-\u9FFF]/.test(word)) {
    if (!containsWordExact(jp, word)) {
      issues.exactFail.push({ word, jp, jlptNum });
    }
  }

  // 3. Level-appropriate kanji
  if (!isWordLevelOk(jp, jlptNum)) {
    issues.levelFail.push({ word, jp, jlptNum });
  }
}

// ── Report ─────────────────────────────────────────────────────────────────────
const total = Object.keys(sentences).length;
console.log(`\n▶ Verified ${total} sentences\n`);

if (issues.blacklist.length) {
  console.log(`❌ BLACKLIST (${issues.blacklist.length})`);
  for (const x of issues.blacklist) console.log(`   ${x.word}: "${x.jp}"`);
  console.log();
}

if (issues.exactFail.length) {
  console.log(`⚠  EXACT-WORD FAIL (${issues.exactFail.length})`);
  for (const x of issues.exactFail) console.log(`   ${x.word} [N${x.jlptNum}]: "${x.jp}"`);
  console.log();
}

if (issues.levelFail.length) {
  console.log(`⚠  LEVEL-TOO-HARD (${issues.levelFail.length})`);
  for (const x of issues.levelFail) console.log(`   ${x.word} [N${x.jlptNum}]: "${x.jp}"`);
  console.log();
}

const totalIssues = issues.blacklist.length + issues.exactFail.length + issues.levelFail.length;
if (totalIssues === 0) {
  console.log('✅ All checks passed — no issues found!');
} else {
  console.log(`--- ${totalIssues} issue(s) found`);
}

// ── Fix mode ───────────────────────────────────────────────────────────────────
if (FIX) {
  const toRemove = new Set([
    ...issues.blacklist.map(x => x.word),
    ...(WITH_EXACT ? issues.exactFail.map(x => x.word) : []),
    ...(WITH_LEVEL ? issues.levelFail.map(x => x.word) : []),
  ]);

  if (toRemove.size === 0) {
    console.log('\n✅ Nothing to remove.');
  } else {
    for (const word of toRemove) delete sentences[word];
    fs.writeFileSync(SENT_PATH, JSON.stringify(sentences, null, 2));
    console.log(`\n🗑  Removed ${toRemove.size} entries. Remaining: ${Object.keys(sentences).length}`);
  }
}
