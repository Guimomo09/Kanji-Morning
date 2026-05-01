import { state } from './state.js';
import { todayStr, setStatus } from './utils.js';
import { CLOUD_ENABLED } from './config.js';
import { cloudSignIn, cloudUpdate } from './cloud.js';
import { saveDailyVocab } from './daily.js';
import { srsAddWords, srsUpdateReviewCount } from './srs.js';
import { renderVocab, applyLevelFilterUI, renderMyList } from './vocab.js';
import { renderHome, renderStats } from './stats.js';
import { loadAndRender, applyKanjiLevelFilterUI, getAllSavedKanjis } from './kanji.js';
import { updateBiWeeklyBtn } from './biweekly.js';

// ── Header greeting ───────────────────────────────────────────────────────
export function setHeader() {
  const now  = new Date();
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const mons = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
  document.getElementById('hDate').textContent =
    `${days[now.getDay()]}, ${mons[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
  const h = now.getHours();
  document.getElementById('hGreet').textContent =
    h < 12 ? 'おはようございます！Good morning!'
  : h < 18 ? 'こんにちは！Good afternoon!'
  :           'こんばんは！Good evening!';
}

// ── Tab switcher ──────────────────────────────────────────────────────────
export function switchTab(tab) {
  state.currentTab = tab;
  document.getElementById('tabHome')  .classList.toggle('active', tab === 'home');
  document.getElementById('tabKanji') .classList.toggle('active', tab === 'kanji');
  document.getElementById('tabVocab') .classList.toggle('active', tab === 'vocab');
  document.getElementById('tabMyList').classList.toggle('active', tab === 'mylist');
  document.getElementById('tabStats') .classList.toggle('active', tab === 'stats');

  const isHome   = tab === 'home';
  const isStats  = tab === 'stats';
  const isMyList = tab === 'mylist';
  const isHidden = isStats || isMyList || isHome;

  document.getElementById('homeSection').style.display   = isHome   ? 'flex'  : 'none';
  document.getElementById('grid').style.display          = isHidden ? 'none' : '';
  document.getElementById('statsSection').style.display  = isStats  ? 'block' : 'none';
  document.getElementById('mylistSection').style.display = isMyList ? 'block' : 'none';
  document.getElementById('levelFilter').style.display   = isHidden ? 'none' : '';
  document.getElementById('legendDiv').style.display     = isHidden ? 'none' : '';

  if (isHidden) {
    // Show toolbar but only with Bi-Weekly + Review buttons
    document.getElementById('btnRefresh').style.display      = 'none';
    document.getElementById('btnMore').style.display         = 'none';
    document.getElementById('btnLess').style.display         = 'none';
    document.getElementById('btnSave').style.display         = 'none';
    document.getElementById('quizBtn').style.display         = 'none';
    document.getElementById('btnDailyQuiz').style.display    = 'none';
    document.getElementById('btnFromKanji').style.display    = 'none';
    document.getElementById('btnExam').style.display         = 'none';
    updateBiWeeklyBtn();
    srsUpdateReviewCount();
  }

  if (isHome) {
    document.getElementById('hTitle').textContent = '朝の漢字';
    document.getElementById('hSub').textContent   = 'Morning Kanji · Daily Study';
    renderHome();
    return;
  }
  if (isStats) {
    document.getElementById('hTitle').textContent = '進歩';
    document.getElementById('hSub').textContent   = 'Progression · Score Tracking';
    renderStats();
    return;
  }
  if (isMyList) {
    document.getElementById('btnExam').style.display         = '';
    document.getElementById('hTitle').textContent = '単語リスト';
    document.getElementById('hSub').textContent   = 'My Word List · All Saved Vocabulary';
    renderMyList();
    return;
  }

  document.getElementById('hTitle').textContent = tab === 'kanji' ? '朝の漢字' : '朝の語彙';
  document.getElementById('hSub').textContent   = tab === 'kanji'
    ? 'Morning Kanji · Daily Study' : 'Morning Vocabulary · Daily Study';
  document.getElementById('tabLabel').textContent = tab === 'kanji' ? 'kanji' : 'vocabulary';

  // Reset quiz state
  state.quizMode  = false;
  state.quizState = null;
  const hint = document.getElementById('quizHint');
  if (hint) hint.style.display = 'none';

  if (tab === 'kanji') {
    document.getElementById('btnRefresh').style.display      = '';
    document.getElementById('btnSave').style.display         = 'none';
    document.getElementById('quizBtn').style.display         = '';
    document.getElementById('btnDailyQuiz').style.display    = 'none';
    document.getElementById('btnBiweeklyQuiz').style.display = 'none';
    document.getElementById('btnFromKanji').style.display    = 'none';
    document.getElementById('btnExam').style.display         = 'none';
    document.getElementById('btnMore').style.display         = '';
    document.getElementById('btnLess').style.display         = '';
    applyKanjiLevelFilterUI();
    const qb = document.getElementById('quizBtn');
    qb.classList.remove('active');
    qb.textContent = '試 Quiz Mode';
    loadAndRender(state.count);
    return;
  }

  // Vocab tab
  document.getElementById('btnRefresh').style.display       = '';
  document.getElementById('btnMore').style.display          = 'none';
  document.getElementById('btnLess').style.display          = 'none';
  document.getElementById('quizBtn').style.display          = 'none';
  document.getElementById('btnSave').style.display          = '';
  document.getElementById('levelFilter').style.display      = '';
  document.getElementById('btnDailyQuiz').style.display     = '';
  document.getElementById('btnExam').style.display          = 'none';
  document.getElementById('btnBiweeklyQuiz').style.display  = 'none';
  document.getElementById('btnSave').classList.remove('saved');
  document.getElementById('btnSave').textContent            = '💾 Save for Quiz';
  document.getElementById('btnSave').disabled               = false;
  applyLevelFilterUI();
  document.getElementById('btnFromKanji').style.display = '';
  document.getElementById('btnFromKanji').classList.toggle('active', state.vocabFromKanjiMode);
  updateBiWeeklyBtn();
  renderVocab();
}

// ── Save today's words ────────────────────────────────────────────────────
export function saveToday() {
  if (!state.currentVocabItems.length) return;

  if (CLOUD_ENABLED && !state._fbUser) {
    const go = confirm(
      '⚠️ You are not signed in.\n\nYour words will be saved locally but could be lost if you clear your browser cache.\n\nSign in to keep your words safe on any device.\n\nClick OK to sign in first, or Cancel to save locally.'
    );
    if (go) { cloudSignIn(); return; }
  }

  const btn = document.getElementById('btnSave');
  const itemsToSave = state.currentVocabItems.map(item => ({
    word: item.word, reading: item.reading,
    meaning: item.meaning, pos: item.pos, level: item.level,
  }));

  saveDailyVocab(todayStr(), itemsToSave);
  btn.textContent = state._fbUser ? '☁️ Saved!' : '✓ Saved!';
  btn.classList.add('saved');
  btn.disabled = true;

  const added = srsAddWords(itemsToSave);
  if (added > 0) {
    console.log(`[SRS] ${added} new card${added !== 1 ? 's' : ''} added to review deck.`);
    srsUpdateReviewCount();
  }

  setTimeout(() => {
    btn.textContent = '💾 Save for Quiz';
    btn.classList.remove('saved');
    btn.disabled = false;
  }, 2000);
}

// ── Refresh (new selection) ───────────────────────────────────────────────
export function refresh() {
  if (state.currentTab === 'kanji') { loadAndRender(state.count, true); return; }
  renderVocab(true);
}

// ── Count +/− (kanji tab only) ────────────────────────────────────────────
export function changeCount(delta) {
  if (state.currentTab === 'vocab') return;
  state.count = Math.max(5, Math.min(10, state.count + delta));
  loadAndRender(state.count, true);
}

// ── Quiz mode toggle (kanji tab) ──────────────────────────────────────────
export function toggleQuiz() {
  state.quizMode = !state.quizMode;
  const btn = document.getElementById('quizBtn');
  btn.classList.toggle('active', state.quizMode);
  btn.textContent = state.quizMode ? '📖 Study Mode' : '🎯 Quiz Mode';

  const existingCards = document.querySelectorAll('#grid .card');
  existingCards.forEach(card => {
    const hasCover = card.querySelector('.card-cover');
    if (state.quizMode && !hasCover) {
      const cover = document.createElement('div');
      cover.className = 'card-cover';
      cover.innerHTML = '<span class="card-cover-text">TAP TO REVEAL</span>';
      cover.addEventListener('click', () => revealCard(cover));
      card.classList.add('quiz-card');
      card.prepend(cover);
    } else if (!state.quizMode && hasCover) {
      hasCover.remove();
      card.classList.remove('quiz-card');
    }
  });

  if (state.quizMode) {
    let hint = document.getElementById('quizHint');
    if (!hint) {
      hint = document.createElement('p');
      hint.id        = 'quizHint';
      hint.className = 'quiz-hint';
      hint.textContent = 'Tap a card to reveal readings & examples';
      document.getElementById('grid').after(hint);
    }
    hint.style.display = '';
  } else {
    const hint = document.getElementById('quizHint');
    if (hint) hint.style.display = 'none';
  }
}

export function revealCard(coverEl) {
  coverEl.classList.add('revealed');
}
