#!/usr/bin/env node
/**
 * scripts/patch-fr-wiktionary.mjs
 *
 * Completes missing French translations in public/jmdict_trans.json
 * by querying fr.wiktionary.org (free, no API key).
 *
 * Strategy:
 *   - MediaWiki API supports 50 titles per request → very efficient
 *   - Only patch words that: have DE (confirming they're real entries) but no FR
 *   - Batch size 50, ~1 req/sec → ~100k words ≈ 35 min in background
 *   - Resumable: writes progress to _wikt_progress.json
 *
 * Run:  node scripts/patch-fr-wiktionary.mjs
 * Stop: Ctrl-C — progress is saved, re-run to continue
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync }          from 'node:fs';
import { join, dirname }       from 'node:path';
import { fileURLToPath }       from 'node:url';

const __dir      = dirname(fileURLToPath(import.meta.url));
const ROOT       = join(__dir, '..');
const TRANS_PATH = join(ROOT, 'public', 'jmdict_trans.json');
const FREQ_PATH  = join(ROOT, 'src', 'freq.js');
const PROG_PATH  = join(ROOT, '_wikt_progress.json');

const BATCH  = 50;   // MediaWiki allows 50 titles/request
const DELAY  = 2000; // ms between requests (polite, avoids 429)

// ── HTML parser ────────────────────────────────────────────────────────────
// From the fr.wiktionary extract, find the Japanese section and extract
// the first <ol><li> text (the primary definition).
function extractFrDef(html) {
  if (!html) return null;

  // Find start of Japanese section
  const jaIdx = html.indexOf('Japonais');
  if (jaIdx === -1) return null;

  // Look for the first <ol> after the Japanese section
  const afterJa = html.slice(jaIdx);
  const olStart  = afterJa.indexOf('<ol>');
  if (olStart === -1) return null;

  const olChunk  = afterJa.slice(olStart);
  const liStart  = olChunk.indexOf('<li>');
  if (liStart === -1) return null;

  // Get content of first <li>
  let liContent = olChunk.slice(liStart + 4);

  // Stop at nested <ul> (examples) or </li>
  const ulIdx  = liContent.indexOf('<ul>');
  const endIdx = liContent.indexOf('</li>');
  const cutAt  = Math.min(
    ulIdx  !== -1 ? ulIdx  : Infinity,
    endIdx !== -1 ? endIdx : Infinity
  );
  if (cutAt !== Infinity) liContent = liContent.slice(0, cutAt);

  // Strip HTML tags
  let text = liContent.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

  // Trim trailing punctuation noise
  text = text.replace(/\.\s*$/, '').trim();

  // Sanity checks
  if (!text || text.length < 2 || text.length > 120) return null;
  // Reject if it's still clearly Japanese / not French
  if (/^[\u3000-\u9FFF]/.test(text)) return null;

  return text;
}

// ── Wiktionary batch fetch ─────────────────────────────────────────────────
async function fetchBatch(words, retries = 4) {
  const titles = words.map(w => encodeURIComponent(w)).join('|');
  // exchars=12000 ensures we reach the Japanese section even on long pages
  const url = `https://fr.wiktionary.org/w/api.php?action=query&titles=${titles}&prop=extracts&exchars=12000&format=json&formatversion=2&redirects=1`;

  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Kanji-Morning/patch-fr (build script; contact: asanokanji.com)' },
    });
    if (res.status === 429) {
      const wait = (attempt + 1) * 6000;
      process.stdout.write(`\n429 rate-limit — attente ${wait / 1000}s (essai ${attempt + 1}/${retries})…`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`Wiktionary API ${res.status}`);
    const data = await res.json();

    const result = {};
    const pages  = data.query?.pages ?? [];
    for (const page of pages) {
      if (page.missing) continue;
      const def = extractFrDef(page.extract);
      if (def) result[page.title] = def;
    }
    // Handle redirects: map original title → resolved title
    for (const redir of (data.query?.redirects ?? [])) {
      if (result[redir.to] && !result[redir.from]) {
        result[redir.from] = result[redir.to];
      }
    }
    return result;
  }
  throw new Error('Max retries exceeded (429)');
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('Loading jmdict_trans.json…');
  const trans = JSON.parse(await readFile(TRANS_PATH, 'utf8'));

  // Load freq.js — restrict to common words (better Wiktionary FR coverage)
  const freqSrc  = await readFile(FREQ_PATH, 'utf8');
  const freqObj  = JSON.parse(freqSrc.slice(freqSrc.indexOf('{'), freqSrc.lastIndexOf('}') + 1));
  const freqWords = new Set(Object.keys(freqObj));
  console.log(`Freq words loaded: ${freqWords.size}`);

  // Category 1: in jmdict_trans + in freq.js + missing FR
  const inTrans   = Object.keys(trans).filter(w => freqWords.has(w) && !trans[w].fr);
  // Category 2: in freq.js but not in jmdict_trans at all → add placeholder
  const inFreqOnly = [...freqWords].filter(w => !trans[w]);
  for (const w of inFreqOnly) trans[w] = {};

  const candidates = [...inTrans, ...inFreqOnly];
  console.log(`Candidats: ${candidates.length} (${inTrans.length} dans trans + ${inFreqOnly.length} nouveaux)`);

  // Load resume state
  let done = new Set();
  if (existsSync(PROG_PATH)) {
    const prog = JSON.parse(await readFile(PROG_PATH, 'utf8'));
    done = new Set(prog.done ?? []);
    console.log(`Resuming — ${done.size} words already processed.`);
  }

  const todo   = candidates.filter(w => !done.has(w));
  const total  = todo.length;
  let   found  = 0;
  let   i      = 0;

  function saveProgress() {
    const prog = { done: [...done] };
    writeFile(PROG_PATH, JSON.stringify(prog), 'utf8').catch(() => {});
  }
  function saveTrans() {
    return writeFile(TRANS_PATH, JSON.stringify(trans), 'utf8');
  }

  // Save on Ctrl-C
  let saving = false;
  process.on('SIGINT', async () => {
    if (saving) return;
    saving = true;
    console.log('\nInterrupted — saving progress…');
    saveProgress();
    await saveTrans();
    console.log(`Saved. Found ${found} new FR translations so far.`);
    console.log('Re-run to continue.');
    process.exit(0);
  });

  console.log(`Processing ${total} words in batches of ${BATCH}…\n`);

  while (i < total) {
    const batch    = todo.slice(i, i + BATCH);
    const pct      = Math.round(((i + done.size) / candidates.length) * 100);
    process.stdout.write(`\r[${String(i + done.size).padStart(6)}/${candidates.length}] ${pct}% — +${found} FR found`);

    let batchResult = {};
    try {
      batchResult = await fetchBatch(batch);
    } catch (e) {
      console.warn('\nFetch error, skipping batch:', e.message);
    }

    for (const [word, def] of Object.entries(batchResult)) {
      if (trans[word] && !trans[word].fr) {
        trans[word].fr = def;
        found++;
      }
    }

    for (const w of batch) done.add(w);
    i += BATCH;

    // Save incrementally every 500 words
    if (i % 500 === 0) {
      saveProgress();
      await saveTrans();
    }

    // Polite delay
    await new Promise(r => setTimeout(r, DELAY));
  }

  // Clean up empty placeholder entries that got no translation at all
  for (const w of inFreqOnly) {
    const e = trans[w];
    if (e && !e.fr && !e.de && !e.es && !e.ru) delete trans[w];
  }

  console.log(`\n\nTerminé ! ${found} nouvelles traductions FR trouvées.`);
  saveProgress();
  await saveTrans();
  console.log(`Mis à jour : ${TRANS_PATH}`);
  console.log('Prochaine étape : git add public/jmdict_trans.json && git commit && git push origin dev');
}

main().catch(err => { console.error(err); process.exit(1); });
