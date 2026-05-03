import { LEVEL_LABEL, CLOUD_ENABLED } from './config.js';
import { normalizeMeaning, setStatus, sortGlosses, GLOSS_SKIP_RE, GLOSS_RARE_RE } from './utils.js';
import { getMeaning } from './trans.js';
import { getLang } from './i18n.js';
import { FREQ } from './freq.js';
import { state } from './state.js';
import { getKanjiDetail, getWords, buildPool, pickChars } from './api.js';
import { cloudUpdate } from './cloud.js';

// ── Blacklist: full written forms that are archaic / redundant ────────────
// Only add complete word forms, never bare kanji (they won't match variant.written).
const ARCHAIC_WORDS = new Set([
  '報え', '申せ', '掛かれ', '著わす', '斎く', '映ず', '告ぐ', '知らす',
  '示す',     // prefer 見せる in daily contexts
  '請け取る', // prefer 受け取る
  '云う',     // prefer 言う
]);

// ── Extract best example words from API response ─────────────────────────
// Scoring: prefer short common words, penalize historical/specialized glosses.
export function bestExamples(words, targetChar, max = 3) {
  const candidates   = [];
  const seenMeanings = new Set();

  for (const entry of words) {
    const variant = (entry.variants ?? [])
      .find(v => v.written && v.written.includes(targetChar));
    if (!variant) continue;
    if (ARCHAIC_WORDS.has(variant.written)) continue;

    // Find best gloss: skip glosses that start with a language/qualifier prefix
    let gloss = null;
    for (const meaning of (entry.meanings ?? [])) {
      for (const g of (meaning.glosses ?? [])) {
        if (!GLOSS_SKIP_RE.test(g) && !GLOSS_RARE_RE.test(g)) { gloss = g; break; }
      }
      if (gloss) break;
    }
    // Fallback: accept rare content but skip language prefixes
    if (!gloss) {
      for (const meaning of (entry.meanings ?? [])) {
        for (const g of (meaning.glosses ?? [])) {
          if (!GLOSS_SKIP_RE.test(g)) { gloss = g; break; }
        }
        if (gloss) break;
      }
    }
    if (!gloss) gloss = entry.meanings?.[0]?.glosses?.[0];
    if (!gloss || gloss.length < 5) continue;

    const normGloss = normalizeMeaning(gloss);
    if (seenMeanings.has(normGloss)) continue;
    seenMeanings.add(normGloss);

    const wordLen    = variant.written.length;
    const isRare     = GLOSS_RARE_RE.test(gloss);
    const hasPrefix  = GLOSS_SKIP_RE.test(gloss);
    // Frequency rank: lower = more common. Unknown words get rank 99999.
    const freqRank   = FREQ[variant.written] ?? 99999;
    // Score: low frequency rank = low score = appears first
    const score      = (freqRank / 100) + (isRare ? 20 : 0) + (hasPrefix ? 10 : 0) + (wordLen > 4 ? wordLen : 0);

    candidates.push({
      w: variant.written,
      r: variant.pronounced ?? variant.written,
      m: gloss.length > 42 ? gloss.slice(0, 40) + '…' : gloss,
      score,
    });
  }

  return candidates
    .sort((a, b) => a.score - b.score)
    .slice(0, max)
    .map(({ w, r, m }) => ({ w, r, m }));
}

// ── Kanji save / unsave ─────────────────────────────────────────────────────
function getSavedKanjiMap() {
  try { return new Map(JSON.parse(localStorage.getItem('saved_kanjis') || '[]')); }
  catch { return new Map(); }
}
export function getAllSavedKanjis() {
  return [...getSavedKanjiMap().values()]
    .sort((a, b) => b.savedDate.localeCompare(a.savedDate));
}
export function isKanjiSaved(char) {
  return getSavedKanjiMap().has(char);
}
function persistKanjiMap(map) {
  localStorage.setItem('saved_kanjis', JSON.stringify([...map.entries()]));
}
export function toggleSaveKanji(k) {
  const map = getSavedKanjiMap();
  if (map.has(k.kanji)) {
    map.delete(k.kanji);
  } else {
    map.set(k.kanji, {
      kanji: k.kanji, level: k.level, meaning: k.meaning,
      savedDate: new Date().toISOString().slice(0, 10),
    });
  }
  persistKanjiMap(map);
}
export function removeKanjiFromSaved(char) {
  const map = getSavedKanjiMap();
  map.delete(char);
  persistKanjiMap(map);
}

export function removeSelectedKanjis(chars) {
  if (!chars.length) return;
  const map = getSavedKanjiMap();
  chars.forEach(c => map.delete(c));
  persistKanjiMap(map);
}

// ── Kanji level filter ────────────────────────────────────────────────────
export function applyKanjiLevelFilterUI() {
  document.querySelectorAll('.pill').forEach(p => {
    p.classList.toggle('active', p.dataset.level === state.kanjiLevelFilter);
  });
}
export function setKanjiLevel(level) {
  if (state.kanjiLevelFilter === level) return;
  state.kanjiLevelFilter = level;
  localStorage.setItem('kanjiLevelFilter', level);
  if (CLOUD_ENABLED && state._fbUser) cloudUpdate({ kanjiLevel: level });
  applyKanjiLevelFilterUI();
  state.currentKanjiCards = [];
  loadAndRender(state.count, true);
}

// ── Skeleton loaders ──────────────────────────────────────────────────────
export function showSkeletons(n) {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const s = document.createElement('div');
    s.className = 'card skeleton';
    s.style.animationDelay = `${i * 60}ms`;
    s.innerHTML = `
      <div class="skel-big"></div>
      <div style="flex:1">
        <div class="skel-line" style="width:50%"></div>
        <div class="skel-line" style="width:80%"></div>
        <div class="skel-line" style="width:65%"></div>
      </div>`;
    grid.appendChild(s);
  }
}

