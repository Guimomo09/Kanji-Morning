import { VOCAB_COUNT, LEVEL_LABEL } from './config.js';
import { normMeaning, setStatus, todayStr, sortMeanings, pickBestGloss } from './utils.js';
import { FREQ } from './freq.js';
import { state } from './state.js';
import { getWords, buildPool, pickVocabChars, getKanjiDetail } from './api.js';
import { loadLearnedWords, isLearned, forgetWord } from './learned.js';
import { CLOUD_ENABLED } from './config.js';
import { cloudUpdate, cloudSavedWordAdd, cloudSavedWordRemove } from './cloud.js';
import { loadDailyVocab } from './daily.js';
import { srsLoad, srsSave } from './srs.js';
import { showSkeletons, getAllSavedKanjis, ensureKanjiCards, isKanjiSaved, toggleSaveKanji, SENTENCE_OVERRIDE } from './kanji.js';
import { getMeaning } from './trans.js';
import { getLang, t } from './i18n.js';
import { speakJapanese } from './audio.js';

// ── JLPT level overrides for words misclassified by kanjiapi.dev ─────────

// ── Kanji component helpers ───────────────────────────────────────────────
function _extractKanji(str) {
  return [...str].filter(c => (c >= '\u4E00' && c <= '\u9FFF') || (c >= '\u3400' && c <= '\u4DBF'));
}
export async function _enrichKanjiComponents(card, word) {
  const chars = _extractKanji(word);
  if (!chars.length) return;
  const placeholder = card.querySelector('.vocab-kcomp');
  if (!placeholder) return;
  try {
    const details = await Promise.all(chars.map(c => getKanjiDetail(c).catch(() => null)));
    const cards = chars.map((c, i) => {
      const d = details[i];
      if (!d) return '';
      const on      = (d.on_readings  || []).slice(0, 2).join('、') || '—';
      const kun     = (d.kun_readings || []).slice(0, 2).join('、') || '—';
      const meaning = (d.meanings    || []).slice(0, 2).join(', ') || '?';
      const lvl     = d.jlpt ? LEVEL_LABEL[d.jlpt] || '' : '';
      const saved   = isKanjiSaved(c);
      return `<div class="vkc-card" data-char="${c}">
        <button class="vkc-save${saved ? ' saved' : ''}" title="${saved ? 'Saved' : 'Save to My List'}">${saved ? '★' : '☆'}</button>
        <div class="vkc-char">${c}</div>
        <div class="vkc-meaning">${meaning}${lvl ? ` <span class="vkc-lvl">${lvl}</span>` : ''}</div>
        <div class="vkc-readings"><span class="vkc-r-label">On</span> ${on} · <span class="vkc-r-label">Kun</span> ${kun}</div>
      </div>`;
    }).join('');
    if (!cards.trim()) return;
    // Example sentence: first SENTENCE_OVERRIDE entry for any component kanji
    let sentHtml = '';
    for (const c of chars) {
      const sents = SENTENCE_OVERRIDE[c];
      if (sents?.length) {
        const s = sents[0];
        sentHtml = `<div class="vocab-example">
          <div class="vocab-example-jp">${s.jp}</div>
          <div class="vocab-example-en">${s.en}</div>
        </div>`;
        break;
      }
    }
    const colCount = Math.min(chars.length, 3);
    placeholder.innerHTML = `<div class="vkc-label">Kanji</div><div class="vkc-grid" data-cols="${colCount}">${cards}</div>${sentHtml}`;
    placeholder.querySelectorAll('.vkc-save').forEach(btn => {
      const char = btn.closest('.vkc-card').dataset.char;
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const d = details[chars.indexOf(char)];
        toggleSaveKanji({ kanji: char, level: d?.jlpt ? LEVEL_LABEL[d.jlpt] : '?', meaning: (d?.meanings || [])[0] || '' });
        const nowSaved = isKanjiSaved(char);
        btn.textContent = nowSaved ? '★' : '☆';
        btn.classList.toggle('saved', nowSaved);
        btn.title = nowSaved ? 'Saved' : 'Save to My List';
      });
    });
  } catch { /* silently skip */ }
}
// Key = word (written form), value = correct JLPT number (5=N5, 4=N4, etc.)
const JLPT_OVERRIDES = {
  '夜':4, '朝':5, '昼':5, '夕':4, '春':5, '夏':5, '秋':5, '冬':5,
  '山':5, '川':5, '海':5, '空':5, '花':5, '雨':5, '雪':4, '風':5,
  '木':5, '森':4, '林':4, '石':5, '火':5, '水':5,
  '目':5, '耳':5, '手':5, '足':5, '口':5, '心':5, '体':5, '頭':5,
  '魚':5, '鳥':5, '馬':4, '犬':5, '猫':5,
  '父':5, '母':5, '兄':5, '姉':5, '弟':5, '妹':5, '子':5, '友':5,
  '学':5, '校':5, '先':5, '生':5, '人':5, '男':5, '女':5,
  '今':5, '昨':5, '明':5,
};

