import { state }                                               from './state.js';
import { cleanupOldData, saveDailyVocab }                       from './daily.js';
import { getWordOfDay }                                         from './wotd.js';
import { todayStr }                                            from './utils.js';
import { initCloud, setPostAuthCallback, cloudSignIn, cloudSignOut, checkPremiumStatus, cloudUpdate } from './cloud.js';
import { srsUpdateReviewCount, rateSrsCard, srsAddWords } from './srs.js';
import { switchTab, saveToday, refresh, changeCount, setHeader, filterGrid } from './ui.js';
import { setVocabLevel, renderVocab, renderMyList, filterMyList, removeFromMyList, removeSelectedWords, toggleFromKanji, getAllSavedWords, toggleMyListSort, setMyListKanjiFilter, setMyListWordFilter, updateSavedWordsMirror, rebuildSavedWordsMirror } from './vocab.js';
import { renderStats, renderHome, setActivityView, navActivityCal, getStudiedDatesSet } from './stats.js';
import { launchDailyQuiz, launchBiWeeklyQuiz, handleQuizAnswer, quizNextQuestion, launchExamMode as _launchExamMode, renderExamTab, launchExamFromTab, setExamTargetLevel } from './quiz.js';
import { setKanjiLevel, removeKanjiFromSaved, removeSelectedKanjis, bestExamples } from './kanji.js';
import { getKanjiDetail, getWords }                             from './api.js';
import { STRIPE_PAYMENT_LINK, CLOUD_ENABLED }                  from './config.js';
import { t, detectLang, setLang, getSupportedLangs, applyI18nToDOM } from './i18n.js';
import { loadTrans } from './trans.js';
import { speakJapanese } from './audio.js';
import { syncXPBar, applyEquipped, renderProfileHTML } from './xp.js';

