import { CLOUD_ENABLED } from './config.js';
import { dateStr, todayStr } from './utils.js';
import { state } from './state.js';
import { cloudUpdate } from './cloud.js'; // circular ok — only called inside function bodies
import { markWordsLearned } from './learned.js';

// ── Persistence ───────────────────────────────────────────────────────────
export function saveDailyVocab(date, items) {
  const existing     = loadDailyVocab(date) || [];
  const existingWords = new Set(existing.map(i => i.word));
  const merged       = [...existing, ...items.filter(i => !existingWords.has(i.word))];

  // Cloud is source of truth — push merged list
  if (CLOUD_ENABLED && state._fbUser) {
    cloudUpdate({ dailyWords: { [date]: merged } });
  }

  // localStorage as local cache — best effort
  try {
    localStorage.setItem(`vocab_daily_${date}`, JSON.stringify(merged));
  } catch {
    // Storage full — evict API caches and retry
    const keysToDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('kanji_') || k.startsWith('words_'))) keysToDelete.push(k);
    }
    keysToDelete.forEach(k => localStorage.removeItem(k));
    try {
      localStorage.setItem(`vocab_daily_${date}`, JSON.stringify(merged));
    } catch {
      console.warn('[saveDailyVocab] localStorage full, saved to cloud only.');
    }
  }

  markWordsLearned(items);
}

export function loadDailyVocab(date) {
  try {
    const raw = localStorage.getItem(`vocab_daily_${date}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ── Cleanup old biweekly markers (>30 days) ───────────────────────────────
export function cleanupOldData() {
  const today        = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);

  const keysToDelete = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (k.startsWith('biweekly_done_')) {
      const itemDate = new Date(k.slice(14) + 'T12:00:00');
      if (itemDate < thirtyDaysAgo) keysToDelete.push(k);
    }
  }
  keysToDelete.forEach(k => localStorage.removeItem(k));
}

// ── Date window for bi-weekly quiz ───────────────────────────────────────
export function getQuizDates() {
  const today = new Date();
  const dates = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    dates.push(dateStr(d));
  }
  return dates;
}