// ── Vocab word save helpers ───────────────────────────────────────────────
export function isVocabWordSaved(word) {
  return getAllSavedWords().some(w => w.word === word);
}

export function toggleSaveVocabWord(item) {
  if (isVocabWordSaved(item.word)) {
    removeFromMyList(item.word);
    return false;
  }
  const date = todayStr();
  updateSavedWordsMirror([item], date);
  cloudSavedWordAdd(_compact(item, date)).catch(() => {});
  renderMyList();
  return true;
}

// ── Vocab quality filters ─────────────────────────────────────────────────
function isAllKatakana(str) {
  return str && /^[\u30A0-\u30FF\uFF65-\uFF9F\u30FC\u30FE\u30FF\u309B\u309C]+$/.test(str);
}
function hasNoKanji(str) {
  return str && !/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(str);
}
// Count kanji characters in a string
function kanjiCount(str) {
  return [...(str || '')].filter(c => (c >= '\u4E00' && c <= '\u9FFF') || (c >= '\u3400' && c <= '\u4DBF')).length;
}
// Max kanji allowed in a word for a given JLPT level (lower level = simpler words)
function maxKanjiForLevel(jlptNum) {
  if (jlptNum >= 4) return 2; // N4/N5: 1-2 kanji compounds (店員, 代る, etc.)
  if (jlptNum === 3) return 3; // N3: up to 3 kanji
  return 99;                   // N2/N1: no restriction
}
function priorityScore(priorities) {
  if (!priorities || !priorities.length) return 0;
  let score = 0;
  for (const p of priorities) {
    if      (p === 'news1' || p === 'ichi1' || p === 'spec1') score += 100;
    else if (p === 'news2' || p === 'ichi2' || p === 'spec2') score += 50;
    else if (/^nf0[1-9]$/.test(p))  score += 90;
    else if (/^nf[12]\d$/.test(p))  score += 40;
    else if (/^gai/.test(p))        score -= 60;
    else                            score += 5;
  }
  return score;
}
function isProperNoun(entry) {
  const properTags = /place|proper.?noun|city|country|region|district|prefecture|island|ocean|river|mountain|surname|given.?name|person.?name|organization|company|brand/i;
  if ((entry.meanings || []).some(m => (m.part_of_speech || []).some(p => properTags.test(p)))) return true;
  const allGlosses = (entry.meanings || []).flatMap(m => m.glosses || []);
  return allGlosses.length > 0 && allGlosses.every(g => /^[A-Z]/.test(g.trim()));
}
function posCategory(posArr) {
  if (!posArr || !posArr.length) return 'other';
  const s = posArr.join(' ').toLowerCase();
  if (/verb/.test(s))                           return 'verb';
  if (/adjective|keiyoushi|keiyodoshi/.test(s)) return 'adj';
  if (/noun/.test(s))                           return 'noun';
  return 'other';
}

// ── Frequency cutoff per JLPT level ──────────────────────────────────────
// Words not common enough for a given level are excluded entirely.
// Based on subtitle-corpus ranks (max = 12 000): N5/N4 = daily spoken vocab only.
// N2/N1 capped so words absent from the subtitle corpus (rank 99999) are filtered out —
// this keeps the app focused on real-world, practical vocabulary.
const FREQ_CUTOFF = { 5: 2500, 4: 4500, 3: 9000, 2: 15000, 1: 20000 };

// ── Kanji-level guard ────────────────────────────────────────────────────
// For N5/N4/N3, all kanji in a compound must belong to a level ≤ the seed level.
// Builds a Set of kanji allowed up to and including `jlptNum`.
function buildAllowedKanjiSet(jlptNum) {
  if (jlptNum <= 2) return null; // N2/N1: no restriction
  const allowed = new Set();
  (state.POOL || []).forEach(({ char, jlptNum: lvl }) => {
    if (lvl >= jlptNum) allowed.add(char); // lvl 5=N5, 4=N4 … higher num = easier
  });
  return allowed;
}
function allKanjiAllowed(word, allowedSet) {
  if (!allowedSet) return true;
  for (const ch of word) {
    if ((ch >= '\u4E00' && ch <= '\u9FFF') || (ch >= '\u3400' && ch <= '\u4DBF')) {
      if (!allowedSet.has(ch)) return false;
    }
  }
  return true;
}

