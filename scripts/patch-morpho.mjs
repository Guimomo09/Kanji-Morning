#!/usr/bin/env node
/**
 * scripts/patch-morpho.mjs
 *
 * Offline morphological unification — all langs (FR, DE, ES, RU).
 *
 * For every freq.js word missing a translation, generates candidate
 * dictionary-form lookups via Japanese conjugation rules and inherits
 * the translation from the base form found in jmdict_trans.json.
 *
 * Conjugation families covered:
 *   Godan:  e-row (potential / imperative)   け→く  え→う  せ→す …
 *           i-row (masu-stem / renyōkei)      き→く  い→う  し→す …
 *           a-row (negative stem)             か→く  わ→う  さ→す …
 *           o-row (volitional)                こ→く  お→う  そ→す …
 *           te-form                           って→う  いて→く  んで→む …
 *   Ichidan: stem + る  (also appending)
 *   i-adj:  adverb/te-form  く→い
 *           negative        くない→い  (strip 2)
 *   Compounds: し → する  (する compound verbs)
 *   Irregulars: 来い→来る  くれ→くれる  言って→言う  etc.
 *
 * Run: node scripts/patch-morpho.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname }       from 'node:path';
import { fileURLToPath }       from 'node:url';

const __dir      = dirname(fileURLToPath(import.meta.url));
const ROOT       = join(__dir, '..');
const TRANS_PATH = join(ROOT, 'public', 'jmdict_trans.json');
const FREQ_PATH  = join(ROOT, 'src', 'freq.js');
const LANGS      = ['fr', 'de', 'es', 'ru'];

// ── Godan conjugation maps ────────────────────────────────────────────────
const E_ROW = { け:'く', え:'う', せ:'す', て:'つ', ね:'ぬ', め:'む', べ:'ぶ', げ:'ぐ', れ:'る' };
const I_ROW = { き:'く', い:'う', し:'す', ち:'つ', に:'ぬ', み:'む', び:'ぶ', ぎ:'ぐ', り:'る' };
const A_ROW = { か:'く', わ:'う', さ:'す', た:'つ', な:'ぬ', ま:'む', ば:'ぶ', が:'ぐ', ら:'る' };
const O_ROW = { こ:'く', お:'う', そ:'す', と:'つ', の:'ぬ', も:'む', ぼ:'ぶ', ご:'ぐ', ろ:'る' };

// ── Generate dictionary-form candidates for a word ────────────────────────
function* candidates(word) {
  const stem = word.slice(0, -1);
  const last = word.slice(-1);
  const last2 = word.slice(-2);

  // --- Te-form patterns (check first — 2-char suffixes take priority) ---
  if (word.endsWith('って'))  { yield word.slice(0,-2) + 'う';  yield word.slice(0,-2) + 'つ'; }
  if (word.endsWith('いて'))  { yield word.slice(0,-2) + 'く'; }
  if (word.endsWith('いで'))  { yield word.slice(0,-2) + 'ぐ'; }
  if (word.endsWith('んで'))  { yield word.slice(0,-2) + 'む'; yield word.slice(0,-2) + 'ぬ'; yield word.slice(0,-2) + 'ぶ'; }
  if (word.endsWith('して'))  { yield word.slice(0,-2) + 'す'; yield word.slice(0,-2) + 'する'; }
  if (word.endsWith('じて'))  { yield word.slice(0,-2) + 'じる'; yield word.slice(0,-2) + 'ずる'; }
  if (word.endsWith('ちて'))  { yield word.slice(0,-2) + 'つ'; }

  // --- Ta-form (past) ---
  if (word.endsWith('った'))  { yield word.slice(0,-2) + 'う';  yield word.slice(0,-2) + 'つ'; }
  if (word.endsWith('いた'))  { yield word.slice(0,-2) + 'く'; }
  if (word.endsWith('いだ'))  { yield word.slice(0,-2) + 'ぐ'; }
  if (word.endsWith('んだ'))  { yield word.slice(0,-2) + 'む'; yield word.slice(0,-2) + 'ぬ'; yield word.slice(0,-2) + 'ぶ'; }
  if (word.endsWith('した'))  { yield word.slice(0,-2) + 'す'; yield word.slice(0,-2) + 'する'; }

  // --- i-adj: adverb/te-form (く→い) ---
  if (last === 'く') yield stem + 'い';

  // --- i-adj: negative base (くな → remove last 2 chars + い) ---
  if (word.endsWith('くな')) yield word.slice(0,-2) + 'い';

  // --- Godan e-row (potential / imperative) ---
  if (E_ROW[last]) yield stem + E_ROW[last];

  // --- Godan i-row (masu-stem) ---
  if (I_ROW[last]) yield stem + I_ROW[last];

  // --- Godan a-row (negative base: 〜ない) ---
  if (A_ROW[last]) yield stem + A_ROW[last];

  // --- Godan o-row (volitional 〜う/〜よう) ---
  if (O_ROW[last]) yield stem + O_ROW[last];

  // --- Ichidan: append る (not yet done by patch-fr-stems → redo safely) ---
  yield word + 'る';

  // --- し → する compound verbs (感謝し→感謝する, 説明し→説明する) ---
  if (last === 'し') yield stem + 'する';

  // --- Append simple suffixes (i-adj base not covered above) ---
  yield word + 'い';
  yield word + 'な';

  // --- Irregular forms ---
  const IRREG = {
    '来い':'来る', 'こい':'来る', 'くれ':'くれる', '受け':'受ける',
    '見せ':'見せる', '見え':'見える', '聞こえ':'聞こえる',
    '気付か':'気付く', '気付き':'気付く', '落ち着け':'落ち着く',
    '落ち着き':'落ち着く', '乗り越え':'乗り越える',
  };
  if (IRREG[word]) yield IRREG[word];
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('Loading jmdict_trans.json…');
  const trans = JSON.parse(await readFile(TRANS_PATH, 'utf8'));

  const freqSrc  = await readFile(FREQ_PATH, 'utf8');
  const freqObj  = JSON.parse(freqSrc.slice(freqSrc.indexOf('{'), freqSrc.lastIndexOf('}') + 1));
  const freqWords = Object.keys(freqObj);

  const LANGS = ['fr', 'de', 'es', 'ru'];
  let totalPatched = 0;
  const byLang = { fr: 0, de: 0, es: 0, ru: 0 };
  const covered = [];

  for (const word of freqWords) {
    const entry = trans[word];
    if (!entry) continue;

    const missingLangs = LANGS.filter(l => !entry[l]);
    if (missingLangs.length === 0) continue;

    for (const base of candidates(word)) {
      const baseEntry = trans[base];
      if (!baseEntry) continue;

      let gained = false;
      for (const lang of missingLangs) {
        if (baseEntry[lang] && !entry[lang]) {
          entry[lang] = baseEntry[lang];
          totalPatched++;
          byLang[lang]++;
          gained = true;
        }
      }
      // Re-evaluate which langs are still missing after this base
      const stillMissing = missingLangs.filter(l => !entry[l]);
      if (stillMissing.length === 0) {
        covered.push(word);
        break;
      }
    }
  }

  console.log(`\nPatched: ${totalPatched} translations`);
  for (const [l, n] of Object.entries(byLang)) {
    if (n) console.log(`  ${l.toUpperCase()}: +${n}`);
  }
  console.log(`Words fully resolved: ${covered.length}`);

  // Coverage report
  for (const lang of LANGS) {
    const has = freqWords.filter(w => trans[w]?.[ lang]).length;
    console.log(`  ${lang.toUpperCase()} coverage: ${has}/${freqWords.length} (${Math.round(has/freqWords.length*100)}%)`);
  }

  // Show remaining missing FR words
  const stillMissingFR = freqWords.filter(w => trans[w] && !trans[w].fr);
  console.log(`\nRemaining without FR: ${stillMissingFR.length}`);
  console.log('Sample:', stillMissingFR.slice(0, 30).join(', '));

  await writeFile(TRANS_PATH, JSON.stringify(trans), 'utf8');
  console.log(`\nSaved → ${TRANS_PATH}`);
}

main().catch(err => { console.error(err); process.exit(1); });
