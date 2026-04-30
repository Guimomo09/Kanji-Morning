import { BIWEEKLY_EPOCH } from './config.js';
import { dateStr, todayStr } from './utils.js';
import { cloudUpdate } from './cloud.js'; // circular ok

// ── Schedule helpers ──────────────────────────────────────────────────────
function _biWeeklyMonday(periodOffset) {
  const d = new Date(BIWEEKLY_EPOCH);
  d.setDate(d.getDate() + periodOffset * 14);
  return d;
}

function _currentPeriod() {
  const today = new Date();
  const ms    = new Date(today.getFullYear(), today.getMonth(), today.getDate()) - BIWEEKLY_EPOCH;
  return Math.max(0, Math.floor(ms / (14 * 86400000)));
}

export function isBiWeeklyMonday() {
  const today = new Date();
  if (today.getDay() !== 1) return false;
  const ms = new Date(today.getFullYear(), today.getMonth(), today.getDate()) - BIWEEKLY_EPOCH;
  return ms >= 0 && ms % (14 * 86400000) === 0;
}

export function getLastBiWeeklyMonday() { return _biWeeklyMonday(_currentPeriod()); }
export function nextBiWeeklyMonday()    { return _biWeeklyMonday(_currentPeriod() + 1); }

// ── Done markers ──────────────────────────────────────────────────────────
export function saveBiWeeklyDone(ds) {
  try { localStorage.setItem(`biweekly_done_${ds}`, '1'); } catch {}
  cloudUpdate({ biweeklyDone: { [ds]: true } });
}
export function isBiWeeklyDone(ds) {
  return !!localStorage.getItem(`biweekly_done_${ds}`);
}

// Returns the last bi-weekly Monday that was MISSED (not done and already past)
export function getMissedBiWeeklyMonday() {
  const today     = new Date();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const lastMon   = getLastBiWeeklyMonday();
  if (lastMon.getTime() === todayDate.getTime()) return null; // today IS the day
  return isBiWeeklyDone(dateStr(lastMon)) ? null : lastMon;
}

// ── UI sync ───────────────────────────────────────────────────────────────
export function updateBiWeeklyBtn() {
  const btn = document.getElementById('btnBiweeklyQuiz');
  if (!btn) return;
  const available = isBiWeeklyMonday() && !isBiWeeklyDone(todayStr());
  btn.style.display = '';
  btn.disabled = !available;
  btn.classList.toggle('btn-locked', !available);
  btn.title = available ? '' : `Next bi-weekly quiz: ${dateStr(nextBiWeeklyMonday())}`;
}
