import { readFileSync, writeFileSync } from 'fs';
const src = readFileSync('src/kanji.js', 'utf8');

// Extract SENTENCE_OVERRIDE block
const startIdx = src.indexOf('SENTENCE_OVERRIDE = {');
const endIdx = src.indexOf('\n};', startIdx) + 3;
const block = src.slice(startIdx, endIdx);

// Parse each kanji entry - extract {jp, en} objects
const entryRe = /['"](\p{Script=Han})['"]:\s*\[([\s\S]*?)\],?\s*\n/gu;
let m;
const dupes = [];
while ((m = entryRe.exec(block)) !== null) {
  const kanji = m[1];
  const inner = m[2];
  // extract jp values
  const jpMatches = [...inner.matchAll(/jp:\s*['"]([^'"]+)['"]/g)].map(x => x[1]);
  // extract en values  
  const enMatches = [...inner.matchAll(/en:\s*['"]([^'"]+)['"]/g)].map(x => x[1]);
  const jpUnique = new Set(jpMatches);
  const enUnique = new Set(enMatches);
  if (jpUnique.size < jpMatches.length || enUnique.size < enMatches.length) {
    dupes.push({ kanji, jp: jpMatches, en: enMatches });
  }
}

const lines = [`Kanji with duplicate phrases: ${dupes.length}`];
dupes.forEach(d => lines.push(`${d.kanji}\n  JP: ${d.jp.join(' | ')}\n  EN: ${d.en.join(' | ')}`));
const out = lines.join('\n');
writeFileSync('_dupes-result.txt', out, 'utf8');
console.log(out);
