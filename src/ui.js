import { state } from './state.js';
import { todayStr, setStatus } from './utils.js';
import { CLOUD_ENABLED } from './config.js';
import { cloudSignIn, cloudUpdate } from './cloud.js';
import { saveDailyVocab } from './daily.js';
import { srsAddWords, srsUpdateReviewCount } from './srs.js';
import { renderVocab, applyLevelFilterUI, renderMyList, getAllSavedWords, updateSavedWordsMirror } from './vocab.js';
import { renderHome, renderStats } from './stats.js';
import { loadAndRender, loadAndRenderDelta, applyKanjiLevelFilterUI, getAllSavedKanjis, searchAndRenderKanji } from './kanji.js';
import { updateBiWeeklyBtn } from './biweekly.js';
import { renderExamTab } from './quiz.js';
import { t } from './i18n.js';

// ── Header greeting ───────────────────────────────────────────────────────
export function setHeader() {
  const now  = new Date();
  const days = t('days');
  const mons = t('months');
  document.getElementById('hDate').textContent =
    `${days[now.getDay()]}, ${mons[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
  const h = now.getHours();
  document.getElementById('hGreet').textContent =
    h < 12 ? t('greeting_morning')
  : h < 18 ? t('greeting_afternoon')
  :           t('greeting_evening');
}

// ── Tab switcher ──────────────────────────────────────────────────────────
export function switchTab(tab) {
  window.scrollTo({ top: 0, behavior: 'instant' });
  localStorage.setItem('km_tab', tab);
  state.currentTab = tab;
  document.getElementById('tabHome')  .classList.toggle('active', tab === 'home');
  document.getElementById('tabKanji') .classList.remove('active'); // merged into tabVocab
  document.getElementById('tabVocab') .classList.toggle('active', tab === 'vocab' || tab === 'kanji');
  document.getElementById('tabMyList').classList.toggle('active', tab === 'mylist');
  document.getElementById('tabExam')  .classList.toggle('active', tab === 'exam');
  document.getElementById('tabStats') .classList.toggle('active', tab === 'stats');
  // Update tabVocab icon/label to reflect current mode
  const _tabVocabBtn = document.getElementById('tabVocab');
  if (tab === 'kanji') {
    _tabVocabBtn.innerHTML = '漢<br><span class="tab-sub">Kanji</span>';
  } else if (tab === 'vocab') {
    _tabVocabBtn.innerHTML = '語<br><span class="tab-sub">Vocab</span>';
  }

  // Update the level-filter ⓘ button (shown only for kanji/vocab tabs)
  const infoBtn = document.getElementById('levelInfoBtn');
  if (infoBtn) {
    const isGrid = tab === 'kanji' || tab === 'vocab';
    infoBtn.style.display = isGrid ? '' : 'none';
    infoBtn.dataset.tab = tab;
  }
  // Always reset these — only shown explicitly in their own tab branch
  document.getElementById('btnMyListHint').style.display = 'none';
  document.getElementById('btnStatsHint').style.display  = 'none';

  const isHome   = tab === 'home';
  const isStats  = tab === 'stats';
  const isMyList = tab === 'mylist';
  const isExam   = tab === 'exam';
  const isHidden = isStats || isMyList || isHome || isExam;

  document.getElementById('homeSection').style.display   = isHome   ? 'flex'  : 'none';
  document.getElementById('grid').style.display          = isHidden ? 'none' : '';
  document.getElementById('statsSection').style.display  = isStats  ? 'block' : 'none';
  document.getElementById('mylistSection').style.display = isMyList ? 'block' : 'none';
  document.getElementById('examSection').style.display   = isExam   ? 'block' : 'none';
  document.getElementById('levelFilter').style.display   = isHidden ? 'none' : '';
  const _legend = document.getElementById('legendDiv'); if (_legend) _legend.style.display = isHidden ? 'none' : '';
  document.getElementById('searchWrap').style.display    = (isHidden || tab === 'vocab') ? 'none' : '';
  const si = document.getElementById('searchInput');
  if (si) { si.value = ''; filterGrid(''); }

  if (isHidden) {
    // Show toolbar but only with Bi-Weekly + Review buttons
    document.getElementById('btnRefresh').style.display      = 'none';
    document.getElementById('btnMore').style.display         = 'none';
    document.getElementById('btnLess').style.display         = 'none';
    document.getElementById('btnSave').style.display         = 'none';
    document.getElementById('btnDailyQuiz').style.display    = 'none';
    document.getElementById('btnFromKanji').style.display    = 'none';
    document.getElementById('btnExam').style.display         = 'none';
    document.getElementById('btnMyListHint').style.display   = 'none';
    document.getElementById('btnStatsHint').style.display    = 'none';
    updateBiWeeklyBtn();
    srsUpdateReviewCount();
  }

  if (isHome) {
    document.getElementById('btnBiweeklyQuiz').style.display = 'none';
    document.getElementById('hTitle').textContent = '朝の漢字';
    document.getElementById('hSub').textContent   = 'Morning Kanji · Daily Study';
    renderHome();
    return;
  }
  if (isStats) {
    document.getElementById('btnBiweeklyQuiz').style.display  = 'none';
    document.getElementById('btnStatsHint').style.display    = '';
    document.getElementById('hTitle').textContent = '進歩';
    document.getElementById('hSub').textContent   = t('sub_stats');
    renderStats();
    return;
  }
  if (isMyList) {
    document.getElementById('btnExam').style.display         = 'none';
    document.getElementById('btnBiweeklyQuiz').style.display = 'none';
    document.getElementById('btnMyListHint').style.display   = '';
    document.getElementById('hTitle').textContent = '単語リスト';
    document.getElementById('hSub').textContent   = t('sub_mylist');
    renderMyList();
    return;
  }
  if (isExam) {
    document.getElementById('btnBiweeklyQuiz').style.display = 'none';
    document.getElementById('hTitle').textContent = '試験モード';
    document.getElementById('hSub').textContent   = t('exam_mode_title');
    renderExamTab();
    return;
  }

  document.getElementById('hTitle').textContent = tab === 'kanji' ? '朝の漢字' : '朝の語彙';
  document.getElementById('hSub').textContent   = tab === 'kanji'
    ? t('sub_kanji') : t('sub_vocab');
  document.getElementById('tabLabel').textContent = tab === 'kanji' ? t('label_kanji') : t('label_vocabulary');

  // Reset quiz state
  state.quizState = null;

  if (tab === 'kanji') {
    document.getElementById('btnRefresh').style.display      = '';
    document.getElementById('btnSave').style.display         = 'none';
    document.getElementById('btnDailyQuiz').style.display    = 'none';
    document.getElementById('btnBiweeklyQuiz').style.display = 'none';
    document.getElementById('btnExam').style.display         = 'none';
    document.getElementById('btnMore').style.display         = '';
    document.getElementById('btnLess').style.display         = '';
    // Show toggle button pointing back to vocab mode
    const _fkBtn = document.getElementById('btnFromKanji');
    _fkBtn.style.display = '';
    _fkBtn.classList.remove('active');
    _fkBtn.textContent = '語彙';
    applyKanjiLevelFilterUI();
    loadAndRender(state.count);
    return;
  }

  // Vocab tab
  document.getElementById('btnRefresh').style.display       = '';
  document.getElementById('btnMore').style.display          = 'none';
  document.getElementById('btnLess').style.display          = 'none';
  document.getElementById('btnSave').style.display          = '';
  document.getElementById('levelFilter').style.display      = '';
  document.getElementById('btnDailyQuiz').style.display     = 'none';
  document.getElementById('btnExam').style.display          = 'none';
  document.getElementById('btnBiweeklyQuiz').style.display  = 'none';
  document.getElementById('btnSave').classList.remove('saved');
  document.getElementById('btnSave').textContent            = t('btn_save_quiz');
  document.getElementById('btnSave').disabled               = false;
  applyLevelFilterUI();
  // Toggle button: always visible in vocab tab, points to kanji mode
  const _fk = document.getElementById('btnFromKanji');
  _fk.style.display = '';
  _fk.classList.remove('active');
  _fk.textContent = '漢字';
  renderVocab();
}

// ── Save today's words ────────────────────────────────────────────────────
export function saveToday() {
  if (!state.currentVocabItems.length) return;

  // Free tier: 30-word hard limit
  if (!state.isPremium) {
    const existing = getAllSavedWords();
    if (existing.length >= 30) {
      window.openUpgradeModal('limit');
      return;
    }
  }
  if (CLOUD_ENABLED && !state._fbUser) {
    const go = confirm(t('confirm_signin'));
    if (go) { cloudSignIn(); return; }
  }

  const btn = document.getElementById('btnSave');
  const itemsToSave = state.currentVocabItems.map(item => ({
    word: item.word, reading: item.reading,
    meaning: item.meaning, pos: item.pos, level: item.level,
  }));

  saveDailyVocab(todayStr(), itemsToSave);
  updateSavedWordsMirror(itemsToSave, todayStr());
  btn.textContent = state._fbUser ? t('btn_saved_cloud') : t('btn_saved_local');
  btn.classList.add('saved');
  btn.disabled = true;

  const added = srsAddWords(itemsToSave);
  if (added > 0) {
    console.log(`[SRS] ${added} new card${added !== 1 ? 's' : ''} added to review deck.`);
    srsUpdateReviewCount();
  }

  setTimeout(() => {
    btn.textContent = t('btn_save_quiz');
    btn.classList.remove('saved');
    btn.disabled = false;
  }, 2000);
}

// ── Search / filter kanji & vocab grid ──────────────────────────────────
export function filterGrid(q) {
  if (state.currentTab !== 'kanji') return;
  searchAndRenderKanji(q); // async, promise ignored intentionally
}

// ── Refresh (new selection) ───────────────────────────────────────────────
export function refresh() {
  const si = document.getElementById('searchInput');
  if (si) { si.value = ''; filterGrid(''); }
  if (state.currentTab === 'kanji') { loadAndRender(state.count, true); return; }
  renderVocab(true);
}

// ── Count +/− (kanji tab only) ────────────────────────────────────────────
let _deltaInProgress = false;
export async function changeCount(delta) {
  if (state.currentTab === 'vocab') return;
  if (_deltaInProgress) return;
  const newCount = Math.max(1, Math.min(20, state.count + delta));
  if (newCount === state.count) return;
  const actualDelta = newCount - state.count;
  state.count = newCount;
  if (state.currentKanjiCards.length > 0) {
    _deltaInProgress = true;
    try {
      await loadAndRenderDelta(actualDelta);
    } finally {
      _deltaInProgress = false;
    }
  } else {
    loadAndRender(state.count, true);
  }
}

// ── Quiz mode toggle (kanji tab) — removed, kanji tab is browse-only now
