#!/usr/bin/env node
// Deletes all scheduled (queued) posts from Buffer — single pass, no duplicates.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const env = {};
try {
  readFileSync(join(ROOT, '.env'), 'utf8').split('\n').forEach(line => {
    const eq = line.indexOf('=');
    if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  });
} catch {}

const TOKEN = env.BUFFER_TOKEN || process.env.BUFFER_TOKEN;

async function gql(query, variables = {}) {
  const res = await fetch('https://api.buffer.com/graphql', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
    body   : JSON.stringify({ query, variables }),
  });
  return res.json();
}

// 1. Get org ID
const acct = await gql(`query { account { organizations { id } } }`);
const orgId = acct?.data?.account?.organizations?.[0]?.id;
if (!orgId) { console.error('Cannot get orgId:', JSON.stringify(acct)); process.exit(1); }

// 2. Collect ALL post IDs (paginated, single pass, all channels)
const ids = [];
let after = null;
while (true) {
  const data = await gql(`
    query($input: PostsInput!, $first: Int, $after: String) {
      posts(input: $input, first: $first, after: $after) {
        edges { node { id } }
        pageInfo { hasNextPage endCursor }
      }
    }
  `, { input: { organizationId: orgId }, first: 100, after });

  const edges = data?.data?.posts?.edges;
  if (!edges) { console.error('Unexpected response:', JSON.stringify(data)); process.exit(1); }
  ids.push(...edges.map(e => e.node.id));

  const pageInfo = data?.data?.posts?.pageInfo;
  if (!pageInfo?.hasNextPage) break;
  after = pageInfo.endCursor;
  await new Promise(r => setTimeout(r, 400));
}

console.log(`Found ${ids.length} posts to delete`);
if (!ids.length) process.exit(0);

// 3. Delete all
let ok = 0, fail = 0;
for (const postId of ids) {
  const data = await gql(`
    mutation($input: DeletePostInput!) {
      deletePost(input: $input) {
        ... on DeletePostSuccess { postId }
        ... on MutationError { message }
      }
    }
  `, { input: { postId } });

  const res = data?.data?.deletePost;
  if (res?.postId) {
    process.stdout.write('.');
    ok++;
  } else {
    process.stdout.write(`\n✗ ${postId} → ${res?.message || JSON.stringify(data)}`);
    fail++;
  }
  await new Promise(r => setTimeout(r, 400));
}

console.log(`\n✓ ${ok} deleted, ${fail} failed.`);
