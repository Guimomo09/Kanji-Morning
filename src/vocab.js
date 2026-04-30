import { VOCAB_COUNT, LEVEL_LABEL } from './config.js';
import { normMeaning, setStatus, todayStr } from './utils.js';
import { state } from './state.js';
import { getWords, buildPool, pickVocabChars } from './api.js';
import { loadLearnedWords, isLearned, forgetWord } from './learned.js';
import { cloudUpdate } from './cloud.js';
import { loadDailyVocab } from './daily.js';
import { srsLoad, srsSave } from './srs.js';
import { showSkeletons, getAllSavedKanjis } from './kanji.js';

// ── Vocab quality filters ─────────────────────────────────────────────────
function isAllKatakana(str) {
  return str && /^[\u30A0-\u30FF\uFF65-\uFF9F\u30FC\u30FE\u30FF\u309B\u309C]+$/.test(str);
}
function hasNoKanji(str) {
  return str && !/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(str);
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

// ── Build vocab items from API picks ─────────────────────────────────────
export async function buildVocabItems(picks) {
  const TOP_TAGS   = ['news1','ichi1','spec1','nf01','nf02','nf03','nf04','nf05','nf06'];
  const wordLists  = await Promise.allSettled(picks.map(({ char }) => getWords(char)));
  const candidates = [];
  const seenWords  = new Set();

  for (let i = 0; i < picks.length; i++) {
    if (wordLists[i].status !== 'fulfilled') continue;
    const { char, jlptNum } = picks[i];
    const words = wordLists[i].value;

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

      const varPriorities = canonical.priorities || [];
      if (!varPriorities.some(p => TOP_TAGS.includes(p))) continue;

      const score = priorityScore(varPriorities);
      if (score <= 0) continue;

      const wordKey = canonical.written;
      if (seenWords.has(wordKey)) continue;

      const mainGloss = (entry.meanings?.[0]?.glosses?.[0] || '').toLowerCase();
      if (mainGloss.includes('love')            && !/恋|愛/.test(canonical.written))  continue;
      if (mainGloss.includes('emperor')         && !/天皇/.test(canonical.written))   continue;
      if (mainGloss.includes('imperial palace') && !/内/.test(canonical.written))     continue;

      seenWords.add(wordKey);

      const ERA_RE_V = /\b(era|period|epoch)\b.*\(\d{3,4}/i;
      const bestMeaningEntry = entry.meanings?.find(m => !ERA_RE_V.test(m.glosses?.[0] || ''))
                            ?? entry.meanings?.[0];
      const eraEntry = entry.meanings?.find(m => ERA_RE_V.test(m.glosses?.[0] || ''));

      const meaning       = bestMeaningEntry?.glosses?.slice(0, 4).join(', ') || '?';
      const pos           = bestMeaningEntry?.part_of_speech?.slice(0, 2).join(', ') || '';
      const extraMeanings = (entry.meanings?.slice(1, 3) || [])
        .filter(m => m !== bestMeaningEntry && !ERA_RE_V.test(m.glosses?.[0] || ''))
        .map(m => m.glosses?.slice(0, 2).join(', ')).filter(Boolean);
      if (eraEntry) extraMeanings.push(`<span style="font-size:11px;opacity:.6">also: ${eraEntry.glosses?.[0]}</span>`);
      posCategory(bestMeaningEntry?.part_of_speech); // (side-effect free — kept for future use)

      candidates.push({
        score,
        item: {
          word:    wordKey,
          reading: (canonical.pronounced && canonical.pronounced !== canonical.written)
                     ? canonical.pronounced : '',
          meaning, pos, extraMeanings, level: LEVEL_LABEL[jlptNum],
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
    const ERA_RE = /\b(era|period|epoch)\b.*\(\d{3,4}/i;

    for (const entry of words) {
      if (isProperNoun(entry)) continue;
      const variant = (entry.variants || []).find(v =>
        v.written && v.written.includes(k.kanji) && !isAllKatakana(v.written)
      );
      if (!variant) continue;
      if (seenWords.has(variant.written)) continue;
      seenWords.add(variant.written);

      const bestM = entry.meanings?.find(m => !ERA_RE.test(m.glosses?.[0] || '')) ?? entry.meanings?.[0];
      if (!bestM?.glosses?.length) continue;

      group.push({
        score: priorityScore(variant.priorities || []),
        item: {
          word:         variant.written,
          reading:      (variant.pronounced && variant.pronounced !== variant.written) ? variant.pronounced : '',
          meaning:      bestM.glosses.slice(0, 3).join(', '),
          pos:          bestM.part_of_speech?.slice(0, 2).join(', ') || '',
          extraMeanings: [],
          level:        k.level,
          sourceKanji:  k.kanji,
        },
      });
    }

    group.sort((a, b) => b.score - a.score);
    byKanji.set(k.kanji, group.slice(0, 4).map(c => c.item));
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
  const extraDefs = (extraMeanings || [])
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
    <div class="card-body">
      <div class="vocab-header">
        <div class="vocab-word">${word}</div>
        ${reading ? `<div class="vocab-reading">${reading}</div>` : ''}
      </div>
      <div class="vocab-meta">
        <span class="badge badge-${level}">${level}</span>
        ${sourceKanji ? `<span class="source-kanji-tag">${sourceKanji}</span>` : ''}
        ${pos ? `<span class="vocab-pos">${pos}</span>` : ''}
      </div>
      <div class="card-meaning" style="border-top:1px solid var(--border);padding-top:14px;${extraDefs || relatedHtml ? 'margin-bottom:8px' : ''}">
        ${meaning}
      </div>
      ${extraDefs ? `<div>${extraDefs}</div>` : ''}
      ${relatedHtml}
    </div>`;
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
  localStorage.setItem('vocabLevelFilter', level);
  cloudUpdate({ vocabLevel: level });
  applyLevelFilterUI();
  renderVocab(true);
}

// ── My List ───────────────────────────────────────────────────────────────
export function getAllSavedWords() {
  const seen = new Set(), all = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith('vocab_daily_')) continue;
    const date = k.slice(12);
    try {
      const items = JSON.parse(localStorage.getItem(k));
      if (!Array.isArray(items)) continue;
      items.forEach(it => {
        if (!seen.has(it.word)) { seen.add(it.word); all.push({ ...it, savedDate: date }); }
      });
    } catch {}
  }
  all.sort((a, b) => b.savedDate.localeCompare(a.savedDate));
  return all;
}

export function renderMyList() {
  const section = document.getElementById('mylistSection');
  const words   = getAllSavedWords();
  const kanjis  = getAllSavedKanjis();

  let html = '';

  // ── Kanji section ────────────────────────────────────────────────────────
  html += `<div class="mylist-section-title">漢字 · Saved Kanji <span class="mylist-section-count">${kanjis.length}</span></div>`;
  if (!kanjis.length) {
    html += `<div class="mylist-empty-small">No saved kanji yet. Browse <strong>Kanji</strong> and tap ☆ on a card.</div>`;
  } else {
    html += `<div class="kanji-saved-grid">${
      kanjis.map(k => `
        <div class="kanji-saved-chip">
          <button class="kanji-saved-remove" onclick="removeSavedKanji('${k.kanji}')">✕</button>
          <span class="kanji-saved-char">${k.kanji}</span>
          <span class="badge badge-${k.level}">${k.level}</span>
          <div class="kanji-saved-meaning">${k.meaning}</div>
        </div>`).join('')
    }</div>`;
  }

  // ── Words section ────────────────────────────────────────────────────────
  html += `<div class="mylist-section-title" style="margin-top:32px">語彙 · Saved Words <span class="mylist-section-count">${words.length}</span></div>`;
  if (!words.length) {
    html += `<div class="mylist-empty-small">No saved words yet. Browse <strong>Vocabulary</strong> and tap 💾 Save for Quiz.</div>`;
  } else {
    const rows = words.map(it => `
      <tr id="mlrow_${CSS.escape(it.word)}">
        <td>
          <span class="mylist-word">${it.word}</span>
          ${it.reading ? `<span class="mylist-kana">${it.reading}</span>` : ''}
        </td>
        <td>${it.meaning}</td>
        <td><span class="badge badge-${it.level}">${it.level}</span></td>
        <td class="mylist-date">${it.savedDate}</td>
        <td>
          <button class="btn btn-danger" style="padding:4px 10px;font-size:11px"
            onclick="removeFromMyList('${it.word.replace(/'/g, "\\'")}')">✕ Remove</button>
        </td>
      </tr>`).join('');

    html += `
      <div class="mylist-toolbar">
        <input class="mylist-search" type="text" placeholder="Search word or meaning…"
          oninput="filterMyList(this.value)">
        <span class="mylist-count" id="mylistCount">${words.length} word${words.length !== 1 ? 's' : ''}</span>
      </div>
      <table class="mylist-table" id="mylistTable">
        <thead><tr>
          <th>Word</th><th>Meaning</th><th>Level</th><th>Saved</th><th></th>
        </tr></thead>
        <tbody id="mylistBody">${rows}</tbody>
      </table>`;
  }

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
  if (cnt) cnt.textContent = `${visible} word${visible !== 1 ? 's' : ''}`;
}

export function removeFromMyList(word) {
  forgetWord(word);
  // Remove from SRS deck
  const cards = srsLoad();
  if (cards[word]) {
    delete cards[word];
    srsSave(cards);
  }
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith('vocab_daily_')) continue;
    try {
      let items = JSON.parse(localStorage.getItem(k));
      if (!Array.isArray(items)) continue;
      items = items.filter(it => it.word !== word);
      localStorage.setItem(k, JSON.stringify(items));
    } catch {}
  }
  renderMyList();
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
  if (state.vocabFromKanjiMode && state.currentKanjiCards.length > 0) {
    showSkeletons(VOCAB_COUNT);
    setStatus('loading', '読み込み中…');
    document.getElementById('countLabel').textContent = VOCAB_COUNT;
    try {
      const items = await buildVocabFromKanjis(state.currentKanjiCards);
      if (state.currentTab !== 'vocab') return;
      const grid = document.getElementById('grid');
      grid.innerHTML = '';
      items.forEach((item, i) => grid.appendChild(renderVocabCard(item, i * 80)));
      state.currentVocabItems = items;
      document.getElementById('countLabel').textContent = items.length;
      setStatus('ok', `Vocab from ${state.currentKanjiCards.length} kanji \u2014 ${items.length} words`);
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
      if (sb) { sb.textContent = '✓ Saved for Quiz'; sb.classList.add('saved'); sb.disabled = true; }
    } else {
      setStatus('ok', 'Words loaded — tap 💾 Save for Quiz to add to the bi-weekly quiz');
      const sb = document.getElementById('btnSave');
      if (sb) { sb.textContent = '💾 Save for Quiz'; sb.classList.remove('saved'); sb.disabled = false; }
    }
    return;
  }

  const cached = forceNew ? null : loadDailyVocab(today);
  if (cached && cached.length > 0) {
    const grid = document.getElementById('grid');
    grid.innerHTML = '';
    cached.forEach((item, i) => grid.appendChild(renderVocabCard(item, i * 80)));
    state.currentVocabItems = cached;
    document.getElementById('countLabel').textContent = cached.length;
    setStatus('ok', "Today's words — already saved for quiz ✓");
    const sb = document.getElementById('btnSave');
    if (sb) { sb.textContent = '✓ Saved for Quiz'; sb.classList.add('saved'); sb.disabled = true; }
    return;
  }

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
    setStatus('ok', 'Words loaded — tap 💾 Save for Quiz to add to the bi-weekly quiz');
    const saveBtn = document.getElementById('btnSave');
    if (saveBtn) { saveBtn.textContent = '💾 Save for Quiz'; saveBtn.classList.remove('saved'); saveBtn.disabled = false; }

  } catch (err) {
    setStatus('error', 'Failed to load — check your internet connection.');
    document.getElementById('grid').innerHTML =
      `<div style="grid-column:1/-1;color:var(--red);padding:24px;font-weight:600">${err.message}</div>`;
  }
}
