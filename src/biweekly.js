import { dateStr, todayStr } from './utils.js';
import { cloudUpdate } from './cloud.js'; // circular ok

// ── Schedule helpers — every Monday ───────────────────────────────────────
export function isBiWeeklyMonday() {
  return new Date().getDay() === 1;
}

export function getLastBiWeeklyMonday() {
  const today = new Date();
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const day = d.getDay(); // 0=Sun,1=Mon,...,6=Sat
  const diff = day === 1 ? 0 : day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d;
}

export function nextBiWeeklyMonday() {
  const d = getLastBiWeeklyMonday();
  d.setDate(d.getDate() + 7);
  return d;
}

// ── Done markers ──────────────────────────────────────────────────────────
export function saveBiWeeklyDone(ds) {
  try { localStorage.setItem(`biweekly_done_${ds}`, '1'); } catch {}
  cloudUpdate({ biweeklyDone: { [ds]: true } });
}
export function isBiWeeklyDone(ds) {
  if (localStorage.getItem(`biweekly_done_${ds}`)) return true;
  // Fallback: check this week's Monday key
  const mondayKey = dateStr(getLastBiWeeklyMonday());
  return mondayKey !== ds && !!localStorage.getItem(`biweekly_done_${mondayKey}`);
}

// Returns last Monday that was MISSED (not done and already past)
export function getMissedBiWeeklyMonday() {
  const today     = new Date();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const lastMon   = getLastBiWeeklyMonday();
  if (lastMon.getTime() === todayDate.getTime()) return null; // today IS Monday
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
  btn.title = available ? '' : `Next Weekly Challenge: ${dateStr(nextBiWeeklyMonday())}`;
}