// ── Wire mobile menu items helper (defined first for global access) ────────
function _wireMenuBtn(id, action) {
  var btn = document.getElementById(id);
  if (!btn) { console.warn('[wireMenuBtn] not found:', id); return; }
  console.log('[wireMenuBtn] wiring', id);
  btn.addEventListener('click', function() {
    closeMobileMenu();
    setTimeout(action, 0);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// TUTORIAL
// ════════════════════════════════════════════════════════════════════════════
let _tutStep = 0;

function _renderTutorialStep() {
  const steps   = t('tutorial_steps');
  const step    = steps[_tutStep];
  const total   = steps.length;
  const isLast  = _tutStep === total - 1;

  document.getElementById('tutIcon').innerHTML  = step.icon;
  document.getElementById('tutTitle').innerHTML = step.title;
  document.getElementById('tutBody').innerHTML  = step.body;
  document.getElementById('tutPrevBtn').style.display = _tutStep > 0 ? '' : 'none';
  document.getElementById('tutNextBtn').textContent   = isLast ? t('premium_lets_go') : 'Next →';

  const dots = document.getElementById('tutDots');
  dots.innerHTML = steps.map((_, i) =>
    `<span class="tutorial-dot${i === _tutStep ? ' active' : ''}"></span>`
  ).join('');
}

function showTutorial() {
  _tutStep = 0;
  _renderTutorialStep();
  document.getElementById('tutorialOverlay').style.display = '';
  document.body.style.overflow = 'hidden';
}

function closeTutorial() {
  document.getElementById('tutorialOverlay').style.display = 'none';
  document.body.style.overflow = '';
  localStorage.setItem('km_onboarding_done', '1');
}

// ════════════════════════════════════════════════════════════════════════════
// TAB HINTS (ⓘ per-tab explainer)
// ════════════════════════════════════════════════════════════════════════════
const TAB_HINTS = {
  home: {
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    title: 'Home — Your Dashboard',
    body: `<p>Your daily study hub. Everything at a glance.</p><ul>
      <li><b>Streak</b> — consecutive days you studied. Don't break the chain!</li>
      <li><b>Daily Quiz</b> — 15 new words + 5 review. Only available after saving words from the Vocab tab.</li>
      <li><b>Weekly Challenge</b> — every Monday, covers the last 2 weeks of vocabulary.</li>
      <li><b>JLPT tile</b> — tracks how many words you've saved toward your current goal. Tap to change level.</li>
    </ul>`,
  },
  kanji: {
    icon: '漢',
    title: 'Kanji — Browse & Discover',
    body: `<p>Explore kanji organised by JLPT level (N5 = easiest, N1 = hardest).</p><ul>
      <li><b>New Selection</b> — shuffle a new batch of kanji at the same level.</li>
      <li><b>Save a kanji</b> — tap the star button on a card to bookmark it in My List and unlock its vocabulary.</li>
      <li><b>More / Less</b> — adjust how many cards are shown at once.</li>
      <li><b>Search bar</b> — find any kanji by character, reading, or meaning.</li>
    </ul>`,
  },
  vocab: {
    icon: '語',
    title: 'Vocab — Daily Word Cards',
    body: `<p>Vocabulary built from the kanji you've bookmarked.</p><ul>
      <li><b>New Selection</b> — shuffle a fresh batch of vocab from your saved kanji.</li>
      <li><b>Save for Quiz</b> — adds today's words to your daily quiz pool.</li>
      <li><b>From Kanji</b> — when active, vocab is filtered to match only the kanji visible in the Kanji tab.</li>
      <li><b>Level filter</b> — focus on a specific JLPT level or mix all levels.</li>
    </ul>`,
  },
  mylist: {
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
    title: 'My List — Saved Words & Kanji',
    body: `<p>All your bookmarked kanji and vocabulary in one place.</p><ul>
      <li><b>Tap a kanji chip</b> — opens the kanji detail popup with readings and examples.</li>
      <li><b>Select</b> — enables multi-select mode for bulk deletion.</li>
      <li><b>SRS Review</b> — spaced-repetition practice of your saved words (toolbar button).</li>
      <li><b>Sign in</b> — syncs your list across devices via Google account.</li>
    </ul>`,
  },
  stats: {
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    title: 'Stats — Your Progress',
    body: `<p>Charts and history tracking your study journey.</p><ul>
      <li><b>Streak calendar</b> — each square = one study day. Darker = more words studied.</li>
      <li><b>Score chart</b> — your quiz results over time (last 20 sessions).</li>
      <li><b>Activity chart</b> — words studied per day over the last 2 weeks.</li>
      <li><b>JLPT progress</b> — how close you are to your target level vocabulary count.</li>
    </ul>`,
  },
  exam: {
    icon: '試験',
    title: 'Exam Mode — JLPT Simulation',
    body: `<p>A timed quiz that simulates a real JLPT test using your saved vocabulary.</p><ul>
      <li><b>10 minutes</b> — strictly timed. Unanswered questions count as wrong.</li>
      <li><b>40 questions</b> — mix of reading, meaning, and recognition question types.</li>
      <li><b>60% to pass</b> — score 24/40 or better.</li>
      <li><b>Cumulative levels</b> — each exam includes all vocabulary up to that level (e.g. N3 includes N5, N4 and N3; N2 adds N2 on top, etc.).</li>
    </ul>`,
  },
};

let _currentTabForHint = 'home';

function showTabHint(tab) {
  const key  = tab || _currentTabForHint;
  const hint = TAB_HINTS[key];
  if (!hint) return;
  document.getElementById('tabHintIcon').innerHTML  = hint.icon;
  document.getElementById('tabHintTitle').textContent = hint.title;
  document.getElementById('tabHintBody').innerHTML  = hint.body;
  document.getElementById('tabHintModal').style.display = '';
  document.body.style.overflow = 'hidden';
}

function closeTabHint() {
  document.getElementById('tabHintModal').style.display = 'none';
  document.body.style.overflow = '';
}


function tutorialNext() {
  const steps = t('tutorial_steps');
  if (_tutStep < steps.length - 1) {
    _tutStep++;
    _renderTutorialStep();
  } else {
    closeTutorial();
  }
}

function tutorialPrev() {
  if (_tutStep > 0) { _tutStep--; _renderTutorialStep(); }
}

// ════════════════════════════════════════════════════════════════════════════
// KANJI DETAIL POPUP
// ════════════════════════════════════════════════════════════════════════════
async function openKanjiDetail(char) {
  const backdrop = document.getElementById('kanjiDetailBackdrop');
  const content  = document.getElementById('kanjiDetailContent');
  content.innerHTML = '<div class="kanji-detail-loading">' + t('kanji_loading') + '</div>';
  backdrop.style.display = '';
  document.body.style.overflow = 'hidden';

  try {
    const [detail, words] = await Promise.all([getKanjiDetail(char), getWords(char)]);
    const on  = (detail.on_readings  || []).join('　') || '—';
    const kun = (detail.kun_readings || []).join('　') || '—';
    const meanings = (detail.meanings || []).slice(0, 4).join(', ') || '?';
    const ex = bestExamples(words, char, 3);
    const exHtml = ex.length
      ? ex.map(e => `
          <div class="example">
            <div class="ex-top">
              <span class="ex-word">${e.w}</span>
              <span class="ex-reading">【${e.r}】</span>
            </div>
            <div class="ex-meaning">${e.m}</div>
          </div>`).join('')
      : `<div class="example"><div class="ex-meaning">${t('kanji_no_examples')}</div></div>`;

    content.innerHTML = `
      <div class="card-top" style="margin-bottom:18px">
        <div class="kanji-char">${char}</div>
        <div class="card-info">
          <div class="card-meaning" style="font-size:18px">${meanings}</div>
        </div>
      </div>
      <div class="readings" style="margin-bottom:16px">
        <div class="reading-group">
          <span class="reading-label">${t('kanji_on')}</span>
          <span class="reading-kana">${on}</span>
        </div>
        <div class="reading-group">
          <span class="reading-label">${t('kanji_kun')}</span>
          <span class="reading-kana">${kun}</span>
        </div>
      </div>
      <div class="examples-label">${t('kanji_examples')}</div>
      ${exHtml}`;
  } catch {
    content.innerHTML = '<div class="kanji-detail-loading">' + t('kanji_load_error') + '</div>';
  }
}

function closeKanjiDetail() {
  document.getElementById('kanjiDetailBackdrop').style.display = 'none';
  document.body.style.overflow = '';
}

function openWordDetail(wordStr) {
  const backdrop = document.getElementById('kanjiDetailBackdrop');
  const content  = document.getElementById('kanjiDetailContent');
  const it = getAllSavedWords().find(w => w.word === wordStr);
  if (!it) return;
  const extras = (it.extraMeanings || []).slice(0, 3);
  content.innerHTML = `
    <div style="margin-bottom:18px">
      <div style="font-size:clamp(28px,8vw,56px);font-weight:900;line-height:1.1;color:#111;word-break:break-word;margin-bottom:8px">${it.word}</div>
      ${it.reading ? `<div style="font-size:18px;color:var(--red);font-weight:700;margin-bottom:6px">${it.reading}</div>` : ''}
      <div style="font-size:16px;color:var(--text);font-weight:600">${it.meaning}</div>
      ${extras.length ? `<div style="font-size:13px;color:var(--sub);margin-top:4px">${extras.join(' · ')}</div>` : ''}
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <span class="badge badge-${it.level}">${it.level}</span>
      <span style="font-size:12px;color:var(--muted)">${t('kanji_saved')} ${it.savedDate}</span>
    </div>
    ${it.sourceKanji ? `<div style="font-size:13px;color:var(--sub);margin-top:10px">${t('kanji_from')} <strong>${it.sourceKanji}</strong></div>` : ''}`;
  backdrop.style.display = '';
  document.body.style.overflow = 'hidden';
}

function handleKanjiChipClick(chip, kanji, event) {
  if (_selectMode) { window.toggleKanjiSelect(chip, event); return; }
  openKanjiDetail(kanji);
}

function handleWordRowClick(row, event) {
  if (_selectMode) { window.toggleWordSelect(row, event); return; }
  openWordDetail(row.dataset.word);
}

// ── Save Word of the Day to My List ──────────────────────────────────────
function saveWotd() {
  const wotd = getWordOfDay();
  const item = { word: wotd.word, reading: wotd.reading, meaning: wotd.meaning, pos: '', level: 'N3' };
  saveDailyVocab(todayStr(), [item]);
  updateSavedWordsMirror([item], todayStr());
  const added = srsAddWords([item]);
  if (added > 0) srsUpdateReviewCount();
  renderHome(); // re-render to flip button to "✓ Saved"
}

// ── Upgrade modal ─────────────────────────────────────────────────────────
function openUpgradeModal(context) {
  const modal = document.getElementById('upgradeModal');
  if (!modal) return;
  const body = modal.querySelector('.upgrade-modal-body');

  const contextMsg = context === 'limit'
    ? `<div class="upgrade-modal-context">${t('upgrade_limit_msg')}</div>`
    : context === 'exam'
    ? `<div class="upgrade-modal-context">${t('upgrade_exam_msg')}</div>`
    : '';

  const upgradeUrl = STRIPE_PAYMENT_LINK +
    (state._fbUser ? `?client_reference_id=${state._fbUser.uid}` : '');

  body.innerHTML = `
    ${contextMsg}
    <div class="upgrade-modal-title">${t('upgrade_title')}</div>
    <ul class="upgrade-modal-features">
      <li>${t('upgrade_feature1')}</li>
      <li>${t('upgrade_feature2')}</li>
      <li>${t('upgrade_feature3')}</li>
      <li>${t('upgrade_feature4')}</li>
    </ul>
    <div class="upgrade-modal-price">${t('upgrade_price')} <span>${t('upgrade_price_sub')}</span></div>
    ${!state._fbUser
      ? `<div class="upgrade-modal-signin">${t('upgrade_signin_msg')}<br>
         <button class="btn btn-primary" style="margin-top:10px" onclick="cloudSignIn()">${t('upgrade_signin_btn')}</button></div>`
      : `<a class="btn btn-primary upgrade-modal-cta" href="${upgradeUrl}" target="_blank" rel="noopener">
           ${t('upgrade_cta')}
         </a>
         <div class="upgrade-modal-note">${t('upgrade_note')}</div>`
    }`;

  modal.style.display = '';
  document.body.style.overflow = 'hidden';
}

function closeUpgradeModal() {
  const modal = document.getElementById('upgradeModal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

// ── Handle ?premium=success redirect from Stripe ──────────────────────────
const _urlParams = new URLSearchParams(window.location.search);
if (_urlParams.get('premium') === 'success') {
  history.replaceState({}, '', window.location.pathname);
  // Wait for Firebase auth to be ready, then check premium
  const _checkAfterAuth = () => {
    checkPremiumStatus().then(isPremium => {
      const modal = document.getElementById('premiumSuccessModal');
      if (modal) {
        modal.querySelector('.psm-status').textContent = isPremium
          ? t('premium_activated')
          : t('premium_activating');
        modal.style.display = '';
        document.body.style.overflow = 'hidden';
      }
      if (isPremium) renderHome();
    });
  };
  // Defer until after auth state resolves (up to 3s)
  setTimeout(_checkAfterAuth, 1500);
}

// close popup on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeKanjiDetail();
    closeTutorial();
    closeSettings();
    closeUpgradeModal();
  }
});

// ── In-memory fallback for streak tile view (survives localStorage quota) ─
let _streakTileView = localStorage.getItem('km_streak_tile_view') || 'streak';
export function getStreakTileView() { return _streakTileView; }

// ── Expose all functions called by inline onclick handlers ────────────────
Object.assign(window, {
  // Audio
  speakJapanese,
  filterGrid,

  // Navigation
  switchTab,
  setJlptGoal(level) {
    localStorage.setItem('km_jlpt_goal', level);
    renderHome();
  },
  cycleJlptGoal() {
    const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];
    const cur = localStorage.getItem('km_jlpt_goal') || 'N3';
    const next = LEVELS[(LEVELS.indexOf(cur) + 1) % LEVELS.length];
    localStorage.setItem('km_jlpt_goal', next);
    if (state.currentTab === 'stats') renderStats();
    else renderHome();
  },
  cycleStreakTile() {
    _streakTileView = _streakTileView === 'streak' ? 'month' : 'streak';
    try { localStorage.setItem('km_streak_tile_view', _streakTileView); } catch {}
    if (state.currentTab === 'stats') renderStats();
    else renderHome();
  },
  // Tutorial
  showTutorial,
  closeTutorial,
  tutorialNext,
  tutorialPrev,
  // Tab hints
  showTabHint,
  closeTabHint,
  // Activity view switcher
  setActivityView,
  navActivityCal,
  // Kanji detail popup
  openKanjiDetail,
  closeKanjiDetail,
  openWordDetail,
  handleKanjiChipClick,
  handleWordRowClick,
  saveWotd,
  openUpgradeModal,
  closeUpgradeModal,

  // Toolbar controls
  refresh,
  changeCount,
  saveToday,

  // Vocab
  setVocabLevel,
  filterMyList,
  removeFromMyList,
  toggleFromKanji,
  toggleMyListSort,
  setMyListKanjiFilter,
  setMyListWordFilter,

  // Exam tab
  renderExamTab,
  launchExamFromTab,
  setExamTargetLevel,
  toggleExamSection() {
    const s    = document.getElementById('examJlptSection');
    const tile = document.getElementById('examMainTile');
    if (!s) return;
    const open = s.style.display === 'none';
    s.style.display = open ? 'block' : 'none';
    if (tile) tile.classList.toggle('exam-quiz-tile-exam-open', open);
  },

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
    if (_didDrag) { _didDrag = false; return; }
    if (!_selectMode) {
      if (!window.matchMedia('(pointer: fine)').matches) return; // touch: long-press only
      _enterSelectMode();
    }
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
    if (_didDrag) { _didDrag = false; return; }
    if (!_selectMode) {
      if (!window.matchMedia('(pointer: fine)').matches) return; // touch: long-press only
      _enterSelectMode();
    }
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
    _selectMode = false;
    renderMyList();
  },
  clearSelection() {
    _exitSelectMode();
  },
  toggleSelectMode() {
    if (_selectMode) _exitSelectMode();
    else _enterSelectMode();
  },

  // Quiz
  launchDailyQuiz,
  launchBiWeeklyQuiz,
  handleQuizAnswer,
  quizNextQuestion,
  launchExamMode() {
    if (!state.isPremium) { openUpgradeModal('exam'); return; }
    _launchExamMode();
  },

  // SRS
  rateSrsCard,

  // Cloud auth
  cloudSignIn,
  cloudSignOut,

  // Quiz result screen wrappers
  resetAndBack()  { const tab = state.currentTab; state.quizState = null; switchTab(tab === 'exam' ? 'exam' : 'vocab'); },
  resetAndStats() { state.quizState = null; switchTab('stats'); },

  // Settings modal
  openSettings,
  openMobileMenu,
  closeMobileMenu,
  closeSettings,
  saveSettings,
  changeTheme,

  // Language switcher
  changeLanguage(code) {
    setLang(code);
    applyI18nToDOM();
    setHeader();
    // Re-render current tab to apply translated strings
    switchTab(state.currentTab || 'home');
  },
});

