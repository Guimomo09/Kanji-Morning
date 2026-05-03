#!/usr/bin/env node
/**
 * scripts/patch-fr-wiktionary.mjs
 *
 * Fetches French (and optionally DE/ES/RU) translations from Wiktionary
 * for words that still lack them in public/jmdict_trans.json.
 *
 * Unlike the first attempt, this version:
 *   - Targets ONLY the specific words currently missing FR in jmdict_trans
 *     (these are real nouns, not conjugated forms â†’ much better hit rate)
 *   - Uses exchars=50000 so long pages (e.g. è‹±å›½) aren't cut before JP section
 *   - Finds the Japanese section via id="Japonais" anchor (more reliable)
 *   - BATCH=20, DELAY=4000ms, exponential retry on 429
 *   - Resumable via _wikt_progress.json
 *
 * Run: node scripts/patch-fr-wiktionary.mjs
 * Stop (Ctrl-C): progress is saved, re-run to continue
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

const TARGET_LANG = process.argv[2] || 'fr';   // pass 'de', 'es', 'ru' as arg
const WIKT_HOSTS  = { fr: 'fr', de: 'de', es: 'es', ru: 'ru' };
const WIKT_SECTS  = { fr: 'Japonais', de: 'Japanisch', es: 'JaponÃ©s', ru: 'Ð¯Ð¿Ð¾Ð½ÑÐºÐ¸Ð¹' };

const BATCH  = 20;    // smaller batches â†’ fewer 429s
const DELAY  = 4000;  // ms between batches

// â”€â”€ HTML parser â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Finds the language section by its HTML anchor id (more reliable than text search).
function extractDef(html, langSect) {
  if (!html) return null;

  // Try id="Japonais" anchor first, then plain text fallback
  let jaIdx = html.indexOf(`id="${langSect}"`);
  if (jaIdx === -1) jaIdx = html.indexOf(langSect);
  if (jaIdx === -1) return null;

  const afterJa = html.slice(jaIdx);

  // Look for the FIRST <ol> in this section (the definition list)
  const olStart = afterJa.indexOf('<ol');
  if (olStart === -1) return null;

  // Stop at next language section heading to avoid spilling into another language
  const nextH2 = afterJa.indexOf('<h2', olStart + 1);
  const sectionHtml = nextH2 !== -1 ? afterJa.slice(olStart, nextH2) : afterJa.slice(olStart);

  const liStart = sectionHtml.indexOf('<li');
  if (liStart === -1) return null;

  let liContent = sectionHtml.slice(liStart);

  // Stop at nested <ul> (examples) or </li>
  const ulIdx  = liContent.indexOf('<ul');
  const endIdx = liContent.indexOf('</li>');
  const cutAt  = Math.min(
    ulIdx  !== -1 ? ulIdx  : Infinity,
    endIdx !== -1 ? endIdx : Infinity
  );
  if (cutAt !== Infinity) liContent = liContent.slice(0, cutAt);

  // Strip HTML tags and clean
  let text = liContent.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

  // Remove domain tags like "(Fantastique, Religion)" at the start
  text = text.replace(/^\([^)]{1,40}\)\s*/, '').trim();

  // Remove trailing period
  text = text.replace(/\.\s*$/, '').trim();

  // Sanity checks
  if (!text || text.length < 2 || text.length > 150) return null;
  if (/^[\u3000-\u9FFF]/.test(text)) return null; // reject if looks like raw Japanese

  return text;
}

