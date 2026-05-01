import { state }                                               from './state.js';
import { cleanupOldData }                                       from './daily.js';
import { initCloud, setPostAuthCallback, cloudSignIn, cloudSignOut } from './cloud.js';
import { srsUpdateReviewCount, rateSrsCard } from './srs.js';
import { switchTab, saveToday, refresh, changeCount, setHeader } from './ui.js';
import { setVocabLevel, renderVocab, renderMyList, filterMyList, removeFromMyList, removeSelectedWords, toggleFromKanji } from './vocab.js';
import { renderStats, renderHome }                              from './stats.js';
import { launchDailyQuiz, launchBiWeeklyQuiz, handleQuizAnswer, launchExamMode } from './quiz.js';
import { setKanjiLevel, removeKanjiFromSaved, removeSelectedKanjis, bestExamples } from './kanji.js';
import { getKanjiDetail, getWords }                             from './api.js';

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

// close popup on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeKanjiDetail();
    closeTutorial();
    closeSettings();
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
  launchExamMode,

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

// ── Settings ──────────────────────────────────────────────────────────────
function openSettings() {
  console.log('[openSettings] called');
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

// Log global errors
window.onerror = function(msg, url, line, col, error) {
  console.error('[debugAgent] JS ERROR:', msg, url, line, col, error);
  alert('JS ERROR: ' + msg + '\n' + url + ':' + line);
};
window.onunhandledrejection = function(e) {
  console.error('[debugAgent] Unhandled promise rejection:', e.reason);
  alert('Promise ERROR: ' + e.reason);
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
switchTab('home');




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