function openMobileMenu() {
  const menu = document.getElementById('mobileMenu');
  if (menu) menu.style.display = menu.style.display === 'none' ? '' : 'none';
}
function closeMobileMenu() {
  const menu = document.getElementById('mobileMenu');
  if (menu) menu.style.display = 'none';
}

// ── My List selection state ────────────────────────────────────────────────
let _lastKanjiIdx = -1;
let _lastWordIdx  = -1;
let _dragging     = false;
let _dragAction   = null;
let _didDrag      = false;
let _selectMode   = false;   // mobile: long-press activates select mode

function _applyDragTo(el) {
  if ((_dragAction || 'select') === 'select') el.classList.add('selected');
  else el.classList.remove('selected');
}

function _exitSelectMode() {
  _selectMode = false;
  document.getElementById('mylistSection')?.classList.remove('select-mode');
  document.querySelectorAll('.kanji-saved-chip.selected, #mylistBody tr.selected')
    .forEach(el => el.classList.remove('selected'));
  _updateDeleteBar();
}

function _enterSelectMode() {
  _selectMode = true;
  document.getElementById('mylistSection')?.classList.add('select-mode');
  _updateDeleteBar();
}

function _syncSelectButtons() {
  ['mlKanjiSelectBtn', 'mlWordSelectBtn'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.textContent = _selectMode ? '✕ Cancel' : 'Select';
  });
  ['mlKanjiSelectAll', 'mlWordSelectAll'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.style.display = _selectMode ? '' : 'none';
  });
}

