/**
 * post-reels.mjs
 *
 * Poste les reels sur TikTok + Instagram via l'API Buffer GraphQL v2.
 *
 * Usage :
 *   node scripts/post-reels.mjs --level n5 --video-base-url https://asanokanji.com/reels/
 *   node scripts/post-reels.mjs --level n5 --dry-run
 *   node scripts/post-reels.mjs --list-profiles
 *   node scripts/post-reels.mjs --level n5 --platforms tiktok --video-base-url https://asanokanji.com/reels/
 */

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Load .env ─────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split('\n')) {
    const m = line.replace(/\r$/, '').match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
loadEnv();

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const get = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };
const has = (flag) => args.includes(flag);

const LEVEL          = get('--level', 'n5').toLowerCase();
const CUSTOM         = get('--kanji', null);
const DRY_RUN        = has('--dry-run');
const LIST_PROFILES  = has('--list-profiles');
const PLATFORMS_ARG  = get('--platforms', 'tiktok,instagram');
const PLATFORMS      = PLATFORMS_ARG.split(',').map(p => p.trim());
const VIDEO_BASE_URL = get('--video-base-url', null);

// ── Config ────────────────────────────────────────────────────────────────────
const BUFFER_TOKEN        = process.env.BUFFER_TOKEN;
const BUFFER_TIKTOK_ID    = process.env.BUFFER_TIKTOK_ID;
const BUFFER_INSTAGRAM_ID = process.env.BUFFER_INSTAGRAM_ID;

const REELS_DIR   = join(ROOT, 'kanji-cards', LEVEL, 'reels');
const POSTED_FILE = join(ROOT, 'kanji-cards', LEVEL, '.posted.json');
const INDEX_FILE  = join(ROOT, 'public', 'kanji_index.json');

if (!BUFFER_TOKEN) {
  console.error('BUFFER_TOKEN manquant dans .env');
  process.exit(1);
}

// ── Buffer GraphQL API ────────────────────────────────────────────────────────
const BUFFER_API = 'https://api.buffer.com/graphql';