// ── Build vocab items from API picks ─────────────────────────────────────
export async function buildVocabItems(picks) {
  const TOP_TAGS   = ['news1','ichi1','spec1','nf01','nf02','nf03','nf04','nf05','nf06'];
  const wordLists  = await Promise.allSettled(picks.map(({ char }) => getWords(char)));
  const candidates = [];
  const seenWords  = new Set();

  // Pre-build allowed kanji sets per level (cached per call)
  const allowedCache = {};

  for (let i = 0; i < picks.length; i++) {
    if (wordLists[i].status !== 'fulfilled') continue;
    const { char, jlptNum } = picks[i];
    const words = wordLists[i].value;

    if (!(jlptNum in allowedCache)) allowedCache[jlptNum] = buildAllowedKanjiSet(jlptNum);
    const allowedSet = allowedCache[jlptNum];

    for (const entry of words) {
      if (isProperNoun(entry)) continue;

      const canonical =
        (entry.variants || []).find(v =>
          v.written && !isAllKatakana(v.written) &&
          (v.priorities || []).some(p => TOP_TAGS.includes(p))
        ) ||
        (entry.variants || []).find(v => v.written && !isAllKatakana(v.written));

      if (!canonical) continue;
      if (!canonical.written.includes(char)) continue;
      if (hasNoKanji(canonical.written)) continue;
      if (kanjiCount(canonical.written) > maxKanjiForLevel(jlptNum)) continue;
      if (!allKanjiAllowed(canonical.written, allowedSet)) continue;

      const varPriorities = canonical.priorities || [];
      if (!varPriorities.some(p => TOP_TAGS.includes(p))) continue;

      const baseScore = priorityScore(varPriorities);
      if (baseScore <= 0) continue;

      const wordKey = canonical.written;
      if (seenWords.has(wordKey)) continue;

      const mainGloss = (entry.meanings?.[0]?.glosses?.[0] || '').toLowerCase();
      if (mainGloss.includes('love')            && !/恋|愛/.test(canonical.written))  continue;
      if (mainGloss.includes('emperor')         && !/天皇/.test(canonical.written))   continue;
      if (mainGloss.includes('imperial palace') && !/内/.test(canonical.written))     continue;

      seenWords.add(wordKey);

      const best = pickBestGloss(entry.meanings || []);
      if (!best) continue;
      const { gloss: bestGloss, meaning: bestMeaningEntry } = best;

      const sortedMeanings = sortMeanings(entry.meanings || []);
      const meaning       = bestMeaningEntry?.glosses?.slice(0, 4).join(', ') || '?';
      const pos           = bestMeaningEntry?.part_of_speech?.slice(0, 2).join(', ') || '';
      const extraMeanings = sortedMeanings
        .filter(m => m !== bestMeaningEntry)
        .slice(0, 2)
        .map(m => m.glosses?.slice(0, 2).join(', ')).filter(Boolean);

      // Frequency boost: subtitle-corpus rank boosts score (lower rank = more common = higher boost)
      const freqRank  = FREQ[wordKey] ?? 99999;

      // Hard cutoff: for N5/N4/N3, skip words not common enough
      if (freqRank > FREQ_CUTOFF[jlptNum]) continue;

      // For N5/N4: frequency dominates — everyday words (食べ物) beat formal dict entries (食物)
      // For N3+: balance frequency and dictionary tags equally
      const freqBonus = jlptNum >= 4
        ? Math.max(0, 2000 - freqRank * 2)   // N5/N4: frequency is king
        : Math.max(0, 600 - freqRank);        // N3/N2/N1: standard balance
      const score     = priorityScore(varPriorities) + freqBonus;
      posCategory(bestMeaningEntry?.part_of_speech); // (side-effect free — kept for future use)

      // If the written form has kanji but the reading is all-katakana, it's bad API data (e.g. 馬車→マーチョ)
      const rawReading = (canonical.pronounced && canonical.pronounced !== canonical.written)
        ? canonical.pronounced : '';
      const reading = (rawReading && !hasNoKanji(wordKey) && isAllKatakana(rawReading))
        ? '' : rawReading;

      candidates.push({
        score,
        item: {
          word:    wordKey,
          reading,
          meaning, pos, extraMeanings,
          level: LEVEL_LABEL[JLPT_OVERRIDES[wordKey] ?? jlptNum],
        },
      });
    }
  }

  const learned = loadLearnedWords();
  const fresh   = candidates.filter(c => !isLearned(c.item, learned));
  const pool    = fresh.length >= VOCAB_COUNT ? fresh : candidates;

  // Shuffle then take VOCAB_COUNT
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const selected = pool.slice(0, VOCAB_COUNT);

  // Find related variants (same concept, different word form)
  for (const sel of selected) {
    const conceptKey = normMeaning(sel.item.meaning);
    const related    = [];
    const seenR      = new Set([sel.item.word]);
    for (const cand of pool) {
      if (normMeaning(cand.item.meaning) === conceptKey && !seenR.has(cand.item.word)) {
        related.push({ word: cand.item.word, pos: cand.item.pos });
        seenR.add(cand.item.word);
      }
    }
    if (related.length > 0) sel.item.related = related;
  }

  return selected.map(c => c.item);
}

