#!/usr/bin/env node
/**
 * ai-fill-sentences.mjs
 *
 * Uses OpenAI GPT-4o-mini to generate high-quality example sentences
 * for every vocab word missing from public/sentences.json.
 *
 * Usage:
 *   node scripts/ai-fill-sentences.mjs
 *   node scripts/ai-fill-sentences.mjs --level n3        # only N3 words
 *   node scripts/ai-fill-sentences.mjs --word 脳死       # single word
 *   node scripts/ai-fill-sentences.mjs --words "作曲,描写"  # specific words
 *   node scripts/ai-fill-sentences.mjs --dry-run         # test 5 words, no save
 *   node scripts/ai-fill-sentences.mjs --force           # regenerate existing too
 *
 * Requires OPENAI_API_KEY in .env
 *
 * After this script, run:
 *   node scripts/add-furigana.mjs
 */

import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');
const SENT_PATH = path.join(ROOT, 'public', 'sentences.json');
const DB_PATH   = path.join(__dirname, 'vocab-db.json');

// ── Load .env ────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split('\n')) {
    const m = line.replace(/\r$/, '').match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) {
  console.error('❌  OPENAI_API_KEY not found in .env');
  process.exit(1);
}

// ── CLI args ──────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const get     = (f, d) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : d; };
const has     = (f) => args.includes(f);

const LEVEL_FILTER = get('--level', null)?.toLowerCase(); // e.g. "n3"
const SINGLE_WORD  = get('--word',  null);
const WORDS_LIST   = get('--words', null); // comma-separated: "作曲,描写"
const DRY_RUN      = has('--dry-run');
const FORCE        = has('--force');
const CONCURRENCY  = parseInt(get('--concurrency', '5'), 10); // parallel calls

// ── Load data ─────────────────────────────────────────────────────────────────
const sentences = JSON.parse(fs.readFileSync(SENT_PATH, 'utf8'));
const db        = JSON.parse(fs.readFileSync(DB_PATH,   'utf8'));

// ── Target word list ──────────────────────────────────────────────────────────
let targets = db;

if (SINGLE_WORD) {
  targets = db.filter(w => w.word === SINGLE_WORD);
  if (!targets.length) {
    console.error(`❌  Word "${SINGLE_WORD}" not found in vocab-db.json`);
    process.exit(1);
  }
} else if (WORDS_LIST) {
  const wordSet = new Set(WORDS_LIST.split(',').map(w => w.trim()).filter(Boolean));
  targets = db.filter(w => wordSet.has(w.word));
  const found = new Set(targets.map(w => w.word));
  for (const w of wordSet) {
    if (!found.has(w)) console.warn(`⚠️  Word "${w}" not found in vocab-db.json`);
  }
  if (!targets.length) {
    console.error('❌  No matching words found in vocab-db.json');
    process.exit(1);
  }
  if (!FORCE) {
    targets = targets.filter(w => !sentences[w.word]);
  }
} else {
  if (LEVEL_FILTER) {
    const num = parseInt(LEVEL_FILTER.replace('n', ''), 10);
    targets = targets.filter(w => w.jlptNum === num);
  }
  if (!FORCE) {
    targets = targets.filter(w => !sentences[w.word]);
  }
}

if (DRY_RUN) targets = targets.slice(0, 5);

console.log(`▶ ${targets.length} words to generate${DRY_RUN ? ' (DRY RUN)' : ''}`);
if (!targets.length) { console.log('  Nothing to do.'); process.exit(0); }

// ── Max length by JLPT level ──────────────────────────────────────────────────
const MAX_LEN = { 5: 22, 4: 28, 3: 35, 2: 42, 1: 50 };
const POLITE_RE = /(です|ます|ました|でした|ません|ませんでした|でしょう|ましょう|ください)[ねよか]?[。？！]$/u;

