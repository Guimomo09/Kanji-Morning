#!/usr/bin/env node
/**
 * scripts/build-jmdict.mjs
 *
 * Downloads jmdict-all from scriptin/jmdict-simplified (latest release),
 * extracts FR/ES/DE/RU glosses for each written form, and writes
 * public/jmdict_trans.json.
 *
 * Run once:  node scripts/build-jmdict.mjs
 *
 * JMdict ISO 639-2 lang codes used here:
 *   FR → fre  |  DE → ger  |  ES → spa  |  RU → rus
 */

import { createWriteStream, createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, rm, readdir, rename } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dir  = dirname(fileURLToPath(import.meta.url));
const ROOT   = join(__dir, '..');
const TMP    = join(ROOT,  '_jmdict_tmp');
const OUT    = join(ROOT,  'public', 'jmdict_trans.json');

const LANG_MAP = { en: 'eng', fr: 'fre', es: 'spa', de: 'ger', ru: 'rus' };

// ── 1. Fetch latest release asset URL ────────────────────────────────────────

async function getDownloadUrl() {
  console.log('Fetching latest jmdict-simplified release info…');
  const res = await fetch(
    'https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest',
    { headers: { 'User-Agent': 'build-jmdict.mjs' } }
  );
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const data = await res.json();

  // We want jmdict-all-*.json.gz (single gzipped JSON, not the zip of multiple files)
  const asset = data.assets.find(a => /^jmdict-all-.*\.json\.gz$/.test(a.name));
  if (!asset) {
    // Fallback: sometimes released as .json.zip — try that
    const zip = data.assets.find(a => /^jmdict-all.*\.json\.zip$/.test(a.name));
    if (zip) return { url: zip.browser_download_url, name: zip.name, type: 'zip' };
    throw new Error(
      `No jmdict-all asset found in release ${data.tag_name}.\n` +
      `Assets: ${data.assets.map(a => a.name).join(', ')}`
    );
  }
  return { url: asset.browser_download_url, name: asset.name, type: 'gz' };
}

// ── 2. Download file ──────────────────────────────────────────────────────────

async function download(url, destPath) {
  console.log(`Downloading ${url} …`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed ${res.status}`);
  await mkdir(dirname(destPath), { recursive: true });
  const dest = createWriteStream(destPath);
  await pipeline(res.body, dest);
  console.log(`Saved to ${destPath}`);
}

// ── 3. Decompress .gz → raw JSON ─────────────────────────────────────────────

async function decompressGz(gzPath, jsonPath) {
  console.log('Decompressing…');
  const src  = createReadStream(gzPath);
  const gunz = createGunzip();
  const dest = createWriteStream(jsonPath);
  await pipeline(src, gunz, dest);
}

// ── 4. Handle .json.zip (no external deps) ───────────────────────────────────

async function extractZip(zipPath, jsonPath) {
  const destDir = dirname(jsonPath);
  console.log('Extracting zip…');
  if (process.platform === 'win32') {
    execSync(
      `powershell.exe -NoProfile -Command "Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${destDir}'"`,
      { stdio: 'inherit' }
    );
  } else {
    execSync(`unzip -o "${zipPath}" "*.json" -d "${destDir}"`, { stdio: 'inherit' });
  }

  // Find the extracted JSON file and rename/move to expected path
  const files = await readdir(destDir);
  const found = files.find(f => f.endsWith('.json') && f !== 'jmdict-all.json');
  if (!found) throw new Error('No .json file found after zip extraction');
  await rename(join(destDir, found), jsonPath);
}

// ── 5. Parse JMdict and build translation map ─────────────────────────────────

function buildTransMap(jmdict) {
  const trans = {};
  const langCodes = Object.values(LANG_MAP); // ['fre','spa','ger','rus']

  let processed = 0;
  let kept = 0;

  for (const entry of jmdict.words) {
    processed++;

    // Collect translations: { fre: [...glosses], spa: [...], ger: [...], rus: [...] }
    const collected = {};
    for (const sense of entry.sense) {
      for (const gloss of sense.gloss) {
        if (!langCodes.includes(gloss.lang)) continue;
        if (!collected[gloss.lang]) collected[gloss.lang] = [];
        collected[gloss.lang].push(gloss.text);
      }
    }

    // Skip if no translation at all (empty entry)
    const hasAny = langCodes.some(lc => collected[lc]?.length > 0);
    if (!hasAny) continue;

    // Build output row { fr: "...", es: "...", de: "...", ru: "..." }
    const row = {};
    for (const [shortCode, jmCode] of Object.entries(LANG_MAP)) {
      if (collected[jmCode]?.length) {
        // Take first 3 glosses, deduplicate, join
        const unique = [...new Set(collected[jmCode])].slice(0, 3);
        row[shortCode] = unique.join(', ');
      }
    }

    // Map every kanji/written form to this row
    const writtenForms = entry.kanji.map(k => k.text);
    // Also include kana-only words (no kanji field)
    if (writtenForms.length === 0) {
      for (const k of entry.kana) {
        writtenForms.push(k.text);
      }
    }

    for (const form of writtenForms) {
      if (!trans[form]) {
        trans[form] = { ...row };
        kept++;
      } else {
        // Merge: fill in languages missing from the existing entry
        for (const [lang, val] of Object.entries(row)) {
          if (!trans[form][lang]) trans[form][lang] = val;
        }
      }
    }
  }

  console.log(`Processed ${processed} entries, kept ${kept} forms with translations.`);
  return trans;
}

// ── 6. Main ───────────────────────────────────────────────────────────────────

async function main() {
  try {
    const { url, name, type } = await getDownloadUrl();

    await mkdir(TMP, { recursive: true });

    const dlPath   = join(TMP, name);
    const jsonPath = join(TMP, 'jmdict-all.json');

    await download(url, dlPath);

    if (type === 'gz') {
      await decompressGz(dlPath, jsonPath);
    } else {
      await extractZip(dlPath, jsonPath);
    }

    console.log('Parsing JSON (this may take a few seconds)…');
    const raw = await readFile(jsonPath, 'utf8');
    const jmdict = JSON.parse(raw);
    console.log(`Loaded ${jmdict.words.length} words.`);

    const trans = buildTransMap(jmdict);

    await writeFile(OUT, JSON.stringify(trans), 'utf8');
    const sizeKB = Math.round((JSON.stringify(trans).length) / 1024);
    console.log(`Written to ${OUT} (${sizeKB} KB, ${Object.keys(trans).length} entries)`);

  } finally {
    // Clean up temp files
    await rm(TMP, { recursive: true, force: true });
  }
}

main().catch(err => { console.error(err); process.exit(1); });