// ── Vocab from specific kanji characters ───────────────────────────────────────
export async function buildVocabFromKanjis(kanjiCards) {
  const seenWords = new Set();
  const byKanji   = new Map(); // char → item[]

  for (const k of kanjiCards) {
    const words = await getWords(k.kanji);
    const group = [];

    for (const entry of words) {
      if (isProperNoun(entry)) continue;
      const variant = (entry.variants || []).find(v =>
        v.written && v.written.includes(k.kanji) && !isAllKatakana(v.written)
      );
      if (!variant) continue;
      if (seenWords.has(variant.written)) continue;
      if (hasNoKanji(variant.written)) continue;
      const jlptNum = { N5: 5, N4: 4, N3: 3, N2: 2, N1: 1 }[k.level] ?? 2;
      if (kanjiCount(variant.written) > maxKanjiForLevel(jlptNum)) continue;

      // Hard cutoff: skip words not frequent enough for this level
      const freqRank = FREQ[variant.written] ?? 99999;
      if (freqRank > FREQ_CUTOFF[jlptNum]) continue;

      seenWords.add(variant.written);

      const best = pickBestGloss(entry.meanings || []);
      if (!best) continue;

      const varRawReading = (variant.pronounced && variant.pronounced !== variant.written) ? variant.pronounced : '';
      const varReading = (varRawReading && !hasNoKanji(variant.written) && isAllKatakana(varRawReading))
        ? '' : varRawReading;

      group.push({
        score: priorityScore(variant.priorities || []),
        item: {
          word:         variant.written,
          reading:      varReading,
          meaning:      best.meaning.glosses.slice(0, 3).join(', '),
          pos:          best.meaning.part_of_speech?.slice(0, 2).join(', ') || '',
          extraMeanings: [],
          level:        k.level,
          sourceKanji:  k.kanji,
        },
      });
    }

    group.sort((a, b) => b.score - a.score);
    // Weighted shuffle: take top-8, shuffle, pick 4 — variety on each refresh
    const pool = group.slice(0, 8);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    byKanji.set(k.kanji, pool.slice(0, 4).map(c => c.item));
  }

  // Round-robin across kanji to ensure variety
  const result = [];
  const queues = [...byKanji.values()];
  let i = 0;
  while (result.length < VOCAB_COUNT && queues.some(q => q.length)) {
    const q = queues[i % queues.length];
    if (q.length) result.push(q.shift());
    i++;
  }
  return result;
}