function _updateDeleteBar() {
  const bar   = document.getElementById('mlDeleteBar');
  const count = document.getElementById('mlDeleteCount');
  if (!bar) return;
  const n = document.querySelectorAll('.kanji-saved-chip.selected, #mylistBody tr.selected').length;
  if (n > 0) {
    count.textContent = t('ml_n_selected')(n);
    bar.classList.add('visible');
  } else if (_selectMode) {
    count.textContent = t('ml_tap_to_select');
    bar.classList.add('visible');
  } else {
    bar.classList.remove('visible');
  }
  _syncSelectButtons();
}

// Attach drag-select listeners once on the persistent #mylistSection element
function _setupMyListDrag() {
  const section = document.getElementById('mylistSection');
  if (!section) return;

  // ── Mouse drag-select (desktop) ─────────────────────────────────────
  // mousedown ONLY primes drag state — does NOT select anything.
  // Single-click selection is handled by toggleKanjiSelect / toggleWordSelect.
  // Multi-select happens in mousemove once the finger/mouse actually moves.
  let _dragStartEl = null;

  section.addEventListener('mousedown', e => {
    const onCheck = !!e.target.closest('.kanji-chip-check, .ml-check-icon');
    if (!onCheck || e.button !== 0) return;
    const el = e.target.closest('.kanji-saved-chip') ||
               (document.getElementById('mylistBody')?.contains(e.target) ? e.target.closest('tr') : null);
    if (!el) return;
    _dragging    = true;
    _didDrag     = false;
    _dragStartEl = el;
    _dragAction  = null;
    e.preventDefault();
  });

  section.addEventListener('mousemove', e => {
    if (!_dragging) return;
    const el = e.target.closest('.kanji-saved-chip') ||
               (document.getElementById('mylistBody')?.contains(e.target) ? e.target.closest('tr') : null);
    if (!el) return;
    if (!_didDrag) {
      _didDrag    = true;
      if (!_selectMode) _enterSelectMode();
      _dragAction = _dragStartEl.classList.contains('selected') ? 'deselect' : 'select';
      _applyDragTo(_dragStartEl);
    }
    _applyDragTo(el);
    _updateDeleteBar();
  });

  document.addEventListener('mouseup', () => {
    if (_dragging) { _dragging = false; _dragStartEl = null; _updateDeleteBar(); }
  });

  // Suppress click only when a real drag happened (mousemove fired)
  section.addEventListener('click', e => {
    if (_didDrag) { _didDrag = false; e.stopImmediatePropagation(); }
  }, true);

  // ── Touch: long-press → select mode → drag-select ────────────────────
  let _touchStartEl = null;
  let _touchMoved   = false;
  let _lpTimer      = null;

  section.addEventListener('touchstart', e => {
    const item    = e.target.closest('.kanji-saved-chip, #mylistBody tr');
    // Only treat as a potential select-drag if finger lands on the ✓ indicator
    const onCheck = !!e.target.closest('.kanji-chip-check, .ml-check-icon');
    _touchMoved   = false;
    _dragAction   = null;
    _touchStartEl = (_selectMode && item && onCheck) ? item : null;
    if (!item || _selectMode) return;
    // Long-press on anything → enter select mode
    _lpTimer = setTimeout(() => {
      if (_touchMoved) return;
      _enterSelectMode();
      _dragAction = item.classList.contains('selected') ? 'deselect' : 'select';
      _applyDragTo(item);
      _updateDeleteBar();
      navigator.vibrate?.(40);
    }, 500);
  }, { passive: true });

  // passive:false so we CAN call preventDefault — but only when needed.
  // Key rule: in select mode, drag started on ✓ check → block scroll + drag-select
  //           drag started elsewhere → scroll freely
  section.addEventListener('touchmove', e => {
    _touchMoved = true;
    clearTimeout(_lpTimer);
    _lpTimer = null;
    if (!_selectMode || !_touchStartEl) return; // allow scroll
    e.preventDefault();                          // block scroll only when drag-selecting via ✓
    const t  = e.touches[0];
    const el = document.elementFromPoint(t.clientX, t.clientY)
                 ?.closest?.('.kanji-saved-chip, #mylistBody tr');
    if (el) {
      // Set drag action based on first item touched
      if (!_dragAction) _dragAction = _touchStartEl.classList.contains('selected') ? 'deselect' : 'select';
      _applyDragTo(el);
      _updateDeleteBar();
    }
  }, { passive: false });

  section.addEventListener('touchend', e => {
    clearTimeout(_lpTimer);
    _lpTimer = null;
    if (!_selectMode) return;
    // In select mode: plain tap (no move) toggles the item
    if (!_touchMoved) {
      const el = e.target.closest('.kanji-saved-chip, #mylistBody tr');
      if (el) { el.classList.toggle('selected'); _updateDeleteBar(); }
    }
    _touchMoved = false;
  }, { passive: true });
}

