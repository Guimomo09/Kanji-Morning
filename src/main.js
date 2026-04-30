import { state }                                               from './state.js';
import { cleanupOldData }                                       from './daily.js';
import { initCloud, setPostAuthCallback, cloudSignIn, cloudSignOut } from './cloud.js';
import { srsUpdateReviewCount, launchSrsReview, _startSrsSession, rateSrsCard } from './srs.js';
import { switchTab, saveToday, refresh, changeCount, toggleQuiz, revealCard, setHeader } from './ui.js';
import { setVocabLevel, renderVocab, renderMyList, filterMyList, removeFromMyList, removeSelectedWords, toggleFromKanji } from './vocab.js';
import { renderStats, renderHome }                              from './stats.js';
import { launchDailyQuiz, launchBiWeeklyQuiz, handleQuizAnswer } from './quiz.js';
import { setKanjiLevel, removeKanjiFromSaved, removeSelectedKanjis } from './kanji.js';

// ── Expose all functions called by inline onclick handlers ────────────────
Object.assign(window, {
  // Navigation
  switchTab,

  // Toolbar controls
  refresh,
  changeCount,
  saveToday,
  toggleQuiz,
  revealCard,

  // Vocab
  setVocabLevel,
  filterMyList,
  removeFromMyList,
  toggleFromKanji,

  // Level pills (shared between kanji and vocab tabs)
  setLevel(level) {
    if (state.currentTab === 'kanji') setKanjiLevel(level);
    else setVocabLevel(level);
  },

  // Kanji save / remove
  removeSavedKanji(char) {
    removeKanjiFromSaved(char);
    renderMyList();
  },

  // My List multi-select
  toggleKanjiSelect(chip) {
    chip.classList.toggle('selected');
    _updateDeleteBar();
  },
  toggleWordSelect(row) {
    row.classList.toggle('selected');
    _updateDeleteBar();
  },
  deleteSelected() {
    const kanjis = [...document.querySelectorAll('.kanji-saved-chip.selected')]
      .map(el => el.dataset.kanji).filter(Boolean);
    const words  = [...document.querySelectorAll('#mylistBody tr.selected')]
      .map(el => el.dataset.word).filter(Boolean);
    if (kanjis.length) { removeSelectedKanjis(kanjis); }
    if (words.length)  { removeSelectedWords(words); }
    renderMyList();
  },
  clearSelection() {
    document.querySelectorAll('.kanji-saved-chip.selected, #mylistBody tr.selected')
      .forEach(el => el.classList.remove('selected'));
    _updateDeleteBar();
  },

  // Quiz
  launchDailyQuiz,
  launchBiWeeklyQuiz,
  handleQuizAnswer,

  // SRS
  launchSrsReview,
  _startSrsSession,
  rateSrsCard,

  // Cloud auth
  cloudSignIn,
  cloudSignOut,

  // Quiz result screen wrappers
  resetAndBack()  { state.quizState = null; switchTab('vocab'); },
  resetAndStats() { state.quizState = null; switchTab('stats'); },
});

// ── Delete-bar helper ─────────────────────────────────────────────────────
function _updateDeleteBar() {
  const bar    = document.getElementById('mlDeleteBar');
  const count  = document.getElementById('mlDeleteCount');
  if (!bar) return;
  const n = document.querySelectorAll('.kanji-saved-chip.selected, #mylistBody tr.selected').length;
  if (n > 0) {
    count.textContent = `${n} selected`;
    bar.classList.add('visible');
  } else {
    bar.classList.remove('visible');
  }
}

// ── App initialisation ────────────────────────────────────────────────────
setHeader();
cleanupOldData();

// Re-render current tab after cloud login so pulled data is reflected
setPostAuthCallback(() => {
  if      (state.currentTab === 'vocab')  renderVocab();
  else if (state.currentTab === 'mylist') renderMyList();
  else if (state.currentTab === 'stats')  renderStats();
  else if (state.currentTab === 'home')   renderHome();
});

initCloud();
srsUpdateReviewCount();
switchTab('home');

// ── PWA service worker ────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .catch(err => console.warn('[SW] Registration failed:', err));
  });
}