// ── Vocab card renderer ───────────────────────────────────────────────
export function renderVocabCard(item, delay) {
  const { word, reading, meaning, pos, extraMeanings, level, related, sourceKanji } = item;
  // Hide EN extraMeanings when a native translation is available for this word
  const hasTranslation = !!getMeaning(word, getLang());
  const extraDefs = hasTranslation
    ? ''
    : (extraMeanings || [])
        .map(d => `<div class="ex-meaning" style="margin-top:2px">${d}</div>`)
        .join('');

  const relatedHtml = (related && related.length > 0)
    ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:12px;color:var(--muted)">
        <div style="font-weight:600;margin-bottom:4px">Also:</div>
        ${related.map(r => `<div>• <span style="font-weight:700">${r.word}</span> ${r.pos ? `<span style="font-size:10px">(${r.pos})</span>` : ''}</div>`).join('')}
      </div>`
    : '';

  const coverHtml = state.quizMode ? `
    <div class="card-cover" onclick="revealCard(this)">
      <span class="card-cover-text">TAP TO REVEAL</span>
    </div>` : '';

  const card = document.createElement('div');
  card.className = 'card' + (state.quizMode ? ' quiz-card' : '');
  card.style.animationDelay = `${delay}ms`;

  card.innerHTML = `
    ${coverHtml}
    ${!state.quizMode ? `<button class="vocab-save-btn" title="Save to My List">☆</button>` : ''}
    <div class="card-body">
      <div class="vocab-header">
        <div class="vocab-word">${word}</div>
        ${reading ? `<div class="vocab-reading">${reading}</div>` : ''}
        <button class="speak-btn vocab-speak-btn" title="Prononcer">&#x1F50A;</button>
      </div>
      <div class="vocab-meta">
        <span class="badge badge-${level}">${level}</span>
        ${sourceKanji ? `<span class="source-kanji-tag">${sourceKanji}</span>` : ''}
        ${pos ? `<span class="vocab-pos">${pos}</span>` : ''}
      </div>
      <div class="card-meaning" style="border-top:1px solid var(--border);padding-top:14px;${extraDefs || relatedHtml ? 'margin-bottom:8px' : ''}">
        ${getMeaning(word, getLang()) || meaning}
      </div>
      ${extraDefs ? `<div>${extraDefs}</div>` : ''}
      ${relatedHtml}
      <div class="vocab-kcomp"></div>
    </div>`;
  card.querySelector('.vocab-speak-btn')
      ?.addEventListener('click', (e) => { e.stopPropagation(); speakJapanese(reading || word); });
  const saveBtn = card.querySelector('.vocab-save-btn');
  if (saveBtn) {
    const initSaved = isVocabWordSaved(word);
    saveBtn.textContent = initSaved ? '★' : '☆';
    saveBtn.classList.toggle('saved', initSaved);
    saveBtn.addEventListener('click', e => {
      e.stopPropagation();
      const nowSaved = toggleSaveVocabWord(item);
      saveBtn.textContent = nowSaved ? '★' : '☆';
      saveBtn.classList.toggle('saved', nowSaved);
    });
  }
  if (!state.quizMode) {
    card.style.cursor = 'pointer';
    card.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      window.openVocabDetail?.(item);
    });
  }
  _enrichKanjiComponents(card, word);
  return card;
}

// ── Level filter UI ───────────────────────────────────────────────────────
export function applyLevelFilterUI() {
  document.querySelectorAll('.pill').forEach(p => {
    p.classList.toggle('active', p.dataset.level === state.vocabLevelFilter);
  });
}
export function setVocabLevel(level) {
  if (state.vocabLevelFilter === level) return;
  state.vocabLevelFilter = level;
  // (not persisted to localStorage — always starts fresh)
  cloudUpdate({ vocabLevel: level });
  applyLevelFilterUI();
  renderVocab(true);
}

// ── My List — km_saved_words mirror ────────────────────────────────────────
// A compact, dedicated key that survives localStorage eviction of vocab_daily_* keys.
const _SW_KEY = 'km_saved_words';
function _compact(it, date) {
  return { word: it.word, reading: it.reading || '', meaning: it.meaning || '',
           level: it.level || '', pos: it.pos || '', savedDate: it.savedDate || date };
}
export function rebuildSavedWordsMirror() {
  // Scan vocab_daily_* and MERGE into existing km_saved_words (don't overwrite)
  // This preserves any words already in the mirror from cloud pull (savedWords)
  let existing = [];
  try {
    const raw = localStorage.getItem(_SW_KEY);
    if (raw) existing = JSON.parse(raw);
  } catch {}
  const seen = new Set(existing.map(i => i.word));
  const newFromDaily = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith('vocab_daily_')) continue;
    const date = k.slice(12);
    try {
      const items = JSON.parse(localStorage.getItem(k));
      if (!Array.isArray(items)) continue;
      items.forEach(it => { if (!seen.has(it.word)) { seen.add(it.word); newFromDaily.push(_compact(it, date)); } });
    } catch {}
  }
  const all = [...newFromDaily, ...existing];
  all.sort((a, b) => (b.savedDate || '').localeCompare(a.savedDate || ''));
  try { localStorage.setItem(_SW_KEY, JSON.stringify(all)); } catch {}
  return all;
}
export function updateSavedWordsMirror(items, date) {
  try {
    const raw = localStorage.getItem(_SW_KEY);
    const existing = raw ? JSON.parse(raw) : [];
    const seen = new Set(existing.map(i => i.word));
    const newItems = items.filter(i => !seen.has(i.word)).map(i => _compact(i, date));
    if (!newItems.length) return;
    const updated = [...newItems, ...existing];
    try { localStorage.setItem(_SW_KEY, JSON.stringify(updated)); }
    catch {
      try {
        const qh = JSON.parse(localStorage.getItem('quiz_history') || '[]');
        if (qh.length > 10) localStorage.setItem('quiz_history', JSON.stringify(qh.slice(-10)));
        localStorage.setItem(_SW_KEY, JSON.stringify(updated));
      } catch {}
    }
    // Sync to cloud — atomic add, one call per new word (never overwrites full list)
    if (CLOUD_ENABLED && state._fbUser) {
      newItems.forEach(w => cloudSavedWordAdd(w).catch(() => {}));
    }
  } catch {}
}
export function removeFromSavedWordsMirror(wordOrSet) {
  try {
    const raw = localStorage.getItem(_SW_KEY); if (!raw) return;
    const isSet = wordOrSet instanceof Set;
    const filtered = JSON.parse(raw).filter(i => isSet ? !wordOrSet.has(i.word) : i.word !== wordOrSet);
    localStorage.setItem(_SW_KEY, JSON.stringify(filtered));
    // Sync removal to cloud — atomic remove (never overwrites full list)
    if (CLOUD_ENABLED && state._fbUser) {
      cloudSavedWordRemove(wordOrSet).catch(() => {});
    }
  } catch {}
}

// ── My List ───────────────────────────────────────────────────────────────
export function getAllSavedWords() {
  // Try compact mirror first (immune to vocab_daily_* eviction)
  try {
    const raw = localStorage.getItem(_SW_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  // Fall back: scan vocab_daily_* and rebuild mirror
  return rebuildSavedWordsMirror();
}

export function renderMyList() {
  const section = document.getElementById('mylistSection');
  const words   = getAllSavedWords();
  const kanjis  = getAllSavedKanjis();

  // ── Full empty state (first visit) ────────────────────────────────────
  if (!kanjis.length && !words.length) {
    section.innerHTML = `
      <div class="mylist-full-empty">
        <div class="mylist-full-empty-icon">📋</div>
        <div class="mylist-full-empty-title">${t('ml_empty_title')}</div>
        <div class="mylist-full-empty-body">${t('ml_empty_body')}</div>
        <div class="mylist-full-empty-actions">
          <button class="btn btn-primary" onclick="switchTab('kanji')">${t('ml_browse_kanji')}</button>
          <button class="btn btn-ghost" onclick="switchTab('vocab')">${t('ml_browse_vocab')}</button>
        </div>
      </div>`;
    return;
  }

  // ── Filter helpers ───────────────────────────────────────────────────────
  const kanjiFilter = state.mylistKanjiFilter || 'all';
  const wordFilter  = state.mylistWordFilter  || 'all';
  const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];
  const LEVEL_ATTR = { all: 'all', N5: '5', N4: '4', N3: '3', N2: '2', N1: '1' };

  function filterPills(activeLevel, setter) {
    return `<div class="ml-filter-bar">
      <button class="pill${activeLevel === 'all' ? ' active' : ''}" data-level="all" onclick="${setter}('all')">${t('filter_all')}</button>
      ${LEVELS.map(l => `<button class="pill${activeLevel === l ? ' active' : ''}" data-level="${LEVEL_ATTR[l]}" onclick="${setter}('${l}')">${l}</button>`).join('')}
    </div>`;
  }

  function applyFilter(arr, filter) {
    return filter === 'all' ? arr : arr.filter(it => it.level === filter);
  }

  let html = '';

  // ── Kanji section ────────────────────────────────────────────────────────
  const filteredKanjis = applyFilter(kanjis, kanjiFilter);
  const kanjiCountLabel = kanjiFilter === 'all' ? kanjis.length : `${filteredKanjis.length}<span style="font-weight:400;color:var(--muted)">/${kanjis.length}</span>`;
  html += `<div class="mylist-section-title">${t('ml_section_kanji')} <span class="mylist-section-count">${kanjiCountLabel}</span></div>`;
  html += filterPills(kanjiFilter, 'setMyListKanjiFilter');
  if (!kanjis.length) {
    html += `<div class="mylist-empty-small">${t('ml_no_kanji')}</div>`;
  } else {
    html += `
      <div class="ml-select-toolbar">
        <button class="btn btn-ghost" id="mlKanjiSelectBtn" style="font-size:12px;padding:4px 12px" onclick="toggleSelectMode()">Select</button>
        <button class="btn btn-ghost" id="mlKanjiSelectAll" style="font-size:12px;padding:4px 12px;display:none" onclick="selectAllKanjis()">☑ All</button>
      </div>`;
    html += `<div class="kanji-saved-grid">${
      filteredKanjis.map((k, idx) => `
        <div class="kanji-saved-chip" data-kanji="${k.kanji}" data-index="${idx}" onclick="handleKanjiChipClick(this,'${k.kanji}',event)">
          <span class="kanji-saved-char">${k.kanji}</span>
          <span class="badge badge-${k.level}">${k.level}</span>
          <div class="kanji-saved-meaning">${k.meaning}</div>
          <div class="kanji-chip-check" onclick="event.stopPropagation(); toggleKanjiSelect(this.closest('.kanji-saved-chip'), event)">✓</div>
        </div>`).join('')
    }</div>`;
    if (!filteredKanjis.length) html += `<div class="mylist-empty-small" style="margin-top:-4px">${kanjiFilter} — aucun kanji sauvegardé</div>`;
  }

  // ── Words section ────────────────────────────────────────────────────────
  const filteredWords = applyFilter(words, wordFilter);
  const wordCountLabel = wordFilter === 'all' ? words.length : `${filteredWords.length}<span style="font-weight:400;color:var(--muted)">/${words.length}</span>`;
  html += `<div class="mylist-section-title" style="margin-top:32px">${t('ml_section_words')} <span class="mylist-section-count">${wordCountLabel}</span></div>`;
  html += filterPills(wordFilter, 'setMyListWordFilter');
  if (!words.length) {
    html += `<div class="mylist-empty-small">${t('ml_no_words')}</div>`;
  } else {
    // Soft paywall warning at 24+ words (hidden for premium users)
    const FREE_LIMIT = 30;
    if (words.length >= 24 && !state.isPremium) {
      const remaining = FREE_LIMIT - words.length;
      const isAtLimit = remaining <= 0;
      html += `
        <div class="paywall-hint${isAtLimit ? ' paywall-hint--full' : ''}">
          ${isAtLimit
            ? `${t('upgrade_limit_msg')}<br>${t('ml_upgrade_note')}`
            : t('ml_paywall_warn')(words.length, FREE_LIMIT, remaining)
          }
          <button class="btn btn-primary" style="margin-top:10px;font-size:13px;padding:6px 16px" onclick="switchTab('stats')">
            ${t('ml_upgrade_btn')}
          </button>
        </div>`;
    }

    const rows = filteredWords.map((it, idx) => `
      <tr id="mlrow_${CSS.escape(it.word)}" data-word="${it.word.replace(/"/g, '&quot;')}" data-index="${idx}" onclick="handleWordRowClick(this,event)">
        <td style="width:28px;text-align:center">
          <span class="ml-check-icon">✓</span>
        </td>
        <td class="ml-col-word">
          <span class="mylist-word">${it.word}</span>
          ${it.reading ? `<span class="mylist-kana">${it.reading}</span>` : ''}
        </td>
        <td class="ml-col-meaning">${getMeaning(it.word, getLang()) || it.meaning}</td>
        <td><span class="badge badge-${it.level}">${it.level}</span></td>
      </tr>`).join('');

    html += `
      <div class="mylist-toolbar">
        <div class="ml-select-toolbar" style="margin-bottom:0">
          <button class="btn btn-ghost" id="mlWordSelectBtn" style="font-size:12px;padding:4px 12px" onclick="toggleSelectMode()">Select</button>
          <button class="btn btn-ghost" id="mlWordSelectAll" style="font-size:12px;padding:4px 12px;display:none" onclick="selectAllWords()">☑ All</button>
          <span class="ml-longpress-hint">${t('ml_longpress')}</span>
        </div>
        <input class="mylist-search" type="text" placeholder="${t('ml_search')}"
          oninput="filterMyList(this.value)">
        <span class="mylist-count" id="mylistCount">${t('home_words')(filteredWords.length)}${wordFilter !== 'all' ? ` / ${t('home_words')(words.length)}` : ''}</span>
      </div>
      <table class="mylist-table" id="mylistTable">
        <thead><tr>
          <th style="width:28px"></th>
          <th>${t('ml_col_word')}</th><th>${t('ml_col_meaning')}</th><th style="width:52px">${t('ml_col_level')}</th>
        </tr></thead>
        <tbody id="mylistBody">${rows || `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:20px">${wordFilter} — aucun mot sauvegardé</td></tr>`}</tbody>
      </table>`;
  }

  // ── Floating delete bar ──────────────────────────────────────────────────
  html += `
    <div class="ml-delete-bar" id="mlDeleteBar">
      <span id="mlDeleteCount">${t('ml_n_selected')(0)}</span>
      <button class="btn btn-danger" style="padding:6px 16px;font-size:13px" onclick="deleteSelected()">${t('ml_delete_btn')}</button>
      <button class="btn btn-ghost"  style="padding:6px 14px;font-size:13px" onclick="clearSelection()">${t('ml_cancel')}</button>
    </div>`;

  section.innerHTML = html;
}

export function filterMyList(q) {
  const term    = q.trim().toLowerCase();
  const rows    = document.querySelectorAll('#mylistBody tr');
  let   visible = 0;
  rows.forEach(tr => {
    const show = !term || tr.textContent.toLowerCase().includes(term);
    tr.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  const cnt = document.getElementById('mylistCount');
  if (cnt) cnt.textContent = t('home_words')(visible);
}

export function setMyListKanjiFilter(level) {
  state.mylistKanjiFilter = level;
  renderMyList();
}

export function setMyListWordFilter(level) {
  state.mylistWordFilter = level;
  renderMyList();
}

export function toggleMyListSort() {
  // kept for backwards compat — no-op now
}

export function removeFromMyList(word) {
  forgetWord(word);
  // Remove from SRS deck
  const cards = srsLoad();
  if (cards[word]) {
    delete cards[word];
    srsSave(cards);
  }
  // Remove from all vocab_daily_* and collect updated lists for cloud sync
  const cloudPatch = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith('vocab_daily_')) continue;
    try {
      let items = JSON.parse(localStorage.getItem(k));
      if (!Array.isArray(items)) continue;
      const filtered = items.filter(it => it.word !== word);
      if (filtered.length !== items.length) {
        localStorage.setItem(k, JSON.stringify(filtered));
        cloudPatch[k.slice(12)] = filtered; // date → items
      }
    } catch {}
  }
  // Push deletions to cloud so they don't come back after re-login
  if (CLOUD_ENABLED && state._fbUser && Object.keys(cloudPatch).length) {
    cloudUpdate({ dailyWords: cloudPatch });
  }
  removeFromSavedWordsMirror(word);
  renderMyList();
}

// ── Batch delete helpers ─────────────────────────────────────────────────
export function removeSelectedWords(words) {
  if (!words.length) return;
  // Evict from memory + SRS for all words first
  const cards = srsLoad();
  words.forEach(word => {
    forgetWord(word);
    if (cards[word]) delete cards[word];
  });
  srsSave(cards);
  // Remove from all vocab_daily_* with a single pass, collecting cloud patch
  const wordSet = new Set(words);
  const cloudPatch = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith('vocab_daily_')) continue;
    try {
      let items = JSON.parse(localStorage.getItem(k));
      if (!Array.isArray(items)) continue;
      const filtered = items.filter(it => !wordSet.has(it.word));
      if (filtered.length !== items.length) {
        localStorage.setItem(k, JSON.stringify(filtered));
        cloudPatch[k.slice(12)] = filtered;
      }
    } catch {}
  }
  if (CLOUD_ENABLED && state._fbUser && Object.keys(cloudPatch).length) {
    cloudUpdate({ dailyWords: cloudPatch });
  }
  removeFromSavedWordsMirror(wordSet);
}

export function toggleFromKanji() {
  state.vocabFromKanjiMode = !state.vocabFromKanjiMode;
  const btn = document.getElementById('btnFromKanji');
  if (btn) btn.classList.toggle('active', state.vocabFromKanjiMode);
  renderVocab(true);
}

// ── Vocab render entry-point ────────────────────────────────────────────
export async function renderVocab(forceNew = false) {
  if (state.quizState) return; // quiz in progress — don't overwrite grid
  const today = todayStr();

  // ── From Kanji mode ───────────────────────────────────────────────────
  // Use the kanjis currently displayed in the Kanji tab (loads them if not yet visited)
  if (state.vocabFromKanjiMode) {
    showSkeletons(VOCAB_COUNT);
    setStatus('loading', '読み込み中…');
    document.getElementById('countLabel').textContent = VOCAB_COUNT;
    try {
      const kanjiCards = await ensureKanjiCards();
      if (state.currentTab !== 'vocab') return;
      const items = await buildVocabFromKanjis(kanjiCards);
      if (state.currentTab !== 'vocab') return;
      const grid = document.getElementById('grid');
      grid.innerHTML = '';
      items.forEach((item, i) => grid.appendChild(renderVocabCard(item, i * 80)));
      state.currentVocabItems = items;
      document.getElementById('countLabel').textContent = items.length;
      setStatus('ok', `Vocab from ${kanjiCards.length} kanji \u2014 ${items.length} words`);
      const sb = document.getElementById('btnSave');
      if (sb) { sb.textContent = '💾 Save for Quiz'; sb.classList.remove('saved'); sb.disabled = false; }
    } catch (err) {
      setStatus('error', 'Failed to load — check your internet connection.');
      document.getElementById('grid').innerHTML =
        `<div style="grid-column:1/-1;color:var(--red);padding:24px;font-weight:600">${err.message}</div>`;
    }
    return;
  }

  if (!forceNew && state.currentVocabItems.length > 0) {
    const grid = document.getElementById('grid');
    grid.innerHTML = '';
    state.currentVocabItems.forEach((item, i) => grid.appendChild(renderVocabCard(item, i * 80)));
    document.getElementById('countLabel').textContent = state.currentVocabItems.length;
    const savedToday = loadDailyVocab(today);
    if (savedToday && savedToday.length > 0) {
      setStatus('ok', "Today's words — already saved for quiz ✓");
      const sb = document.getElementById('btnSave');
      if (sb) { sb.textContent = '✓ Saved for Quiz'; sb.classList.add('saved'); sb.disabled = false; }
    } else {
      setStatus('ok', 'Words loaded — tap 💾 Save for Quiz to add to the Weekly Challenge');
      const sb = document.getElementById('btnSave');
      if (sb) { sb.textContent = '💾 Save for Quiz'; sb.classList.remove('saved'); sb.disabled = false; }
    }
    return;
  }

  const cached = forceNew ? null : loadDailyVocab(today);
  // Don't auto-load cached daily words as main display — always generate fresh words.
  // (Saved words live in My List. Vocab tab = discovery.)
  // We only use `cached` below to set the button state after generation.

  showSkeletons(VOCAB_COUNT);
  setStatus('loading', '読み込み中…');
  document.getElementById('countLabel').textContent = VOCAB_COUNT;

  try {
    if (!state.VOCAB_POOL.length) await buildPool();
    if (state.currentTab !== 'vocab') return; // tab changed while loading
    const picks = pickVocabChars(VOCAB_COUNT * 5);
    const items = (await buildVocabItems(picks)).slice(0, VOCAB_COUNT);
    if (state.currentTab !== 'vocab') return; // tab changed while loading

    const grid = document.getElementById('grid');
    grid.innerHTML = '';
    items.forEach((item, i) => grid.appendChild(renderVocabCard(item, i * 80)));
    state.currentVocabItems = items;
    document.getElementById('countLabel').textContent = items.length;
    setStatus('ok', 'Words loaded — tap 💾 Save for Quiz to add to the Weekly Challenge');
    const saveBtn = document.getElementById('btnSave');
    if (saveBtn) { saveBtn.textContent = '💾 Save for Quiz'; saveBtn.classList.remove('saved'); saveBtn.disabled = false; }

  } catch (err) {
    setStatus('error', 'Failed to load — check your internet connection.');
    document.getElementById('grid').innerHTML =
      `<div style="grid-column:1/-1;color:var(--red);padding:24px;font-weight:600">${err.message}</div>`;
  }
}


