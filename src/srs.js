import { state } from './state.js';
import { todayStr, dateStr, setStatus } from './utils.js';
import { CLOUD_ENABLED } from './config.js';
import { cloudUpdate } from './cloud.js';
import { startVocabQuiz, renderQuizQuestion } from './quiz.js';

// ── Storage ───────────────────────────────────────────────────────────────
export function srsLoad() {
  try { const r = localStorage.getItem('srs_cards'); return r ? JSON.parse(r) : {}; }
  catch { return {}; }
}

export function srsSave(cards) {
  try { localStorage.setItem('srs_cards', JSON.stringify(cards)); } catch {}
  if (CLOUD_ENABLED && state._fbUser) cloudUpdate({ srsCards: cards });
}

// ── Deck management ───────────────────────────────────────────────────────
export function srsAddWords(items) {
  const cards = srsLoad();
  const today = todayStr();
  let added = 0;
  items.forEach(it => {
    if (!cards[it.word]) {
      cards[it.word] = {
        word: it.word, reading: it.reading || '', meaning: it.meaning,
        pos: it.pos || '', level: it.level,
        interval: 1, ef: 2.5, nextReview: today, reps: 0,
      };
      added++;
    }
  });
  if (added > 0) srsSave(cards);
  return added;
}

export function srsDueCards() {
  const cards = srsLoad();
  const today = todayStr();
  return Object.values(cards)
    .filter(c => c.nextReview <= today)
    .sort((a, b) => a.nextReview.localeCompare(b.nextReview));
}

export function srsUpdateReviewCount() {
  const btn = document.getElementById('btnReview');
  const cnt = document.getElementById('reviewCount');
  if (!btn) return;
  const due = srsDueCards().length;
  if (cnt) cnt.textContent = due;
  // Only control visibility on tabs where the button should appear
  const onAllowedTab = ['home', 'stats', 'mylist'].includes(state.currentTab);
  if (onAllowedTab) btn.style.display = due > 0 ? '' : 'none';
}

// ── SM-2 / Simple algorithm ───────────────────────────────────────────────
// grade: 0=Again  1=Hard  2=Good  3=Easy
export function srsNextState(card, grade, algo) {
  let { interval, ef, reps } = card;
  reps++;

  if (algo === 'sm2') {
    const q = [0, 2, 4, 5][grade];   // map 4-point scale → SM-2 quality
    if (q < 3) {
      interval = 1; reps = 0;
    } else {
      if (reps === 1)      interval = 1;
      else if (reps === 2) interval = 6;
      else                 interval = Math.round(interval * ef);
      ef = Math.max(1.3, ef + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    }
  } else {
    // Simple fixed intervals
    const INTERVALS   = [0, 1, 3, 7];
    const MULTIPLIERS = [1, 1.2, 2, 3];
    if (grade === 0) {
      interval = 1; reps = 0;
    } else {
      interval = Math.max(INTERVALS[grade], Math.round(interval * MULTIPLIERS[grade]));
    }
  }

  const next = new Date();
  next.setDate(next.getDate() + Math.round(interval));
  return { interval, ef, reps, nextReview: dateStr(next) };
}

export function srsIntervalLabel(card, grade, algo) {
  const { interval } = srsNextState(card, grade, algo);
  if (interval === 0) return 'now';
  if (interval === 1) return '1d';
  return interval + 'd';
}

// ── Session launcher ──────────────────────────────────────────────────────
export function launchSrsReview() {
  const due = srsDueCards();
  if (!due.length) { setStatus('ok', 'No cards due — come back later!'); return; }

  const backdrop = document.createElement('div');
  backdrop.className = 'srs-modal-backdrop';
  backdrop.innerHTML = `
    <div class="srs-modal">
      <h2>⏱ Spaced Repetition</h2>
      <p>${due.length} card${due.length !== 1 ? 's' : ''} to review today.<br>Choose your review algorithm:</p>
      <div class="srs-modal-btns">
        <button class="srs-modal-btn" onclick="_startSrsSession('simple')">
          Simple intervals
          <span>Again · Hard (1d) · Good (3d) · Easy (7d) — best for beginners</span>
        </button>
        <button class="srs-modal-btn" onclick="_startSrsSession('sm2')">
          SM-2 (Anki algorithm)
          <span>Adaptive intervals based on your performance — recommended</span>
        </button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  window._srsBackdrop = backdrop;
}

export function _startSrsSession(algo) {
  if (window._srsBackdrop) { window._srsBackdrop.remove(); window._srsBackdrop = null; }
  state._srsAlgo  = algo;
  state.currentTab = 'vocab';

  // Switch the view to show the grid (avoid circular import by doing minimal inline DOM work)
  ['homeSection', 'statsSection', 'mylistSection'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const grid = document.getElementById('grid');
  if (grid) grid.style.display = '';
  ['tabHome','tabKanji','tabMyList','tabStats'].forEach(id =>
    document.getElementById(id)?.classList.remove('active')
  );
  document.getElementById('tabVocab')?.classList.add('active');
  document.getElementById('levelFilter').style.display = 'none';
  document.getElementById('legendDiv').style.display   = 'none';

  const btnReview = document.getElementById('btnReview');
  if (btnReview) btnReview.style.display = 'none';

  const due = srsDueCards();
  setStatus('ok', `SRS Review · ${due.length} card${due.length !== 1 ? 's' : ''} due · ${algo === 'sm2' ? 'SM-2' : 'Simple'}`);
  startVocabQuiz(due, `${due.length} due`, 'srs');
}

export function rateSrsCard(word, grade) {
  const cards = srsLoad();
  if (cards[word]) {
    Object.assign(cards[word], srsNextState(cards[word], grade, state._srsAlgo));
    srsSave(cards);
  }
  state.quizState.current++;
  renderQuizQuestion();
}

// ── Cloud pull (called from cloud.js on login) ────────────────────────────
export async function _cloudPullSrs(data) {
  if (!data.srsCards) return;
  const local  = srsLoad();
  let merged   = false;
  Object.entries(data.srsCards).forEach(([word, cloudCard]) => {
    if (!local[word] || cloudCard.nextReview > local[word].nextReview) {
      local[word] = cloudCard;
      merged = true;
    }
  });
  if (merged) try { localStorage.setItem('srs_cards', JSON.stringify(local)); } catch {}
}