// ── OpenAI call ───────────────────────────────────────────────────────────────
async function generateSentence(word, reading, jlptNum, attempt = 1) {
  const maxLen = MAX_LEN[jlptNum] ?? 40;
  const level  = `N${jlptNum}`;

  // Rotate subject hints to avoid all sentences starting with 彼/この
  const SUBJECTS = ['私', '友達', '先生', '山田さん', '子供たち', '母', '兄', '田中さん', '学生', '社員'];
  const subjectHint = SUBJECTS[(attempt * 7 + word.charCodeAt(0)) % SUBJECTS.length];

  const prompt = `You are a Japanese language teacher writing example sentences for a JLPT ${level} vocabulary app.

Write ONE natural Japanese sentence using the word「${word}」(reading: ${reading}).

STRICT rules:
- Maximum ${maxLen} Japanese characters
- Must end in polite form: です・ます・ました・でした・ません・でしょう・ましょう (followed by 。)
- Must contain the exact word「${word}」as a STANDALONE word — NOT embedded inside a longer compound. If the target word is 動, use 動く/動かす, NOT 運動 or 活動.
- Vary the subject — consider using: ${subjectHint}、or a situation/general statement
- Avoid always using 彼/彼女/この — show the word in a real-life context
- Show the word being *used*, not just defined (avoid "〜は〜です" as the only pattern)
- Natural, educational, appropriate for ${level} learners
- No slang, violence, or inappropriate content
- Everyday realistic situations ONLY: school, work, family, shopping, travel, food, hobbies, weather, health
- Avoid niche internet culture, fandoms, subcultures, or anything that would confuse a language learner
- ALL words in the sentence must be JLPT ${level} vocabulary or easier — do NOT use vocabulary harder than ${level}
- English translation must be DIRECT and LITERAL — translate exactly what the Japanese says. Do NOT use idioms, figurative expressions, or paraphrases that change the meaning.

Return ONLY valid JSON:
{"jp": "sentence。", "en": "English translation."}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model:       'gpt-4o-mini',
      messages:    [{ role: 'user', content: prompt }],
      temperature: attempt === 1 ? 0.4 : 0.7, // more creative on retry
      max_tokens:  120,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI ${res.status}: ${err.slice(0, 200)}`);
  }

  const data  = await res.json();
  const raw   = data.choices?.[0]?.message?.content?.trim() ?? '';

  // Strip markdown code fences if model wraps in ```json ... ```
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`JSON parse fail: ${raw.slice(0, 100)}`);
  }

  const jp = parsed.jp?.trim();
  const en = parsed.en?.trim();

  if (!jp || !en)              throw new Error(`Missing jp/en in: ${JSON.stringify(parsed)}`);
  if (!jp.includes(word))      throw new Error(`Word not found in sentence: ${jp}`);
  if (jp.length > maxLen + 5)  throw new Error(`Too long (${jp.length}): ${jp}`);
  if (!POLITE_RE.test(jp))     throw new Error(`Not polite form: ${jp}`);

  return { jp, en, ruby: '' };
}

// ── Worker: retry up to 3 times ───────────────────────────────────────────────
async function processWord(entry, index, total) {
  const prefix = `  [${index}/${total}] ${entry.word}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await generateSentence(entry.word, entry.reading, entry.jlptNum, attempt);
      return { entry, result, ok: true };
    } catch (err) {
      if (attempt === 3) {
        return { entry, error: err.message, ok: false };
      }
      // short pause before retry
      await sleep(500);
    }
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Main: concurrent batches ──────────────────────────────────────────────────
let done = 0, found = 0, failed = 0;
const failures = [];

for (let i = 0; i < targets.length; i += CONCURRENCY) {
  const batch = targets.slice(i, i + CONCURRENCY);
  const total  = targets.length;

  const results = await Promise.all(
    batch.map((entry, j) => processWord(entry, i + j + 1, total))
  );

  for (const r of results) {
    done++;
    if (r.ok) {
      if (!DRY_RUN) sentences[r.entry.word] = r.result;
      found++;
      console.log(`  ✓ ${r.entry.word} (N${r.entry.jlptNum}): ${r.result.jp}`);
    } else {
      failed++;
      failures.push(r.entry.word);
      console.log(`  ✗ ${r.entry.word}: ${r.error}`);
    }
  }

  // Save checkpoint every 50 words
  if (!DRY_RUN && done % 50 === 0) {
    fs.writeFileSync(SENT_PATH, JSON.stringify(sentences, null, 2));
    console.log(`  💾 Checkpoint saved (${Object.keys(sentences).length} total)`);
  }

  // Small pause between batches to avoid rate limiting
  if (i + CONCURRENCY < targets.length) await sleep(300);
}

// ── Final save ────────────────────────────────────────────────────────────────
if (!DRY_RUN) {
  fs.writeFileSync(SENT_PATH, JSON.stringify(sentences, null, 2));
  const total = Object.keys(sentences).length;
  const coverage = ((total / db.length) * 100).toFixed(1);
  console.log(`\n▶ Done.`);
  console.log(`  Generated : ${found} sentences`);
  console.log(`  Failed    : ${failed}`);
  console.log(`  Total     : ${total} / ${db.length} (${coverage}% coverage)`);
  if (failures.length) {
    console.log(`\n  Failed words: ${failures.join(', ')}`);
  }
  console.log(`\n  Next step: node scripts/add-furigana.mjs`);
} else {
  console.log(`\n▶ Dry run complete. ${found}/${targets.length} would succeed.`);
}