async function gql(query, variables = {}) {
  const res = await fetch(BUFFER_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${BUFFER_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Buffer API non-JSON (${res.status}): ${text}`); }
  if (res.status === 401 || json.errors?.some(e => e?.extensions?.code === 'UNAUTHENTICATED')) {
    throw new Error('Buffer token invalide/expire (UNAUTHENTICATED). Regenerer BUFFER_TOKEN dans .env.');
  }
  if (json.errors?.length) throw new Error(`Buffer API: ${json.errors.map(e => e.message).join('; ')}`);
  return json.data;
}

// ── --list-profiles ───────────────────────────────────────────────────────────
if (LIST_PROFILES) {
  const orgData = await gql(`query { account { organizations { id name } } }`);
  for (const org of orgData.account.organizations) {
    const chData = await gql(`
      query GetChannels($orgId: OrganizationId!) {
        channels(input: { organizationId: $orgId }) { id name service }
      }
    `, { orgId: org.id });
    console.log(`\nOrg: ${org.name} (${org.id})`);
    for (const ch of chData.channels) {
      console.log(`  ${ch.service.padEnd(14)} id=${ch.id}  ${ch.name}`);
    }
  }
  console.log('\nCopie les IDs dans ton .env :');
  console.log('  BUFFER_TIKTOK_ID=<id du channel TikTok>');
  console.log('  BUFFER_INSTAGRAM_ID=<id du channel Instagram>');
  // small delay to let fetch connections close cleanly (Node v25 Windows bug)
  await new Promise(r => setTimeout(r, 200));
  process.exit(0);
}

// ── Channel IDs validation ────────────────────────────────────────────────────
const channelIds = [];
if (PLATFORMS.includes('tiktok')) {
  if (!BUFFER_TIKTOK_ID) { console.error('BUFFER_TIKTOK_ID manquant dans .env'); process.exit(1); }
  channelIds.push(BUFFER_TIKTOK_ID);
}
if (PLATFORMS.includes('instagram')) {
  if (!BUFFER_INSTAGRAM_ID) { console.error('BUFFER_INSTAGRAM_ID manquant dans .env'); process.exit(1); }
  channelIds.push(BUFFER_INSTAGRAM_ID);
}
if (channelIds.length === 0 && !DRY_RUN) {
  console.error('Aucune platform valide (tiktok|instagram)');
  process.exit(1);
}

// ── State: kanji deja postes ──────────────────────────────────────────────────
const posted = existsSync(POSTED_FILE)
  ? JSON.parse(readFileSync(POSTED_FILE, 'utf8'))
  : {};

function markPosted(kanji, postIds) {
  posted[kanji] = { ids: postIds, at: new Date().toISOString() };
  writeFileSync(POSTED_FILE, JSON.stringify(posted, null, 2));
}

// ── Kanji index ───────────────────────────────────────────────────────────────
const kanjiIndex = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));

// ── Caption generator ─────────────────────────────────────────────────────────
const HASHTAGS = [
  '#Japanese', '#LearnJapanese', '#Kanji', '#KanjiOfTheDay',
  '#JapaneseLesson', '#JLPT', `#JLPT${LEVEL.toUpperCase()}`,
  '#日本語', '#日本語勉強中', '#漢字',
].join(' ');

function cleanReading(r) { return r.replace(/\..*/g, ''); }

function buildCaption(kanji) {
  const data = kanjiIndex[kanji];
  if (!data) return `Kanji: ${kanji}\n\n${HASHTAGS}`;

  const onReadings  = [...new Set((data.o || []).map(r => r.toLowerCase()))].join(' / ');
  const kunReadings = [...new Set((data.k || []).map(cleanReading))].join(' / ');
  const meaning     = data.m || '';

  const lines = [`Kanji #${LEVEL.toUpperCase()}: ${kanji}`];
  if (meaning)     lines.push(`Meaning: ${meaning}`);
  if (kunReadings) lines.push(`Kun: ${kunReadings}`);
  if (onReadings)  lines.push(`On: ${onReadings}`);
  lines.push('');
  lines.push(HASHTAGS);

  return lines.join('\n');
}

// ── Video URL ─────────────────────────────────────────────────────────────────
function getVideoUrl(kanji) {
  if (!VIDEO_BASE_URL) throw new Error('--video-base-url requis (ex: https://asanokanji.com/reels/)');
  const base = VIDEO_BASE_URL.endsWith('/') ? VIDEO_BASE_URL : VIDEO_BASE_URL + '/';
  return base + encodeURIComponent(kanji) + '.mp4';
}

// ── Schedule post via Buffer GraphQL ─────────────────────────────────────────
async function schedulePost(kanji, mp4Path) {
  const caption = buildCaption(kanji);

  if (DRY_RUN) {
    console.log(`\n[DRY RUN] ${kanji}`);
    console.log(`  Fichier  : ${mp4Path}`);
    console.log(`  URL      : ${VIDEO_BASE_URL ? getVideoUrl(kanji) : '(upload 0x0.st)'}`);
    console.log(`  Channels : ${channelIds.join(', ') || '(dry-run, no channels needed)'}`);
    console.log(`  Caption  :\n${caption.split('\n').map(l => '    ' + l).join('\n')}`);
    return null;
  }

  const videoUrl = getVideoUrl(kanji);
  console.log(`  URL: ${videoUrl}`);

  const postIds = [];
  for (const channelId of channelIds) {
    const data = await gql(`
      mutation CreatePost($input: CreatePostInput!) {
        createPost(input: $input) {
          ... on PostActionSuccess { post { id dueAt } }
          ... on MutationError { message }
        }
      }
    `, {
      input: {
        text: caption,
        channelId,
        schedulingType: 'automatic',
        mode: 'addToQueue',
        assets: [{ video: { url: videoUrl } }],
      },
    });

    const result = data.createPost;
    if (result.post) {
      postIds.push(result.post.id);
      console.log(`  Channel ${channelId} -> post ${result.post.id} (${result.post.dueAt || 'queue'})`);
    } else {
      throw new Error(`Channel ${channelId}: ${result.message}`);
    }
  }

  return postIds;
}

// ── Main ──────────────────────────────────────────────────────────────────────
if (!existsSync(REELS_DIR)) {
  console.error(`Dossier reels introuvable: ${REELS_DIR}`);
  process.exit(1);
}

let targetKanji;
if (CUSTOM) {
  targetKanji = CUSTOM.split(',').map(k => k.trim());
} else {
  targetKanji = readdirSync(REELS_DIR)
    .filter(f => f.endsWith('.mp4'))
    .map(f => f.replace('.mp4', ''))
    .filter(k => !posted[k]);
}

if (targetKanji.length === 0) {
  console.log(`Tous les reels ${LEVEL.toUpperCase()} sont deja postes (ou aucun trouve).`);
  process.exit(0);
}

console.log(`\n${targetKanji.length} reels a poster -- ${LEVEL.toUpperCase()}`);
console.log(`Platforms : ${PLATFORMS.join(' + ')}`);
if (DRY_RUN) console.log('[MODE DRY-RUN -- aucun post reel]');
console.log(targetKanji.join(' ') + '\n');

let ok = 0, skip = 0, fail = 0;

for (const kanji of targetKanji) {
  const mp4 = join(REELS_DIR, `${kanji}.mp4`);
  if (!existsSync(mp4)) {
    console.log(`SKIP ${kanji} -- MP4 absent`);
    skip++;
    continue;
  }

  const sizeMB = (statSync(mp4).size / 1024 / 1024).toFixed(1);
  console.log(`POST ${kanji} (${sizeMB} MB)`);

  try {
    const postIds = await schedulePost(kanji, mp4);
    if (!DRY_RUN && postIds) {
      markPosted(kanji, postIds);
    }
    ok++;
  } catch (e) {
    console.error(`  ERROR: ${e.message}`);
    fail++;
  }
}

console.log(`\nDone: ${ok} postes, ${skip} skips, ${fail} erreurs`);
if (!DRY_RUN && ok > 0) {
  console.log(`Suivi: kanji-cards/${LEVEL}/.posted.json`);
}
