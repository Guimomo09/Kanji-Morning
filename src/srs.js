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

export function srsUpdateReviewCount() {} // no-op — SRS is now embedded in daily quiz

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

// ── Session launcher ─────────────────────────────────────────────────────
// SRS cards are now silently injected into the daily quiz — no separate launcher needed.

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