// ── Theme ──────────────────────────────────────────────────────────────
function _applyTheme(theme) {
  if (theme === 'dark' || theme === 'light') {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
}
function _syncThemeButtons(val) {
  document.querySelectorAll('#themeToggleGroup .theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === val);
  });
}
function changeTheme(val) {
  if (val === 'dark' || val === 'light') {
    localStorage.setItem('km_theme', val);
  } else {
    localStorage.removeItem('km_theme');
  }
  _applyTheme(val);
  _syncThemeButtons(val);
}

// ── Settings ──────────────────────────────────────────────────────────────
function openSettings() {
  const msg = document.getElementById('settingsSaveMsgMobile');
  if (msg) msg.textContent = '';
  // Sync theme buttons
  _syncThemeButtons(localStorage.getItem('km_theme') || 'auto');
  // Render profile/shop section
  const profileEl = document.getElementById('profileContent');
  if (profileEl) profileEl.innerHTML = renderProfileHTML();
  document.getElementById('settingsPage').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSettings() {
  document.getElementById('settingsPage').classList.remove('open');
  document.body.style.overflow = '';
}

function saveSettings() {
  closeSettings();
}



// ── App initialisation ────────────────────────────────────────────────────
setHeader();
cleanupOldData();
_applyTheme(localStorage.getItem('km_theme') || 'auto');_setupMyListDrag();

// ── DEBUG AGENT ──────────────────────────────────────────────────────────
window.debugAgent = {
  rerunAll: function() {
    console.log('[debugAgent] DOMContentLoaded: re-init app');
    setHeader();
    cleanupOldData();
    _setupMyListDrag();
    setPostAuthCallback(() => {
      if (state._fbUser && window.$crisp) {
        window.$crisp.push(['set', 'user:email', [state._fbUser.email]]);
        if (state._fbUser.displayName) {
          window.$crisp.push(['set', 'user:nickname', [state._fbUser.displayName]]);
        }
      }
      if      (state.currentTab === 'vocab')  renderVocab();
      else if (state.currentTab === 'mylist') renderMyList();
      else if (state.currentTab === 'stats')  renderStats();
      else if (state.currentTab === 'home')   renderHome();
    });
    initCloud();
    srsUpdateReviewCount();
    switchTab('home');
    _wireMenuBtn('mobileMenuSettings', openSettings);
    _wireMenuBtn('mobileMenuChat', function() { if (window.$crisp) { window.$crisp.push(['do','chat:show']); window.$crisp.push(['do','chat:open']); } });
    document.addEventListener('click', function(e) {
      const wrap = document.getElementById('mobileMenuBtn')?.closest('.h-hamburger-wrap');
      if (wrap && !wrap.contains(e.target)) closeMobileMenu();
    });
    if (!localStorage.getItem('km_onboarding_done')) {
      setTimeout(showTutorial, 600);
    }
    console.log('[debugAgent] All wiring and init done.');
  },
  openSettings,
  showTutorial,
  test: () => alert('debugAgent is loaded!'),
};

// DOMContentLoaded = wiring safe
window.addEventListener('DOMContentLoaded', function() {
  console.log('[debugAgent] DOMContentLoaded');
  // Wire menu buttons and one-time UI setup (NO setPostAuthCallback/initCloud here)
  setHeader();
  _wireMenuBtn('mobileMenuSettings', openSettings);
  _wireMenuBtn('mobileMenuChat', function() { if (window.$crisp) { window.$crisp.push(['do','chat:show']); window.$crisp.push(['do','chat:open']); } });
  document.addEventListener('click', function(e) {
    const wrap = document.getElementById('mobileMenuBtn')?.closest('.h-hamburger-wrap');
    if (wrap && !wrap.contains(e.target)) closeMobileMenu();
  });
  if (!localStorage.getItem('km_onboarding_done')) {
    setTimeout(showTutorial, 600);
  }
  // Sync XP bar on app open
  syncXPBar(getStudiedDatesSet());
  applyEquipped();
  console.log('[debugAgent] All wiring and init done.');
});

// ── Debug helper — call window.kmDebug() from browser console ────────────
window.kmDebug = function() {
  const { loadQuizHistory } = window._kmModules || {};
  const raw = localStorage.getItem('quiz_history');
  const history = raw ? JSON.parse(raw) : [];
  const biweekly = history.filter(h => h.type === 'biweekly');
  const doneKeys = Object.keys(localStorage).filter(k => k.startsWith('biweekly_done_'));
  console.group('[KM Debug]');
  console.log('Today:', new Date().toISOString());
  console.log('quiz_history entries:', history.length);
  console.log('Biweekly entries:', biweekly);
  console.log('biweekly_done keys:', doneKeys.map(k => k + '=' + localStorage.getItem(k)));
  console.log('Full quiz_history:', JSON.parse(raw || '[]'));
  console.groupEnd();
  return { history, biweekly, doneKeys };
};

// ── PWA service worker ────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .catch(err => console.warn('[SW] Registration failed:', err));
  });
}

