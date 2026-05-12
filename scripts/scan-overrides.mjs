import { readFileSync } from 'fs';

const src = readFileSync('src/kanji.js', 'utf8');

const startIdx = src.indexOf('const EXAMPLE_OVERRIDE = {');
const endIdx = src.indexOf('\n};', startIdx) + 3;
const block = src.slice(startIdx, endIdx);

const entryRe = /'([\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff])'\s*:\s*\[([\s\S]*?)\],?\s*(?='[\u4e00-\u9fff]|\/\/|};)/g;
const wordRe = /\{\s*w\s*:\s*'([^']+)'/g;

const BAD = ['judo','shogi','sumo','ateji','mahjong','afferent','efferent','pramana',
  'sexagenary','onmyodo','bodhisattva','counter for','kanji radical','intimate bodily',
  'infarction','karuta','breast enlargement','unrefined sake','bald head','trousers',
  'sympathy','relaxing','cardinality','insipidity','ounce of','dead end',
  'wakame','cucumber','shiitake','hiccup','mongolian','sole interest',
  'accumulated surplus','magnetic needle','stage setting','important part',
  'inverse (of a hypothesis'];

let issues = 0;
let m;
while ((m = entryRe.exec(block)) !== null) {
  const kanji = m[1];
  const body = m[2];
  const words = [];
  let wm;
  wordRe.lastIndex = 0;
  while ((wm = wordRe.exec(body)) !== null) words.push(wm[1]);

  if (words.length < 3) {
    console.log(`ISSUE [few-words] ${kanji}: only ${words.length} words`);
    issues++;
  }

  for (const w of words) {
    if (!w.includes(kanji)) {
      console.log(`ISSUE [wrong-kanji] ${kanji}: word "${w}" does not contain it`);
      issues++;
    }
  }

  const meanings = [...body.matchAll(/m\s*:\s*'([^']+)'/g)].map(x => x[1].toLowerCase());
  for (const mn of meanings) {
    for (const bad of BAD) {
      if (mn.includes(bad)) {
        console.log(`ISSUE [bad-meaning] ${kanji}: "${mn}" (matches "${bad}")`);
        issues++;
      }
    }
  }
}
console.log(`--- scan complete: ${issues} issue(s)`);