// â”€â”€ Wiktionary batch fetch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchBatch(words, lang, retries = 5) {
  const host   = WIKT_HOSTS[lang] ?? 'fr';
  const sect   = WIKT_SECTS[lang] ?? 'Japonais';
  const titles = words.map(w => encodeURIComponent(w)).join('|');
  const url    = `https://${host}.wiktionary.org/w/api.php?action=query&titles=${titles}&prop=extracts&exchars=50000&format=json&formatversion=2&redirects=1`;

  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Kanji-Morning/patch-wikt (build script; contact: asanokanji.com)' },
    });

    if (res.status === 429) {
      const wait = (attempt + 1) * 8000;
      process.stdout.write(`\n  429 â€” attente ${wait / 1000}sâ€¦`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`Wiktionary API ${res.status}`);
    const data = await res.json();

    const result = {};
    for (const page of (data.query?.pages ?? [])) {
      if (page.missing) continue;
      const def = extractDef(page.extract, sect);
      if (def) result[page.title] = def;
    }
    // Apply redirects
    for (const redir of (data.query?.redirects ?? [])) {
      if (result[redir.to] && !result[redir.from]) {
        result[redir.from] = result[redir.to];
      }
    }
    return result;
  }
  throw new Error(`Max retries on 429`);
}

// â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function main() {
  const lang = TARGET_LANG;
  console.log(`\nTarget language: ${lang.toUpperCase()}\n`);

  console.log('Loading jmdict_trans.jsonâ€¦');
  const trans = JSON.parse(await readFile(TRANS_PATH, 'utf8'));

  const freqSrc  = await readFile(FREQ_PATH, 'utf8');
  const freqObj  = JSON.parse(freqSrc.slice(freqSrc.indexOf('{'), freqSrc.lastIndexOf('}') + 1));
  const freqWords = new Set(Object.keys(freqObj));

  // Target: freq words that have an entry in jmdict_trans but missing this lang
  const candidates = Object.keys(trans).filter(w => freqWords.has(w) && !trans[w][lang]);
  console.log(`Words missing ${lang.toUpperCase()}: ${candidates.length}`);

  // Resume support
  let done = new Set();
  if (existsSync(PROG_PATH)) {
    const prog = JSON.parse(await readFile(PROG_PATH, 'utf8'));
    if (prog[lang]) done = new Set(prog[lang]);
    console.log(`Resuming â€” ${done.size} already processed.`);
  }

  const todo  = candidates.filter(w => !done.has(w));
  let   found = 0;
  let   i     = 0;

  async function saveAll() {
    let prog = {};
    if (existsSync(PROG_PATH)) {
      try { prog = JSON.parse(await readFile(PROG_PATH, 'utf8')); } catch {}
    }
    prog[lang] = [...done];
    await writeFile(PROG_PATH, JSON.stringify(prog), 'utf8');
    await writeFile(TRANS_PATH, JSON.stringify(trans), 'utf8');
  }

  let interrupted = false;
  process.on('SIGINT', async () => {
    if (interrupted) return; interrupted = true;
    console.log('\nInterrupted â€” sauvegardeâ€¦');
    await saveAll();
    console.log(`SauvegardÃ©. +${found} traductions ${lang.toUpperCase()}.`);
    process.exit(0);
  });

  console.log(`Processing ${todo.length} words (batch=${BATCH}, delay=${DELAY}ms)â€¦\n`);

  while (i < todo.length && !interrupted) {
    const batch = todo.slice(i, i + BATCH);
    const pct   = Math.round(((i + done.size) / candidates.length) * 100);
    process.stdout.write(`\r[${String(i + done.size).padStart(5)}/${candidates.length}] ${pct}% â€” +${found} trouvÃ©es`);

    try {
      const hits = await fetchBatch(batch, lang);
      for (const [word, def] of Object.entries(hits)) {
        if (trans[word] && !trans[word][lang]) {
          trans[word][lang] = def;
          found++;
        }
      }
    } catch (e) {
      process.stdout.write(`\n  Erreur batch: ${e.message}\n`);
    }

    for (const w of batch) done.add(w);
    i += BATCH;

    if (i % 200 === 0) await saveAll();
    await new Promise(r => setTimeout(r, DELAY));
  }

  // Final save
  await saveAll();

  // Coverage report
  const total = [...freqWords].length;
  const has   = [...freqWords].filter(w => trans[w]?.[lang]).length;
  console.log(`\n\nTerminÃ© ! +${found} traductions ${lang.toUpperCase()}`);
  console.log(`Couverture ${lang.toUpperCase()}: ${has}/${total} (${Math.round(has / total * 100)}%)`);
}

main().catch(err => { console.error(err); process.exit(1); });