// Re-render current tab after cloud login so pulled data is reflected
setPostAuthCallback(() => {
  // Cloud pull already set km_saved_words. Just push it to Firestore as canonical source of truth.
  // Do NOT call rebuildSavedWordsMirror() here — it would inflate the list with old local vocab_daily_* keys.
  const words = getAllSavedWords();
  console.log(`[postAuth] savedWords after cloud pull: ${words.length}`);
  if (CLOUD_ENABLED && state._fbUser && words.length > 0) {
    cloudUpdate({ savedWords: words }).catch(e => console.warn('[postAuth] savedWords push failed:', e));
  }
  // Identify logged-in user in Crisp
  if (state._fbUser && window.$crisp) {
    window.$crisp.push(['set', 'user:email', [state._fbUser.email]]);
    if (state._fbUser.displayName) {
      window.$crisp.push(['set', 'user:nickname', [state._fbUser.displayName]]);
    }
  }
  if      (state.currentTab === 'vocab')  renderVocab();
  else if (state.currentTab === 'mylist') renderMyList();
  else if (state.currentTab === 'stats')  renderStats();
  else if (state.currentTab === 'exam')   renderExamTab();
  else if (state.currentTab === 'home')   renderHome();
  // Re-sync XP with potentially richer cloud data
  syncXPBar();
});

