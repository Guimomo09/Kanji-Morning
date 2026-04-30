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
  toggleKanjiSelect(chip, event) {
    const chips = [...document.querySelectorAll('.kanji-saved-chip')];
    const idx   = parseInt(chip.dataset.index, 10);
    if (event && event.shiftKey && _lastKanjiIdx >= 0) {
      const lo  = Math.min(_lastKanjiIdx, idx);
      const hi  = Math.max(_lastKanjiIdx, idx);
      const act = chip.classList.contains('selected') ? 'remove' : 'add';
      chips.slice(lo, hi + 1).forEach(c => c.classList[act]('selected'));
    } else {
      chip.classList.toggle('selected');
      _lastKanjiIdx = idx;
    }
    _updateDeleteBar();
  },
  toggleWordSelect(row, event) {
    const rows = [...document.querySelectorAll('#mylistBody tr:not([style*="display: none"])')];
    const idx  = rows.indexOf(row);
    if (event && event.shiftKey && _lastWordIdx >= 0) {
      const lo  = Math.min(_lastWordIdx, idx);
      const hi  = Math.max(_lastWordIdx, idx);
      const act = row.classList.contains('selected') ? 'remove' : 'add';
      rows.slice(lo, hi + 1).forEach(r => r.classList[act]('selected'));
    } else {
      row.classList.toggle('selected');
      _lastWordIdx = idx;
    }
    _updateDeleteBar();
  },
  selectAllItems() {
    document.querySelectorAll('.kanji-saved-chip, #mylistBody tr').forEach(el => el.classList.add('selected'));
    _updateDeleteBar();
  },
  selectAllKanjis() {
    document.querySelectorAll('.kanji-saved-chip').forEach(el => el.classList.add('selected'));
    _updateDeleteBar();
  },
  selectAllWords() {
    document.querySelectorAll('#mylistBody tr:not([style*="display: none"])').forEach(el => el.classList.add('selected'));
    _updateDeleteBar();
  },
  clearKanjiSelection() {
    document.querySelectorAll('.kanji-saved-chip.selected').forEach(el => el.classList.remove('selected'));
    _updateDeleteBar();
  },
  clearWordSelection() {
    document.querySelectorAll('#mylistBody tr.selected').forEach(el => el.classList.remove('selected'));
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

// ── My List selection state ────────────────────────────────────────────────
let _lastKanjiIdx = -1;
let _lastWordIdx  = -1;
let _dragging     = false;
let _dragAction   = 'select';
let _didDrag      = false;

function _applyDragTo(el) {
  if (_dragAction === 'select') el.classList.add('selected');
  else el.classList.remove('selected');
}

function _updateDeleteBar() {
  const bar   = document.getElementById('mlDeleteBar');
  const count = document.getElementById('mlDeleteCount');
  if (!bar) return;
  const n = document.querySelectorAll('.kanji-saved-chip.selected, #mylistBody tr.selected').length;
  if (n > 0) {
    count.textContent = `${n} selected`;
    bar.classList.add('visible');
  } else {
    bar.classList.remove('visible');
  }
}

// Attach drag-select listeners once on the persistent #mylistSection element
function _setupMyListDrag() {
  const section = document.getElementById('mylistSection');
  if (!section) return;

  section.addEventListener('mousedown', e => {
    const el = e.target.closest('.kanji-saved-chip, #mylistBody tr');
    if (!el || e.shiftKey || e.button !== 0) return;
    _dragging   = true;
    _didDrag    = true;          // suppress the click that fires after mouseup
    _dragAction = el.classList.contains('selected') ? 'deselect' : 'select';
    _applyDragTo(el);
    e.preventDefault();          // prevent text selection while dragging
  });

  section.addEventListener('mouseover', e => {
    if (!_dragging) return;
    const el = e.target.closest('.kanji-saved-chip, #mylistBody tr');
    if (!el) return;
    _applyDragTo(el);
    _updateDeleteBar();
  });

  document.addEventListener('mouseup', () => {
    if (_dragging) { _dragging = false; _updateDeleteBar(); }
  });

  // Capture-phase click suppressor — fires before the onclick attribute
  section.addEventListener('click', e => {
    if (_didDrag) { _didDrag = false; e.stopImmediatePropagation(); }
  }, true);
}

// ── App initialisation ────────────────────────────────────────────────────
setHeader();
cleanupOldData();
_setupMyListDrag();

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
