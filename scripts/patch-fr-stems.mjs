#!/usr/bin/env node
/**
 * scripts/patch-fr-stems.mjs
 *
 * Offline FR patch: for every freq.js word missing a FR translation,
 * look up its likely dictionary form (stem + る / い / な / す)
 * in jmdict_trans.json and inherit the FR if found.
 *
 * No network. Runs in <1s.
 *
 * Run: node scripts/patch-fr-stems.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname }       from 'node:path';
import { fileURLToPath }       from 'node:url';

const __dir      = dirname(fileURLToPath(import.meta.url));
const ROOT       = join(__dir, '..');
const TRANS_PATH = join(ROOT, 'public', 'jmdict_trans.json');
const FREQ_PATH  = join(ROOT, 'src', 'freq.js');

// Suffixes to try (ordered by likelihood)
const SUFFIXES = ['る', 'い', 'す', 'く', 'な', 'んな'];

async function main() {
  console.log('Loading jmdict_trans.json…');
  const trans = JSON.parse(await readFile(TRANS_PATH, 'utf8'));

  const freqSrc  = await readFile(FREQ_PATH, 'utf8');
  const freqObj  = JSON.parse(freqSrc.slice(freqSrc.indexOf('{'), freqSrc.lastIndexOf('}') + 1));
  const freqWords = Object.keys(freqObj);
  console.log(`Freq words: ${freqWords.length}`);

  // All langs to propagate (not just FR — if a stem has DE but word doesn't, inherit too)
  const LANGS = ['fr', 'de', 'es', 'ru'];

  let patched   = 0;
  let patchedFR = 0;
  const report  = [];

  for (const w of freqWords) {
    const entry = trans[w];
    if (!entry) continue;               // word not in jmdict_trans at all — skip

    // Check if any lang is missing
    const missingLangs = LANGS.filter(l => !entry[l]);
    if (missingLangs.length === 0) continue; // all langs present — skip

    // Try each suffix to find the dictionary form
    for (const suf of SUFFIXES) {
      const base = w + suf;
      const baseEntry = trans[base];
      if (!baseEntry) continue;

      let gained = false;
      for (const lang of missingLangs) {
        if (baseEntry[lang] && !entry[lang]) {
          entry[lang] = baseEntry[lang];
          patched++;
          if (lang === 'fr') patchedFR++;
          gained = true;
        }
      }
      if (gained) {
        report.push({ word: w, base, gained: missingLangs.filter(l => baseEntry[l]) });
        break; // found a base form — stop trying suffixes
      }
    }
  }

  console.log(`\nPatched: ${patched} translations (${patchedFR} FR) across ${report.length} words`);
  console.log('\nSample (first 20):');
  for (const r of report.slice(0, 20)) {
    console.log(`  ${r.word} → ${r.base}  [${r.gained.join(',')}]  FR: "${trans[r.word].fr ?? '—'}"`);
  }

  await writeFile(TRANS_PATH, JSON.stringify(trans), 'utf8');
  console.log(`\nSaved → ${TRANS_PATH}`);
}

main().catch(err => { console.error(err); process.exit(1); });
