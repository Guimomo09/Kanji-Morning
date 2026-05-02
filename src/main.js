import { state }                                               from './state.js';
import { cleanupOldData, saveDailyVocab }                       from './daily.js';
import { getWordOfDay }                                         from './wotd.js';
import { todayStr }                                            from './utils.js';
import { initCloud, setPostAuthCallback, cloudSignIn, cloudSignOut, checkPremiumStatus } from './cloud.js';
import { srsUpdateReviewCount, rateSrsCard, srsAddWords } from './srs.js';
import { switchTab, saveToday, refresh, changeCount, setHeader } from './ui.js';
import { setVocabLevel, renderVocab, renderMyList, filterMyList, removeFromMyList, removeSelectedWords, toggleFromKanji, getAllSavedWords } from './vocab.js';
import { renderStats, renderHome }                              from './stats.js';
import { launchDailyQuiz, launchBiWeeklyQuiz, handleQuizAnswer, launchExamMode as _launchExamMode } from './quiz.js';
import { setKanjiLevel, removeKanjiFromSaved, removeSelectedKanjis, bestExamples } from './kanji.js';
import { getKanjiDetail, getWords }                             from './api.js';
import { STRIPE_PAYMENT_LINK }                                  from './config.js';

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
const TUTORIAL_STEPS = [
  {
    icon: '🌅',
    title: 'Bienvenue sur<br>朝の漢字',
    body: 'Your daily Japanese study companion.<br>10 words every morning, 7 minutes — kanji, vocabulary, and a smart review system that makes it stick.',
  },
  {
    icon: '漢',
    title: 'Kanji Tab',
    body: 'Explore 10 kanji every day. See their meanings, on/kun readings, and real example words.<br><br>Tap <strong>☆</strong> to save a kanji to your list.',
  },
  {
    icon: '語',
    title: 'Vocabulary Tab',
    body: 'Get JLPT-ranked vocabulary built from those kanji. Every word is authentic Japanese.<br><br>Tap <strong>💾 Save for Quiz</strong> to add words to your deck.',
  },
  {
    icon: '🎯',
    title: 'Quiz & SRS',
    body: '<strong>Daily Quiz</strong> — test yourself on today\'s saved words.<br><br><strong>Smart Review</strong> — the app tracks what you know and reschedules words so you review them at the perfect time.',
  },
  {
    icon: '📊',
    title: 'Track Your Progress',
    body: 'The <strong>Stats tab</strong> tracks your streak, score history, and word count.<br><br>Come back every morning — consistency beats intensity.<br><strong>がんばって！</strong>',
  },
];
let _tutStep = 0;

