#!/usr/bin/env node
/**
 * schedule-buffer.mjs
 * Schedule kanji + vocab reels to Buffer, alternating midnight/noon.
 *
 * Usage:
 *   node scripts/schedule-buffer.mjs [options]
 *
 * Options:
 *   --dry-run          Preview schedule without posting
 *   --level=n5         Kanji level (default: n5)
 *   --count=N          Number of days to schedule (default: all)
 *   --start=YYYY-MM-DD Start date (default: tomorrow)
 *   --platform=tiktok|instagram|both  (default: both)
 *
 * Requires in .env:
 *   BUFFER_TOKEN=...
 *   BUFFER_TIKTOK_ID=...
 *   BUFFER_INSTAGRAM_ID=...
 *
 * Structure:
 *   Day N  00:00  → kanji reel  (kanji-cards/{level}/reels/{kanji}.mp4)
 *   Day N  12:00  → vocab reel  (vocab-cards/reels/{word}.mp4)
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');

function getArg(name) {
  // supports both --name=value and --name value
  const eqIdx = args.findIndex(a => a.startsWith(`--${name}=`));
  if (eqIdx !== -1) return args[eqIdx].split('=')[1];
  const spIdx = args.indexOf(`--${name}`);
  if (spIdx !== -1 && args[spIdx + 1] && !args[spIdx + 1].startsWith('--')) return args[spIdx + 1];
  return undefined;
}

const LEVEL       = (getArg('level')    || 'n5').toLowerCase();
const COUNT_ARG   =  getArg('count');
const START_ARG   =  getArg('start');
const PLATFORM    = (getArg('platform') || 'both').toLowerCase();
const OFFSET      =  parseInt(getArg('offset') || '0');  // skip first N kanji
const KANJI_ONLY  =  args.includes('--kanji-only');       // no vocab slot

// ── Load .env ─────────────────────────────────────────────────────────────────
const env = {};
try {
  readFileSync(join(ROOT, '.env'), 'utf8').split('\n').forEach(line => {
    const eq = line.indexOf('=');
    if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  });
} catch {}

const TOKEN        = env.BUFFER_TOKEN        || process.env.BUFFER_TOKEN;
const TIKTOK_ID    = env.BUFFER_TIKTOK_ID    || process.env.BUFFER_TIKTOK_ID;
const INSTAGRAM_ID = env.BUFFER_INSTAGRAM_ID || process.env.BUFFER_INSTAGRAM_ID;

if (!TOKEN) {
  console.error('❌ Missing BUFFER_TOKEN in .env');
  process.exit(1);
}

async function gql(query, variables = {}) {
  const res = await fetch('https://api.buffer.com/graphql', {
    method : 'POST',
    headers: {
      'Content-Type' : 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Buffer API non-JSON (${res.status}): ${text}`);
  }

  if (res.status === 401 || json?.errors?.some(e => e?.extensions?.code === 'UNAUTHENTICATED')) {
    throw new Error('Buffer token invalide/expire (UNAUTHENTICATED). Regenerer BUFFER_TOKEN dans .env.');
  }
  if (json?.errors?.length) {
    throw new Error(json.errors.map(e => e.message).join('; '));
  }

  return json.data;
}

try {
  await gql('query { account { organizations { id } } }');
} catch (e) {
  console.error(`❌ Auth Buffer: ${e.message}`);
  process.exit(1);
}

// ── Active profiles ───────────────────────────────────────────────────────────
const profiles = [];
if (PLATFORM !== 'instagram' && TIKTOK_ID)    profiles.push({ id: TIKTOK_ID,    name: 'TikTok' });
if (PLATFORM !== 'tiktok'    && INSTAGRAM_ID) profiles.push({ id: INSTAGRAM_ID, name: 'Instagram' });

if (!profiles.length) {
  console.error('❌ No profile IDs found. Set BUFFER_TIKTOK_ID and/or BUFFER_INSTAGRAM_ID in .env');
  process.exit(1);
}

// ── File lists ────────────────────────────────────────────────────────────────
const kanjiDir = join(ROOT, 'kanji-cards', LEVEL, 'reels');
const vocabDir = join(ROOT, 'vocab-cards', 'reels');

let kanjiFiles, vocabFiles = [];
try { kanjiFiles = readdirSync(kanjiDir).filter(f => f.endsWith('.mp4')).sort(); }
catch { console.error(`❌ Cannot read ${kanjiDir}`); process.exit(1); }
if (!KANJI_ONLY) {
  try { vocabFiles = readdirSync(vocabDir).filter(f => f.endsWith('.mp4')).sort(); }
  catch { console.error(`❌ Cannot read ${vocabDir}\n   (use --kanji-only to skip vocab)`); process.exit(1); }
}

// apply offset
const kanjiSlice = kanjiFiles.slice(OFFSET);
const vocabSlice = KANJI_ONLY ? [] : vocabFiles.slice(OFFSET);

const pairCount = COUNT_ARG
  ? parseInt(COUNT_ARG)
  : KANJI_ONLY ? kanjiSlice.length : Math.min(kanjiSlice.length, vocabSlice.length);

// ── Base URLs on VPS ──────────────────────────────────────────────────────────
const BASE = 'https://asanokanji.com/reels';

// ── Start date ────────────────────────────────────────────────────────────────
const startDate = START_ARG ? new Date(START_ARG + 'T00:00:00') : (() => {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); return d;
})();

// ── Summary ───────────────────────────────────────────────────────────────────
const slotsPerDay = KANJI_ONLY ? 1 : 2;
console.log(`\nBuffer Schedule ${DRY_RUN ? '[DRY RUN] ' : ''}— ${LEVEL.toUpperCase()} ${KANJI_ONLY ? 'kanji only' : 'kanji + vocab'}`);
console.log(`  ${pairCount} days × ${slotsPerDay} posts = ${pairCount * slotsPerDay * profiles.length} total`);
if (OFFSET > 0) console.log(`  Offset   : skip first ${OFFSET} kanji`);
console.log(`  Profiles : ${profiles.map(p => p.name).join(' + ')}`);
console.log(`  Start    : ${startDate.toLocaleDateString('fr-FR')} (minuit kanji${KANJI_ONLY ? '' : ' / midi vocab'})`);
console.log('');

// ── Build schedule ────────────────────────────────────────────────────────────
const schedule = [];
for (let i = 0; i < pairCount; i++) {
  const day = new Date(startDate);
  day.setDate(day.getDate() + i);

  const kanji = kanjiSlice[i % kanjiSlice.length].replace('.mp4', '');

  const midnight = new Date(day); midnight.setHours(0, 0, 0, 0);

  schedule.push({
    type   : 'kanji',
    word   : kanji,
    url    : `${BASE}/${LEVEL}/${encodeURIComponent(kanji)}.mp4`,
    time   : midnight,
    caption: `${kanji}\n\nLearn 2000+ kanji at asanokanji.com\n\n#japanese #kanji #jlpt #${LEVEL} #studyjapanese #日本語`,
  });

  if (!KANJI_ONLY) {
    const vocab = vocabSlice[i % vocabSlice.length].replace('.mp4', '');
    const noon  = new Date(day); noon.setHours(12, 0, 0, 0);
    schedule.push({
      type   : 'vocab',
      word   : vocab,
      url    : `${BASE}/vocab/${encodeURIComponent(vocab)}.mp4`,
      time   : noon,
      caption: `${vocab}\n\nLearn Japanese vocabulary at asanokanji.com\n\n#japanese #vocabulary #jlpt #studyjapanese #日本語学習`,
    });
  }
}

// ── Post to Buffer ────────────────────────────────────────────────────────────
let ok = 0, err = 0;

for (const post of schedule) {
  const label = `${post.type === 'kanji' ? '🈶' : '🗣️'} ${post.word.padEnd(8)} — ${post.time.toLocaleDateString('fr-FR')} ${post.time.getHours() === 0 ? 'minuit' : 'midi  '}`;

  if (DRY_RUN) {
    console.log(`  ${label}  ${post.url}`);
    ok++;
    continue;
  }

  for (const profile of profiles) {
    const mutation = `
      mutation CreatePost($input: CreatePostInput!) {
        createPost(input: $input) {
          ... on PostActionSuccess {
            post { id dueAt }
          }
          ... on MutationError {
            message
          }
        }
      }
    `;
    const input = {
      channelId     : profile.id,
      text          : post.caption,
      schedulingType: 'automatic',
      mode          : 'customScheduled',
      dueAt         : post.time.toISOString(),
      assets        : [{ video: { url: post.url } }],
    };
    if (profile.name === 'Instagram') {
      input.metadata = { instagram: { type: 'reel', shouldShareToFeed: true } };
    }
    const variables = { input };

    try {
      const data = await gql(mutation, variables);
      const result = data?.createPost;
      const errMsg = result?.message || '';

      if (result?.post?.id) {
        console.log(`  ✓ [${profile.name}] ${label}`);
        ok++;
      } else if (errMsg.toLowerCase().includes('too many requests')) {
        console.error(`\n  ⛔ Rate limit hit at [${profile.name}] ${label}`);
        console.error(`  Last successful date: ${post.time.toLocaleDateString('fr-FR')}`);
        console.log(`\n${ok} scheduled, ${err} errors`);
        console.log(`\nResume tomorrow with:`);
        const resumeDate = post.time.toISOString().split('T')[0];
        console.log(`  node scripts/schedule-buffer.mjs --platform both --start ${resumeDate}`);
        process.exit(1);
      } else {
        console.error(`  ✗ [${profile.name}] ${label} → ${errMsg}`);
        err++;
      }
    } catch (e) {
      if (String(e.message).includes('UNAUTHENTICATED') || String(e.message).includes('token invalide')) {
        console.error(`\n❌ Auth Buffer: ${e.message}`);
        process.exit(1);
      }
      if (String(e.message).toLowerCase().includes('too many requests')) {
        console.error(`\n  ⛔ Rate limit hit at [${profile.name}] ${label}`);
        console.error(`  Last successful date: ${post.time.toLocaleDateString('fr-FR')}`);
        console.log(`\n${ok} scheduled, ${err} errors`);
        console.log(`\nResume tomorrow with:`);
        const resumeDate = post.time.toISOString().split('T')[0];
        console.log(`  node scripts/schedule-buffer.mjs --platform both --start ${resumeDate}`);
        process.exit(1);
      }
      console.error(`  ✗ [${profile.name}] ${label} → ${e.message}`);
      err++;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
}

console.log(`\n${ok} scheduled, ${err} errors`);
if (DRY_RUN) console.log('\nRe-run without --dry-run to actually post to Buffer.');
