import { state }                                               from './state.js';
import { cleanupOldData }                                       from './daily.js';
import { initCloud, setPostAuthCallback, cloudSignIn, cloudSignOut } from './cloud.js';
import { srsUpdateReviewCount, launchSrsReview, _startSrsSession, rateSrsCard } from './srs.js';
import { switchTab, saveToday, refresh, changeCount, toggleQuiz, revealCard, setHeader } from './ui.js';
import { setVocabLevel, renderVocab, renderMyList, filterMyList, removeFromMyList, toggleFromKanji } from './vocab.js';
import { renderStats, renderHome }                              from './stats.js';
import { launchDailyQuiz, launchBiWeeklyQuiz, handleQuizAnswer } from './quiz.js';
import { setKanjiLevel, removeKanjiFromSaved }                  from './kanji.js';

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

  // Kanji save
  removeSavedKanji(char) {
    removeKanjiFromSaved(char);
    renderMyList();
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
