import { API, LEVEL_WEIGHT, VOCAB_LEVEL_WEIGHT } from './config.js';
import { cacheGet, cacheSet } from './cache.js';
import { state } from './state.js';

// ── HTTP helpers ──────────────────────────────────────────────────────────
async function apiFetch(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

export async function getJLPTList(num) {
  const key  = `jlpt_list_${num}`;
  let   list = cacheGet(key);
  if (!list) { list = await apiFetch(`/kanji/jlpt-${num}`); cacheSet(key, list); }
  return list; // string[]
}

export async function getKanjiDetail(char) {
  const key = `kanji_${char}`;
  let   d   = cacheGet(key);
  if (!d) { d = await apiFetch(`/kanji/${encodeURIComponent(char)}`); cacheSet(key, d); }
  return d;
}

export async function getWords(char) {
  const key = `words_${char}`;
  let   w   = cacheGet(key);
  if (!w) {
    try { w = await apiFetch(`/words/${encodeURIComponent(char)}`); cacheSet(key, w); }
    catch { w = []; }
  }
  return w;
}

// ── Example sentences (Tatoeba CC-BY) ────────────────────────────────────
export async function fetchExampleSentences(word) {
  const key = `ex_${word}`;
  const cached = cacheGet(key);
  if (cached !== null && cached.length > 0) return cached;
  try {
    const url = `https://tatoeba.org/api_v0/search?from=jpn&to=eng&query=${encodeURIComponent(word)}&limit=5`;
    const res = await fetch(url);
    if (!res.ok) { return []; }
    const data = await res.json();
    const sentences = (data.results || [])
      .filter(r => r.text && r.translations?.[0]?.[0]?.text)
      .slice(0, 3)
      .map(r => ({ jp: r.text, en: r.translations[0][0].text }));
    if (sentences.length > 0) cacheSet(key, sentences);
    return sentences;
  } catch {
    return [];
  }
}

// ── Pool builder ──────────────────────────────────────────────────────────
// Builds weighted random pools for kanji and vocab tabs. Cached in state.
export async function buildPool() {
  const lists = await Promise.all([5, 4, 3, 2, 1].map(n => getJLPTList(n)));
  state.POOL = []; state.VOCAB_POOL = [];
  [5, 4, 3, 2, 1].forEach((jlptNum, idx) => {
    lists[idx].forEach(char => {
      for (let i = 0; i < LEVEL_WEIGHT[jlptNum]; i++)
        state.POOL.push({ char, jlptNum });
      for (let i = 0; i < VOCAB_LEVEL_WEIGHT[jlptNum]; i++)
        state.VOCAB_POOL.push({ char, jlptNum });
    });
  });
}

// ── Pickers ───────────────────────────────────────────────────────────────
export function pickVocabChars(n) {
  const filteredPool = state.vocabLevelFilter === 'all'
    ? state.VOCAB_POOL
    : state.VOCAB_POOL.filter(x => x.jlptNum === Number(state.vocabLevelFilter));
  const source     = filteredPool.length ? filteredPool : state.VOCAB_POOL;
  const uniqueChars = [...new Set(source.map(x => x.char))];
  const pickN       = Math.min(n, uniqueChars.length);
  const chosen = [], seen = new Set();
  let tries = 0;
  while (chosen.length < pickN && tries < source.length * 4) {
    const item = source[Math.floor(Math.random() * source.length)];
    if (!seen.has(item.char)) { seen.add(item.char); chosen.push(item); }
    tries++;
  }
  if (chosen.length < pickN) {
    for (const char of uniqueChars) {
      if (chosen.length >= pickN) break;
      if (!seen.has(char)) { seen.add(char); chosen.push(source.find(x => x.char === char)); }
    }
  }
  return chosen;
}

export function pickChars(n) {
  const filteredPool = state.kanjiLevelFilter === 'all'
    ? state.POOL
    : state.POOL.filter(x => x.jlptNum === Number(state.kanjiLevelFilter));
  const source      = filteredPool.length ? filteredPool : state.POOL;
  const uniqueChars = [...new Set(source.map(x => x.char))];
  const pickN       = Math.min(n, uniqueChars.length);
  const chosen = [], seen = new Set();
  let tries = 0;
  while (chosen.length < pickN && tries < source.length * 4) {
    const item = source[Math.floor(Math.random() * source.length)];
    if (!seen.has(item.char)) { seen.add(item.char); chosen.push(item); }
    tries++;
  }
  if (chosen.length < pickN) {
    for (const char of uniqueChars) {
      if (chosen.length >= pickN) break;
      if (!seen.has(char)) { seen.add(char); chosen.push(source.find(x => x.char === char)); }
    }
  }
  return chosen;
}