function _renderTutorialStep() {
  const step    = TUTORIAL_STEPS[_tutStep];
  const total   = TUTORIAL_STEPS.length;
  const isLast  = _tutStep === total - 1;

  document.getElementById('tutIcon').innerHTML  = step.icon;
  document.getElementById('tutTitle').innerHTML = step.title;
  document.getElementById('tutBody').innerHTML  = step.body;
  document.getElementById('tutPrevBtn').style.display = _tutStep > 0 ? '' : 'none';
  document.getElementById('tutNextBtn').textContent   = isLast ? "Let's go! →" : 'Next →';

  const dots = document.getElementById('tutDots');
  dots.innerHTML = TUTORIAL_STEPS.map((_, i) =>
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

function tutorialNext() {
  if (_tutStep < TUTORIAL_STEPS.length - 1) {
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
  content.innerHTML = '<div class="kanji-detail-loading">読み込み中…</div>';
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
      : '<div class="example"><div class="ex-meaning">No examples available.</div></div>';

    content.innerHTML = `
      <div class="card-top" style="margin-bottom:18px">
        <div class="kanji-char">${char}</div>
        <div class="card-info">
          <div class="card-meaning" style="font-size:18px">${meanings}</div>
        </div>
      </div>
      <div class="readings" style="margin-bottom:16px">
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
      ${exHtml}`;
  } catch {
    content.innerHTML = '<div class="kanji-detail-loading">Could not load data.</div>';
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
      <span style="font-size:12px;color:var(--muted)">Saved ${it.savedDate}</span>
    </div>
    ${it.sourceKanji ? `<div style="font-size:13px;color:var(--sub);margin-top:10px">From kanji: <strong>${it.sourceKanji}</strong></div>` : ''}`;
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
    ? '<div class="upgrade-modal-context">🔒 You\'ve reached the <strong>30-word free limit</strong>.</div>'
    : context === 'exam'
    ? '<div class="upgrade-modal-context">🎓 <strong>Exam Mode</strong> is a Premium feature.</div>'
    : '';

  const upgradeUrl = STRIPE_PAYMENT_LINK +
    (state._fbUser ? `?client_reference_id=${state._fbUser.uid}` : '');

  body.innerHTML = `
    ${contextMsg}
    <div class="upgrade-modal-title">✨ Unlock Premium</div>
    <ul class="upgrade-modal-features">
      <li>✅ Unlimited saved words</li>
      <li>✅ Exam Mode (20 questions, 7 min)</li>
      <li>✅ Full stats & charts</li>
      <li>✅ Lifetime access — no subscription</li>
    </ul>
    <div class="upgrade-modal-price">€7.99 <span>one-time payment</span></div>
    ${!state._fbUser
      ? `<div class="upgrade-modal-signin">Sign in first to activate Premium on your account.<br>
         <button class="btn btn-primary" style="margin-top:10px" onclick="cloudSignIn()">Sign in with Google</button></div>`
      : `<a class="btn btn-primary upgrade-modal-cta" href="${upgradeUrl}" target="_blank" rel="noopener">
           Pay €7.99 — Activate Premium →
         </a>
         <div class="upgrade-modal-note">Secure payment via Stripe · Your account is auto-upgraded after payment.</div>`
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
          ? '🎉 Premium activated!'
          : '⏳ Activating… refresh in a moment if features are not unlocked yet.';
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

// ── Expose all functions called by inline onclick handlers ────────────────
Object.assign(window, {
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
    renderHome();
  },
  // Tutorial
  showTutorial,
  closeTutorial,
  tutorialNext,
  tutorialPrev,
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
  resetAndBack()  { state.quizState = null; switchTab('vocab'); },
  resetAndStats() { state.quizState = null; switchTab('stats'); },

  // PWA notification opt-in (called from quiz result screen)
  requestQuizNotification: _requestQuizNotification,

  // Settings modal
  openSettings,
  openMobileMenu,
  closeMobileMenu,
  closeSettings,
  saveSettings,
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
    count.textContent = `${n} selected`;
    bar.classList.add('visible');
  } else if (_selectMode) {
    count.textContent = 'Tap items to select';
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

// ── Settings ──────────────────────────────────────────────────────────────
function openSettings() {
  const toggle  = document.getElementById('settingsNotifToggleMobile');
  const timeIn  = document.getElementById('settingsTimeInputMobile');
  const timeRow = document.getElementById('settingsTimeRowMobile');
  const msg     = document.getElementById('settingsSaveMsgMobile');
  if (msg) msg.textContent = '';
  const savedTime    = localStorage.getItem('km_notif_time') || '08:00';
  const notifEnabled = window.Notification?.permission === 'granted' && !!localStorage.getItem('km_notif_scheduled');
  if (toggle) { toggle.checked = notifEnabled; }
  if (timeIn) { timeIn.value = savedTime; timeIn.disabled = !notifEnabled; }
  if (timeRow) timeRow.style.opacity = notifEnabled ? '1' : '.45';
  toggle?.addEventListener('change', () => {
    const on = toggle.checked;
    if (timeIn) timeIn.disabled = !on;
    if (timeRow) timeRow.style.opacity = on ? '1' : '.45';
  }, { once: true });
  document.getElementById('settingsPage').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSettings() {
  document.getElementById('settingsPage').classList.remove('open');
  document.body.style.overflow = '';
}

function saveSettings() {
  const toggle  = document.getElementById('settingsNotifToggleMobile');
  const timeIn  = document.getElementById('settingsTimeInputMobile');
  const msg     = document.getElementById('settingsSaveMsgMobile');
  const enabled = toggle?.checked ?? false;
  const timeVal = (timeIn && timeIn.value) ? timeIn.value : '08:00';

  if (!enabled) {
    localStorage.removeItem('km_notif_scheduled');
    if (msg) { msg.textContent = '✓ Reminder disabled'; }
    setTimeout(closeSettings, 1200);
    return;
  }

  if (!('Notification' in window)) {
    if (msg) msg.textContent = 'Notifications not supported.';
    return;
  }

  Notification.requestPermission().then(perm => {
    if (perm !== 'granted') {
      if (msg) msg.textContent = '🔕 Blocked in browser settings';
      if (toggle) toggle.checked = false;
      return;
    }
    const [h, m] = timeVal.split(':').map(Number);
    localStorage.setItem('km_notif_time', timeVal);
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, m, 0, 0);
    localStorage.setItem('km_notif_scheduled', d.toISOString());
    const label = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    if (msg) { msg.textContent = `✓ Set for ${label} daily`; }
    setTimeout(closeSettings, 1200);
  });
}

// ── PWA morning notification opt-in ──────────────────────────────────────
function _checkPendingNotification() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const raw = localStorage.getItem('km_notif_scheduled');
  if (!raw) return;
  const scheduled = new Date(raw);
  if (Date.now() < scheduled.getTime()) return;
  // Due — fire and reschedule for same time next day
  const savedTime = localStorage.getItem('km_notif_time') || '08:00';
  const [h, m]    = savedTime.split(':').map(Number);
  localStorage.removeItem('km_notif_scheduled');
  const next = new Date(); next.setDate(next.getDate() + 1); next.setHours(h, m, 0, 0);
  localStorage.setItem('km_notif_scheduled', next.toISOString());
  navigator.serviceWorker.ready
    .then(reg => reg.showNotification('朝の漢字 · Morning Kanji', {
      body: 'Your daily kanji are waiting. 7 minutes is all it takes! がんばって！',
      icon: '/icons/icon-192.svg',
      badge: '/icons/icon-192.svg',
    }))
    .catch(() => {
      try { new Notification('朝の漢字 · Morning Kanji', { body: 'Your daily kanji are waiting! がんばって！' }); } catch {}
    });
}

function _requestQuizNotification() {
  if (!('Notification' in window)) {
    alert('Notifications are not supported by your browser.');
    return;
  }
  const timeInput = document.getElementById('notifTimeInput');
  const timeVal   = (timeInput && timeInput.value) ? timeInput.value : '08:00';
  const [h, m]    = timeVal.split(':').map(Number);
  const btn       = document.getElementById('notifOptBtn');

  Notification.requestPermission().then(perm => {
    if (perm === 'granted') {
      localStorage.setItem('km_notif_time', timeVal);
      const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, m, 0, 0);
      localStorage.setItem('km_notif_scheduled', d.toISOString());
      const label = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      if (btn)       { btn.textContent = `✓ Reminder set for ${label} tomorrow`; btn.disabled = true; btn.classList.add('notif-opted'); }
      if (timeInput) timeInput.disabled = true;
    } else if (btn) {
      btn.textContent = '🔕 Notifications blocked in browser settings';
      btn.disabled = true;
    }
  });
}

// ── App initialisation ────────────────────────────────────────────────────
setHeader();
cleanupOldData();
_checkPendingNotification();
_setupMyListDrag();

// ── DEBUG AGENT ──────────────────────────────────────────────────────────
window.debugAgent = {
  rerunAll: function() {
    console.log('[debugAgent] DOMContentLoaded: re-init app');
    setHeader();
    cleanupOldData();
    _checkPendingNotification();
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
  window.debugAgent.rerunAll();
});

// ── PWA service worker ────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .catch(err => console.warn('[SW] Registration failed:', err));
  });
}

// Re-render current tab after cloud login so pulled data is reflected
setPostAuthCallback(() => {
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
  else if (state.currentTab === 'home')   renderHome();
});

initCloud();
srsUpdateReviewCount();
history.scrollRestoration = 'manual';
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
