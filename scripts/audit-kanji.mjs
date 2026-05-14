#!/usr/bin/env node
/**
 * scripts/audit-kanji.mjs
 * Fetches all JLPT kanji + their API meanings/examples and produces
 * audit-kanji.json — a report of what the app currently displays.
 *
 * Run: node scripts/audit-kanji.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Reproduce sortGlosses logic from src/utils.js ─────────────────────────
const KANJI_GLOSS_DEPRIORITIZE_RE = new RegExp([
  /\bsign of the\b/.source,
  /\bhour of the\b/.source,
  /\b\d+(am|pm|:\d+)\b/i.source,
  /\bradical\b/.source,
  /^counter for\b/i.source,
  /^Turkey$/.source,
  /^be sufficient$/.source,
].join('|'), 'i');

const RARE_RE = /\b(monarchy|empire|dynasty|shogunate|anniversary|feudal|imperial|shogun|archaic|obsolete|rare|dated|poetic|biblical|mythology|ecclesiastical|heraldry|nautical|mahjong|shogi|sumo|cricket|poker|chess)\b/i;

function sortGlosses(glosses) {
  if (!glosses || glosses.length <= 1) return glosses || [];
  return [...glosses].sort((a, b) => {
    const aD = KANJI_GLOSS_DEPRIORITIZE_RE.test(a) || RARE_RE.test(a);
    const bD = KANJI_GLOSS_DEPRIORITIZE_RE.test(b) || RARE_RE.test(b);
    if (aD && !bD) return 1;
    if (!aD && bD) return -1;
    return 0;
  });
}

// ── KANJI_MEANING_OVERRIDE from src/kanji.js ──────────────────────────────
const KANJI_MEANING_OVERRIDE = {
  '午': ['noon', 'midday'],
  '子': ['child', 'kid'],
  '目': ['eye'],
  '足': ['foot', 'leg'],
  '見': ['see', 'look at', 'watch'],
  '校': ['school', 'educational institution'],
  '空': ['sky', 'air', 'empty'],
  '生': ['life', 'living', 'birth'],
  '立': ['stand', 'stand up', 'rise'],
  '名': ['name', 'famous'],
  '国': ['country', 'nation'],
  '川': ['river', 'stream'],
  '土': ['earth', 'soil', 'ground'],
  '年': ['year'],
  '気': ['spirit', 'energy', 'mood', 'atmosphere'],
  '早': ['early', 'fast', 'quick'],
  '来': ['come', 'arrive'],
  '東': ['east'],
  '南': ['south'],
  '北': ['north'],
  '西': ['west'],
  '発': ['departure', 'emit', 'launch', 'start'],
  '感': ['feeling', 'sense', 'emotion'],
  '楽': ['fun', 'easy', 'comfortable', 'music'],
  '運': ['carry', 'luck', 'fortune', 'transport'],
  '転': ['roll', 'turn', 'rotate', 'change'],
  '起': ['get up', 'rise', 'occur', 'wake up'],
  '考': ['think', 'consider', 'idea'],
  '死': ['death', 'die'],
  '止': ['stop', 'halt'],
  '重': ['heavy', 'important', 'serious', 'pile up'],
  '野': ['field', 'plain', 'wild'],
  '服': ['clothes', 'clothing', 'obey'],
  '者': ['person', 'someone'],
  '理': ['reason', 'logic', 'principle', 'manage'],
  '活': ['lively', 'active', 'live'],
};

function bestKanjiMeaning(char, apiMeanings) {
  if (KANJI_MEANING_OVERRIDE[char]) return KANJI_MEANING_OVERRIDE[char].join(', ');
  return sortGlosses(apiMeanings ?? ['?']).slice(0, 4).join(', ');
}

// ── EXAMPLE_OVERRIDE from src/kanji.js ───────────────────────────────────
const EXAMPLE_OVERRIDE = {
  '一': [{ w: '一つ', r: 'ひとつ', m: 'one; one thing' }, { w: '一人', r: 'ひとり', m: 'one person; alone' }, { w: '一番', r: 'いちばん', m: 'number one; first; best' }],
  '二': [{ w: '二つ', r: 'ふたつ', m: 'two; two things' }, { w: '二人', r: 'ふたり', m: 'two people; both' }, { w: '二月', r: 'にがつ', m: 'February' }],
  '三': [{ w: '三つ', r: 'みっつ', m: 'three; three things' }, { w: '三月', r: 'さんがつ', m: 'March' }, { w: '三人', r: 'さんにん', m: 'three people' }],
  '四': [{ w: '四つ', r: 'よっつ', m: 'four; four things' }, { w: '四月', r: 'しがつ', m: 'April' }, { w: '四日', r: 'よっか', m: '4th day of the month' }],
  '五': [{ w: '五つ', r: 'いつつ', m: 'five; five things' }, { w: '五月', r: 'ごがつ', m: 'May' }, { w: '五日', r: 'いつか', m: '5th day of the month' }],
  '六': [{ w: '六つ', r: 'むっつ', m: 'six; six things' }, { w: '六月', r: 'ろくがつ', m: 'June' }, { w: '六日', r: 'むいか', m: '6th day of the month' }],
  '七': [{ w: '七月', r: 'しちがつ', m: 'July' }, { w: '七日', r: 'なのか', m: '7th day of month' }, { w: '七つ', r: 'ななつ', m: 'seven' }],
  '八': [{ w: '八つ', r: 'やっつ', m: 'eight; eight things' }, { w: '八月', r: 'はちがつ', m: 'August' }, { w: '八日', r: 'ようか', m: '8th day of the month' }],
  '九': [{ w: '九つ', r: 'ここのつ', m: 'nine; nine things' }, { w: '九月', r: 'くがつ', m: 'September' }, { w: '九日', r: 'ここのか', m: '9th day of the month' }],
  '十': [{ w: '十月', r: 'じゅうがつ', m: 'October' }, { w: '十分', r: 'じゅうぶん', m: 'enough; sufficient' }, { w: '二十', r: 'にじゅう', m: 'twenty' }],
  '百': [{ w: '百円', r: 'ひゃくえん', m: '100 yen' }, { w: '百万', r: 'ひゃくまん', m: 'one million' }, { w: '三百', r: 'さんびゃく', m: 'three hundred' }],
  '千': [{ w: '千円', r: 'せんえん', m: '1000 yen' }, { w: '何千', r: 'なんぜん', m: 'thousands of' }, { w: '三千', r: 'さんぜん', m: 'three thousand' }],
  '万': [{ w: '一万', r: 'いちまん', m: '10,000; ten thousand' }, { w: '何万', r: 'なんまん', m: 'tens of thousands' }, { w: '万年筆', r: 'まんねんひつ', m: 'fountain pen' }],
};

// ── FREQ data ─────────────────────────────────────────────────────────────
// We don't have access to FREQ here, so we rely on API priorities only
const GLOSS_SKIP_RE = /^\((french|german|english|dutch|portuguese|chinese|korean|approx|abbr|uk|us|lit|fig|also|esp|orig|hist|obs|arch)\)/i;
const GLOSS_RARE_RE = /\b(monarchy|empire|dynasty|shogunate|anniversary|feudal|imperial|shogun|archaic|obsolete|rare|dated|poetic|biblical|mythology|ecclesiastical|heraldry|nautical|mahjong|shogi|sumo|cricket|poker|chess)\b/i;

function getBestExamples(wordEntries, targetChar) {
  if (EXAMPLE_OVERRIDE[targetChar]) return EXAMPLE_OVERRIDE[targetChar];
  const candidates = [];
  for (const entry of wordEntries) {
    const variants = (entry.variants ?? []).filter(v => v.written?.includes(targetChar));
    if (!variants.length) continue;
    const variant = variants.find(v => v.priorities?.length > 0) ?? variants[0];
    let gloss = null;
    for (const m of (entry.meanings ?? [])) {
      for (const g of (m.glosses ?? [])) {
        if (!GLOSS_SKIP_RE.test(g) && !GLOSS_RARE_RE.test(g)) { gloss = g; break; }
      }
      if (gloss) break;
    }
    if (!gloss) gloss = entry.meanings?.[0]?.glosses?.[0];
    if (!gloss || gloss.length < 4) continue;
    const prios = variant.priorities ?? [];
    const nfMatch = prios.map(p => p.match(/^nf(\d+)$/)).find(Boolean);
    const freqRank = nfMatch ? parseInt(nfMatch[1]) * 100
      : prios.some(p => p === 'ichi1' || p === 'spec1') ? 500
      : 99999;
    candidates.push({
      w: variant.written,
      r: (variant.pronounced ?? '').replace(/[\u30A1-\u30F6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)),
      m: gloss.length > 50 ? gloss.slice(0, 48) + '…' : gloss,
      freq: freqRank,
      len: variant.written.length,
    });
  }
  candidates.sort((a, b) => a.freq - b.freq || a.len - b.len);
  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    if (!seen.has(c.w)) { seen.add(c.w); out.push({ w: c.w, r: c.r, m: c.m }); }
    if (out.length >= 3) break;
  }
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const LEVELS = [5, 4, 3, 2, 1];
const report = {};

for (const lvl of LEVELS) {
  const label = `n${lvl}`;
  console.log(`\n── N${lvl} ──────────────────────────`);
  const list = await fetchJSON(`https://kanjiapi.dev/v1/kanji/jlpt-${lvl}`);
  report[label] = [];

  for (const char of list) {
    try {
      const [detail, words] = await Promise.all([
        fetchJSON(`https://kanjiapi.dev/v1/kanji/${encodeURIComponent(char)}`),
        fetchJSON(`https://kanjiapi.dev/v1/words/${encodeURIComponent(char)}`).catch(() => []),
      ]);
      const displayMeaning = bestKanjiMeaning(char, detail.meanings ?? []);
      const apiMeanings    = (detail.meanings ?? []).slice(0, 6);
      const examples       = getBestExamples(words, char);
      const hasOverride    = !!KANJI_MEANING_OVERRIDE[char];
      const hasExOverride  = !!EXAMPLE_OVERRIDE[char];

      report[label].push({
        char,
        display: displayMeaning,
        api_meanings: apiMeanings,
        has_override: hasOverride,
        examples,
        has_ex_override: hasExOverride,
      });
      process.stdout.write('.');
    } catch (e) {
      report[label].push({ char, error: e.message });
      process.stdout.write('!');
    }
    await sleep(60); // be polite to the API
  }
}

const outPath = join(ROOT, 'scripts', 'audit-kanji.json');
writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log(`\n\n✅ Rapport écrit → scripts/audit-kanji.json`);
console.log(`   ${Object.values(report).flat().length} kanji audités`);