// ── Card renderer ─────────────────────────────────────────────────────────
export function renderCard(k, delay) {
  const on     = k.on.length  ? k.on.join('　')  : '—';
  const kun    = k.kun.length ? k.kun.join('　') : '—';
  const exHtml = k.ex.length
    ? k.ex.map(e => `
        <div class="example">
          <div class="ex-top">
            <span class="ex-word">${e.w}</span>
            <span class="ex-reading">【${e.r}】</span>
          </div>
          <div class="ex-meaning">${getMeaning(e.w, getLang()) || e.m}</div>
        </div>`).join('')
    : '<div class="example"><div class="ex-meaning">No examples available.</div></div>';

  const saved     = isKanjiSaved(k.kanji);
  const card      = document.createElement('div');
  card.className  = 'card';
  card.style.animationDelay = `${delay}ms`;

  // Build save button as a proper DOM element so the listener is 100% reliable
  const saveBtn = document.createElement('button');
  saveBtn.className = 'kanji-save-btn' + (saved ? ' saved' : '');
  saveBtn.title     = saved ? 'Saved to My List' : 'Save to My List';
  saveBtn.textContent = saved ? '★' : '☆';
  saveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSaveKanji(k);
    const nowSaved = isKanjiSaved(k.kanji);
    saveBtn.textContent = nowSaved ? '★' : '☆';
    saveBtn.classList.toggle('saved', nowSaved);
    saveBtn.title = nowSaved ? 'Saved to My List' : 'Save to My List';
  });
  card.appendChild(saveBtn);

  card.insertAdjacentHTML('beforeend', `
    <div class="card-body">
      <div class="card-top">
        <div class="kanji-char">${k.kanji}</div>
        <div class="card-info">
          <span class="badge badge-${k.level}">${k.level}</span>
          <div class="card-meaning">${k.meaning}</div>
        </div>
      </div>
      <div class="readings">
        <div class="reading-group">
          <span class="reading-label">音読み (On)</span>
          <span class="reading-kana">${on}</span>
        </div>
        <div class="reading-group">
          <span class="reading-label">訓読み (Kun)</span>
          <span class="reading-kana">${kun}</span>
        </div>
      </div>
      <div class="examples-label">Examples</div>
      ${exHtml}
    </div>`);

  return card;
}

// ── Load kanji data without touching the DOM (used by From Kanji mode) ──
export async function ensureKanjiCards() {
  if (state.currentKanjiCards.length > 0) return state.currentKanjiCards;
  if (!state.POOL.length) await buildPool();
  const picks   = pickChars(state.count);
  const results = await Promise.allSettled(
    picks.map(async ({ char, jlptNum }) => {
      const [detail, words] = await Promise.all([getKanjiDetail(char), getWords(char)]);
      return {
        kanji:   char,
        level:   LEVEL_LABEL[jlptNum],
        on:      detail.on_readings  ?? [],
        kun:     detail.kun_readings ?? [],
        meaning: sortGlosses(detail.meanings ?? ['?']).slice(0, 4).join(', '),
        ex:      bestExamples(words, char, 3),
      };
    })
  );
  const cards = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  state.currentKanjiCards = cards;
  return cards;
}

// ── Main kanji loader ─────────────────────────────────────────────────────
// forceNew = true  →  pick a fresh random set (ignores cache)
export async function loadAndRender(n, forceNew = false) {
  // Serve from cache on simple tab switch
  if (!forceNew && state.currentKanjiCards.length > 0) {
    const grid = document.getElementById('grid');
    grid.innerHTML = '';
    state.currentKanjiCards.forEach((k, i) => grid.appendChild(renderCard(k, i * 80)));
    document.getElementById('countLabel').textContent = state.currentKanjiCards.length;
    const unique = new Set(state.POOL.map(p => p.char)).size;
    setStatus('ok', `${unique.toLocaleString()} kanji in database · N3 & N2 favoured`);
    return;
  }

  showSkeletons(n);
  setStatus('loading', '読み込み中…');
  document.getElementById('countLabel').textContent = n;

  try {
    if (!state.POOL.length) await buildPool();
    if (state.currentTab !== 'kanji') return; // tab changed while loading

    const picks   = pickChars(n);
    const results = await Promise.allSettled(
      picks.map(async ({ char, jlptNum }) => {
        const [detail, words] = await Promise.all([getKanjiDetail(char), getWords(char)]);
        return {
          kanji:   char,
          level:   LEVEL_LABEL[jlptNum],
          on:      detail.on_readings  ?? [],
          kun:     detail.kun_readings ?? [],
          meaning: sortGlosses(detail.meanings ?? ['?']).slice(0, 4).join(', '),
          ex:      bestExamples(words, char, 3),
        };
      })
    );

    if (state.currentTab !== 'kanji') return; // tab changed while loading

    const cards = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    state.currentKanjiCards = cards;
    const grid  = document.getElementById('grid');
    grid.innerHTML = '';
    cards.forEach((k, i) => grid.appendChild(renderCard(k, i * 80)));
    document.getElementById('countLabel').textContent = cards.length;

    const unique = new Set(state.POOL.map(p => p.char)).size;
    setStatus('ok', `${unique.toLocaleString()} kanji in database · N3 & N2 favoured`);

  } catch (err) {
    setStatus('error', 'Failed to load — check your internet connection.');
    document.getElementById('grid').innerHTML =
      `<div style="grid-column:1/-1;color:var(--red);padding:24px;font-weight:600">${err.message}</div>`;
  }
}