initCloud();
srsUpdateReviewCount();
history.scrollRestoration = 'manual';

// ── Manual sync helper — call window.kmSync() from browser console ────────
window.kmSync = async function() {
  const words = rebuildSavedWordsMirror();
  console.log(`[kmSync] Local words: ${words.length}. User: ${state._fbUser?.email}. DB: ${!!state._fbDb}`);
  if (!state._fbUser || !state._fbDb) { console.error('[kmSync] Not logged in or Firestore not ready'); return; }
  if (words.length === 0) { console.warn('[kmSync] No local words to push'); return; }
  await cloudUpdate({ savedWords: words });
  console.log(`[kmSync] Done. Pushed ${words.length} words to Firestore.`);
  renderStats();
};

// Apply i18n to static DOM elements on startup
detectLang();
applyI18nToDOM();
// Preload multilingual word translations (non-blocking, used by vocab/quiz/kanji)
loadTrans();

const _savedTab = localStorage.getItem('km_tab') || 'home';
switchTab(_savedTab);
requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'instant' }));




// Sign out confirmation
function confirmSignOut() {
  if (window.confirm('Sign out? You will need to log in again to sync your data.')) {
    cloudSignOut();
  }
}

window.confirmSignOut = confirmSignOut;
_wireMenuBtn('mobileMenuSettings', openSettings);
_wireMenuBtn('mobileMenuChat',     function() { if (window.$crisp) { window.$crisp.push(['do','chat:show']); window.$crisp.push(['do','chat:open']); } });
// Close mobile menu when tapping outside
document.addEventListener('click', function(e) {
  const wrap = document.getElementById('mobileMenuBtn')?.closest('.h-hamburger-wrap');
  if (wrap && !wrap.contains(e.target)) closeMobileMenu();
});

// Show tutorial on first ever visit
if (!localStorage.getItem('km_onboarding_done')) {
  setTimeout(showTutorial, 600);
}

// ── PWA service worker ────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .catch(err => console.warn('[SW] Registration failed:', err));
  });
}
