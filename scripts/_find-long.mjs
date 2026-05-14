import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

// Get N5/N4 kanji from generated card folders
const ROOT = 'kanji-cards';
function getGeneratedKanji(level) {
  const dir = join(ROOT, level, 'tiktok');
  if (!existsSync(dir)) return new Set();
  return new Set(readdirSync(dir));
}
const n5Set = getGeneratedKanji('n5');
const n4Set = getGeneratedKanji('n4');
const targetSet = new Set([...n5Set, ...n4Set]);
console.log(`N5: ${n5Set.size} kanji, N4: ${n4Set.size} kanji`);

// Read SENTENCE_OVERRIDE from kanji.js
const src = readFileSync('src/kanji.js', 'utf8');
const match = src.match(/const SENTENCE_OVERRIDE\s*=\s*\{([\s\S]*?)\n\};/);
if (!match) { console.log('SENTENCE_OVERRIDE not found'); process.exit(1); }

const block = match[1];
const entries = [...block.matchAll(/'([\u4E00-\u9FFF])'\s*:\s*\[([\s\S]*?)\],/g)];

// TikTok: availW = 940 - 70*2 - 30*2 = 740, sentJpFont=37 → threshold ~20 chars
const THRESH = 20;

const longMap = new Map();
for (const [, kanji, body] of entries) {
  if (!targetSet.has(kanji)) continue; // only N5/N4
  const jps = [...body.matchAll(/jp:\s*'([^']+)'/g)].map(m => m[1]);
  for (const jp of jps) {
    if (jp.length > THRESH) {
      if (!longMap.has(kanji)) longMap.set(kanji, []);
      longMap.get(kanji).push({ len: jp.length, jp });
    }
  }
}

if (longMap.size === 0) {
  console.log(`\nNo N5/N4 kanji have phrases > ${THRESH} chars in SENTENCE_OVERRIDE.`);
} else {
  console.log(`\nN5/N4 phrases > ${THRESH} chars in SENTENCE_OVERRIDE:\n`);
  for (const [kanji, items] of longMap) {
    const lvl = n5Set.has(kanji) ? 'N5' : 'N4';
    for (const { len, jp } of items) {
      console.log(`  [${lvl}] ${kanji} (${len}): ${jp}`);
    }
  }
  console.log(`\nTotal kanji: ${longMap.size}`);
  console.log([...longMap.keys()].join(','));
}
