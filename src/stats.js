import { todayStr, dateStr } from './utils.js';
import { loadDailyVocab } from './daily.js';
import { loadQuizHistory } from './quiz.js';
import { getAllSavedWords } from './vocab.js';
import { getWordOfDay } from './wotd.js';
import { state } from './state.js';
import {
  getMissedBiWeeklyMonday, nextBiWeeklyMonday, isBiWeeklyMonday,
  isBiWeeklyDone, getLastBiWeeklyMonday,
} from './biweekly.js';
import { t } from './i18n.js';
import { getStreakTileView } from './main.js';
import { renderXPBarHTML, getCalendarBadge } from './xp.js';

// ── Unified studied-dates set (vocab_daily keys + quiz_history dates) ────
// vocab_daily keys can get evicted when localStorage is full, so we
// supplement with quiz_history which is a single compact key.
export function getStudiedDatesSet() {
  const dates = new Set();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('vocab_daily_')) dates.add(k.slice(12));
  }
  try {
    const history = JSON.parse(localStorage.getItem('quiz_history') || '[]');
    history.forEach(h => { if (h.date) dates.add(h.date); });
  } catch {}
  return dates;
}

// ── Streak & totals ───────────────────────────────────────────────────────
export function computeStreak() {
  const studied = getStudiedDatesSet();
  const today = new Date();
  const hasTodayData = studied.has(dateStr(today));
  let streak = 0;
  for (let i = hasTodayData ? 0 : 1; i < 366; i++) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    if (studied.has(dateStr(d))) streak++;
    else break;
  }
  return streak;
}

export function computeBestStreak() {
  const dates = [...getStudiedDatesSet()].sort();
  if (!dates.length) return 0;
  let best = 1, cur = 1;
  for (let i = 1; i < dates.length; i++) {
    const diff = Math.round(
      (new Date(dates[i] + 'T12:00:00') - new Date(dates[i - 1] + 'T12:00:00')) / 86400000
    );
    if (diff === 1) { cur++; if (cur > best) best = cur; } else cur = 1;
  }
  return best;
}

export function computeTotalWords() {
  return getAllSavedWords().length;
}

export function computeMonthlyCount() {
  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-`;
  const studied = getStudiedDatesSet();
  let count = 0;
  for (const ds of studied) { if (ds.startsWith(monthPrefix)) count++; }
  return count;
}

// ── Activity calendar & view switcher ────────────────────────────────────
let _calYear     = new Date().getFullYear();
let _calMonth    = new Date().getMonth(); // 0-indexed
let _studyVals14 = [];
let _studyLbls14 = [];
let _biweeklyHtml = '';

function renderActivityCalendar(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const today   = new Date();
  const todayDs = dateStr(today);
  const year    = _calYear;
  const month   = _calMonth;

  const monthNames = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
  const dowNames   = ['MON','TUE','WED','THU','FRI','SAT','SUN'];

  const firstDay    = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Monday-first offset: Mon=0 … Sun=6
  const firstDow = (firstDay.getDay() + 6) % 7;

  // Collect studied days in this month from both vocab_daily and quiz_history
  const allStudied = getStudiedDatesSet();
  const studiedSet = new Set();
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = dateStr(new Date(year, month, d));
    if (allStudied.has(ds)) studiedSet.add(d);
  }

  // 6 rows × 7 cols = 42 cells
  let cellsHtml = '';
  for (let i = 0; i < 42; i++) {
    const dayNum = i - firstDow + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      cellsHtml += `<div class="scal-cell scal-empty"></div>`;
    } else {
      const ds        = dateStr(new Date(year, month, dayNum));
      const isToday   = ds === todayDs;
      const isStudied = studiedSet.has(dayNum);
      let cls = 'scal-cell';
      if (isStudied) cls += ' scal-studied';
      if (isToday)   cls += ' scal-today';
      const inner = isStudied
        ? `<span class="scal-badge">${getCalendarBadge()}</span>`
        : dayNum;
      cellsHtml += `<div class="${cls}">${inner}</div>`;
    }
  }

  container.innerHTML = `
    <div class="scal">
      <div class="scal-nav">
        <button class="scal-arrow" id="scalPrev">&#8249;</button>
        <span class="scal-month-label">${monthNames[month]} ${year}</span>
        <button class="scal-arrow" id="scalNext">&#8250;</button>
      </div>
      <div class="scal-grid">
        ${dowNames.map(n => `<div class="scal-dow">${n}</div>`).join('')}
        ${cellsHtml}
      </div>
    </div>`;

  container.querySelector('#scalPrev').addEventListener('click', () => navActivityCal(-1));
  container.querySelector('#scalNext').addEventListener('click', () => navActivityCal(1));
}

export function navActivityCal(dir) {
  _calMonth += dir;
  if (_calMonth < 0)  { _calMonth = 11; _calYear--; }
  if (_calMonth > 11) { _calMonth = 0;  _calYear++; }
  renderActivityCalendar('activityCalContent');
}

function _activityTitle(view) {
  if (view === '1w')  return t('stats_chart_activity_1w');
  if (view === 'cal') return t('stats_chart_activity_cal');
  return t('stats_chart_activity');
}

export function setActivityView(view) {
  try { localStorage.setItem('km_activity_view', view); } catch (_) { /* quota full — ignore, still switch view */ }
  document.querySelectorAll('.activity-view-pill').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  const titleEl = document.querySelector('#activityChartBlock .chart-title');
  if (titleEl) titleEl.textContent = _activityTitle(view);
  _renderActivityContent(view);
}

function _renderActivityContent(view) {
  const el = document.getElementById('activityViewContent');
  if (!el) return;
  if (view === 'cal') {
    _calYear  = new Date().getFullYear();
    _calMonth = new Date().getMonth();
    el.innerHTML = `<div id="activityCalContent" style="margin-top:12px"></div>`;
    requestAnimationFrame(() => renderActivityCalendar('activityCalContent'));
  } else {
    const days = view === '1w' ? 7 : 14;
    const vals = _studyVals14.slice(-days);
    const lbls = _studyLbls14.slice(-days);
    el.innerHTML = `<canvas id="studyCanvas" class="chart-canvas"></canvas>${_biweeklyHtml}`;
    requestAnimationFrame(() => {
      const st = document.getElementById('studyCanvas');
      if (st) drawBarChart(st, vals, lbls);
    });
  }
}

// keep old name so nothing else breaks (unused but harmless)
function buildStreakDotsHtml(numDays) {
  const today = new Date();
  let html = `<div class="streak-dots-wide">`;
  for (let i = numDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const ds = dateStr(d);
    const done = !!localStorage.getItem(`vocab_daily_${ds}`);
    const isToday = ds === dateStr(today);
    const dowName = ['S','M','T','W','T','F','S'][d.getDay()];
    if (isToday && done) {
      html += `<span class="streak-dot-col"><span class="streak-dot streak-dot-flame">🔥</span><span class="streak-dot-day">${dowName}</span></span>`;
    } else {
      html += `<span class="streak-dot-col"><span class="streak-dot${done ? ' streak-dot-done' : ''}${isToday ? ' streak-dot-today' : ''}"></span><span class="streak-dot-day">${dowName}</span></span>`;
    }
  }
  html += `</div>`;
  return html;
}

function renderStreakHeatmap(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const DOW_W  = 16;
  const GAP    = 2;
  const CELL   = 11;
  const SLOT   = CELL + GAP;
  const containerW = container.offsetWidth || 300;
  const WEEKS  = Math.min(26, Math.max(4, Math.floor((containerW - DOW_W - 4) / SLOT)));
  const today  = new Date();

  const days = [];
  for (let i = WEEKS * 7 - 1; i >= 0; i--) {
    const d  = new Date(today);
    d.setDate(today.getDate() - i);
    const ds = dateStr(d);
    const saved = loadDailyVocab(ds);
    days.push({ ds, wordCount: saved ? saved.length : 0, dow: d.getDay(), month: d.getMonth(), isToday: ds === dateStr(today) });
  }

  const padBefore = days[0].dow;
  const totalWeeks = Math.ceil((padBefore + days.length) / 7);
  const cells = new Array(totalWeeks * 7).fill(null);
  days.forEach((day, i) => { cells[padBefore + i] = day; });

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthLabels = [];
  let prevMonth = -1;
  days.forEach((day, i) => {
    if (day.month !== prevMonth) {
      monthLabels.push({ label: monthNames[day.month], col: Math.floor((padBefore + i) / 7) });
      prevMonth = day.month;
    }
  });

  let cellsHtml = '';
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < totalWeeks; col++) {
      const cell = cells[col * 7 + row];
      if (!cell) {
        cellsHtml += `<span class="streak-cal-cell" style="opacity:0;width:${CELL}px;height:${CELL}px"></span>`;
      } else {
        const level = cell.wordCount === 0 ? 0 : cell.wordCount < 5 ? 1 : cell.wordCount < 10 ? 2 : cell.wordCount < 20 ? 3 : 4;
        const todayAttr = cell.isToday ? ' data-today="1"' : '';
        cellsHtml += `<span class="streak-cal-cell" data-level="${level}"${todayAttr} title="${cell.ds}: ${cell.wordCount} word${cell.wordCount !== 1 ? 's' : ''}" style="width:${CELL}px;height:${CELL}px"></span>`;
      }
    }
  }

  let monthHtml = `<div style="display:flex;font-size:9px;color:var(--muted);margin-bottom:3px;margin-left:${DOW_W + 2}px">`;
  let lastCol = 0;
  monthLabels.forEach(({ label, col }) => {
    const gap = col - lastCol;
    if (gap > 0) monthHtml += `<span style="min-width:${gap * SLOT}px;display:inline-block"></span>`;
    monthHtml += `<span style="min-width:${SLOT}px;display:inline-block">${label}</span>`;
    lastCol = col + 1;
  });
  monthHtml += '</div>';

  let dowHtml = `<div style="display:grid;grid-template-rows:repeat(7,${CELL}px);gap:${GAP}px;margin-right:${GAP}px;flex-shrink:0;width:${DOW_W}px">`;
  ['','M','','W','','F',''].forEach(n => {
    dowHtml += `<div style="font-size:8px;color:var(--muted);line-height:${CELL}px;text-align:right">${n}</div>`;
  });
  dowHtml += '</div>';

  container.innerHTML = `
    ${monthHtml}
    <div style="display:flex;align-items:flex-start;overflow:hidden">
      ${dowHtml}
      <div style="overflow:hidden">
        <div style="display:grid;grid-template-rows:repeat(7,${CELL}px);grid-template-columns:repeat(${totalWeeks},${CELL}px);gap:${GAP}px">
          ${cellsHtml}
        </div>
      </div>
    </div>`;
}

export function setStreakView(view) {
  localStorage.setItem('km_streak_view', view);
  document.querySelectorAll('.streak-view-pill').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  _renderStreakViewContent(view);
}

function _renderStreakViewContent(view) {
  const el = document.getElementById('streakViewContent');
  if (!el) return;
  if (view === 'cal') {
    el.innerHTML = '<div id="streakHeatmap" style="margin-top:10px"></div>';
    requestAnimationFrame(() => renderStreakHeatmap('streakHeatmap'));
  } else {
    el.innerHTML = `<div style="margin-top:10px">${buildStreakDotsHtml(view === '2w' ? 14 : 7)}</div>`;
  }
}

function setupCanvas(canvas) {
  const dpr    = window.devicePixelRatio || 1;
  const parent = canvas.parentElement;
  const style  = getComputedStyle(parent);
  const padH   = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const w      = Math.max(300, (parent.offsetWidth || 500) - padH);
  const h      = 200;
  canvas.width  = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width  = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, W: w, H: h };
}

function drawLineChart(canvas, values, labels) {
  const { ctx, W, H } = setupCanvas(canvas);
  const P = { t: 24, r: 20, b: 36, l: 44 };
  const cW = W - P.l - P.r, cH = H - P.t - P.b;
  ctx.clearRect(0, 0, W, H);

  if (!values.length) {
    ctx.fillStyle = '#aaa';
    ctx.font = '14px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No quiz data yet', W / 2, H / 2);
    return;
  }

  // Y grid at 0 / 25 / 50 / 75 / 100
  [0, 25, 50, 75, 100].forEach(v => {
    const y = P.t + cH - (v / 100) * cH;
    ctx.strokeStyle = '#ede3d8'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(P.l + cW, y); ctx.stroke();
    ctx.fillStyle = '#aaa'; ctx.font = '10px Segoe UI, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(v + '%', P.l - 6, y + 3.5);
  });

  const n   = values.length;
  const xOf = i => P.l + (n > 1 ? (i / (n - 1)) * cW : cW / 2);
  const yOf = v => P.t + cH - (v / 100) * cH;

  // Gradient fill
  const grad = ctx.createLinearGradient(0, P.t, 0, P.t + cH);
  grad.addColorStop(0, 'rgba(192,58,32,0.22)');
  grad.addColorStop(1, 'rgba(192,58,32,0)');
  ctx.beginPath();
  values.forEach((v, i) => i === 0 ? ctx.moveTo(xOf(i), yOf(v)) : ctx.lineTo(xOf(i), yOf(v)));
  ctx.lineTo(xOf(n - 1), P.t + cH);
  ctx.lineTo(xOf(0), P.t + cH);
  ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = '#c03a20'; ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  values.forEach((v, i) => i === 0 ? ctx.moveTo(xOf(i), yOf(v)) : ctx.lineTo(xOf(i), yOf(v)));
  ctx.stroke();

  // Dots
  values.forEach((v, i) => {
    ctx.beginPath(); ctx.arc(xOf(i), yOf(v), 4, 0, Math.PI * 2);
    ctx.fillStyle = '#c03a20'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  });

  // X labels
  ctx.fillStyle = '#aaa'; ctx.font = '10px Segoe UI, sans-serif'; ctx.textAlign = 'center';
  const step = n > 10 ? Math.ceil(n / 8) : 1;
  labels.forEach((lbl, i) => {
    if (i % step === 0 || i === n - 1) ctx.fillText(lbl, xOf(i), H - 6);
  });
}

function drawBarChart(canvas, values, labels) {
  const { ctx, W, H } = setupCanvas(canvas);
  const P = { t: 20, r: 16, b: 36, l: 36 };
  const cW = W - P.l - P.r, cH = H - P.t - P.b;
  ctx.clearRect(0, 0, W, H);

  const maxV = Math.max(...values, 1);
  const n    = values.length;
  const slot = cW / n;
  const barW = slot * 0.65;
  const offX = slot * 0.175;

  // Horizontal grid
  for (let i = 0; i <= 4; i++) {
    const y = P.t + cH - (i / 4) * cH;
    ctx.strokeStyle = '#ede3d8'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(P.l + cW, y); ctx.stroke();
  }

  values.forEach((v, i) => {
    const x  = P.l + i * slot + offX;
    const bH = Math.max(v > 0 ? 4 : 2, (v / maxV) * cH);
    const y  = P.t + cH - bH;
    const r  = Math.min(4, barW / 2, bH);

    ctx.fillStyle = v > 0 ? '#c03a20' : '#ede3d8';
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + barW - r, y);
    ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
    ctx.lineTo(x + barW, P.t + cH);
    ctx.lineTo(x, P.t + cH);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();

    if (v > 0) {
      ctx.fillStyle = '#444'; ctx.font = 'bold 9px Segoe UI, sans-serif';
      ctx.textAlign = 'center'; ctx.fillText(v, x + barW / 2, y - 3);
    }
    ctx.fillStyle = '#aaa'; ctx.font = '9px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(labels[i], x + barW / 2, H - 6);
  });
}

// ── Home panel ────────────────────────────────────────────────────────────
export function renderHome() {
  const stv         = getStreakTileView();
  const streak      = computeStreak();
  const best        = computeBestStreak();
  const total       = computeTotalWords();
  const monthlyCount = stv === 'month' ? computeMonthlyCount() : 0;
  const history     = loadQuizHistory().filter(h => (h.type || 'daily') !== 'exam');
  const avgScore    = history.length
    ? Math.round(history.reduce((s, h) => s + h.pct, 0) / history.length) : null;
  const todayWords  = loadDailyVocab(todayStr()) || [];
  const todayQuiz   = history.find(h => h.date === todayStr() && (h.type || 'daily') === 'daily') ?? null;
  const lastBiweekly = [...history].sort((a,b) => b.date.localeCompare(a.date)).find(h => h.type === 'biweekly') ?? null;

  const _now = new Date();
  const streakDots = Array.from({length: 7}, (_, i) => {
    const d = new Date(_now); d.setDate(_now.getDate() - (6 - i));
    const ds = dateStr(d);
    const done = !!localStorage.getItem(`vocab_daily_${ds}`);
    const isToday = ds === todayStr();
    if (isToday && done) return `<span class="streak-dot streak-dot-flame">🔥</span>`;
    return `<span class="streak-dot${done ? ' streak-dot-done' : ''}${isToday ? ' streak-dot-today' : ''}"></span>`;
  }).join('');

  const hour      = new Date().getHours();
  const greetWord = hour < 12 ? t('greeting_morning').replace(/^[^ ]+ /, '') : hour < 18 ? t('greeting_afternoon').replace(/^[^ ]+ /, '') : t('greeting_evening').replace(/^[^ ]+ /, '');

  // Use localised date string
  const localeDate = new Date().toLocaleDateString(
    { en:'en-US', fr:'fr-FR', es:'es-ES', de:'de-DE', ru:'ru-RU' }[
      localStorage.getItem('km_lang') || 'en'] || 'en-US',
    { weekday: 'long', day: 'numeric', month: 'long' }
  );

  const dailyAvailable    = todayWords.length > 0 && !todayQuiz;
  const biweeklyAvailable = isBiWeeklyMonday() && !isBiWeeklyDone(todayStr());
  const missedBiweekly    = getMissedBiWeeklyMonday();

  const jlptGoal = localStorage.getItem('km_jlpt_goal') || 'N3';
  const LEVELS   = ['N5', 'N4', 'N3', 'N2', 'N1'];
  const goalIdx  = LEVELS.indexOf(jlptGoal);
  const allowedLevels = new Set(LEVELS.slice(0, goalIdx + 1));
  const savedWords  = getAllSavedWords();
  const levelWords  = savedWords.filter(w => allowedLevels.has(w.level));
  const JLPT_TOTALS = { N5: 800, N4: 1500, N3: 3750, N2: 6000, N1: 10000 };
  const jlptPct    = Math.min(100, Math.round(levelWords.length / JLPT_TOTALS[jlptGoal] * 100));
  const wotd       = getWordOfDay();

  document.getElementById('homeSection').innerHTML = `
    <div class="home-hero">
      <div class="home-hero-kana">朝の漢字</div>
      <div class="home-hero-title">${t('home_tagline')}<br><strong style="font-size:1.15em">${t('home_tagline2')}</strong> ${t('home_tagline3')}</div>
      <div class="home-hero-sub">${t('home_sub')}</div>
      <div class="home-hero-actions">
        <button class="btn-white" onclick="switchTab('kanji')">${t('home_start_kanji')}</button>
        <button class="btn-outline" onclick="showTutorial()">${t('home_how_it_works')}</button>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card kpi-streak" onclick="cycleStreakTile()"><div class="kpi-num">${stv === 'month' ? monthlyCount : streak}</div><div class="kpi-lbl">${stv === 'month' ? t('kpi_streak_month') : t('kpi_streak')}</div>${stv === 'streak' ? `<div class="streak-dots">${streakDots}</div>` : ''}<div class="kpi-jlpt-hint">${t('kpi_streak_hint')}</div>${(state._fbAuthReady && !state._fbUser) ? `<div class="kpi-streak-nudge">${t('kpi_signin_sync')}</div>` : ''}</div>
      <div class="kpi-card"><div class="kpi-num">${total}</div><div class="kpi-lbl">${t('kpi_words')}</div></div>
      <div class="kpi-card kpi-wotd">
        <div class="kpi-wotd-banner">
          <div class="kpi-wotd-banner-emoji">${wotd.emoji}</div>
          <div class="kpi-wotd-banner-title">${t('kpi_today_word')}</div>
        </div>
        <div class="kpi-wotd-body">
          <div class="kpi-wotd-kanji">${wotd.word}</div>
          <div class="kpi-wotd-reading">${wotd.reading}</div>
          <div class="kpi-wotd-meaning">${wotd.meaning}</div>
          ${savedWords.some(w => w.word === wotd.word)
            ? `<div class="kpi-wotd-saved">✓ ${t('today_done').replace(' ✓','')}</div>`
            : `<button class="kpi-wotd-save-btn" onclick="saveWotd()">＋ ${t('today_done').replace('✓','').trim() || 'Save this word'}</button>`
          }
        </div>
      </div>
      <div class="kpi-card"><div class="kpi-num">${avgScore !== null ? avgScore + '%' : '—'}</div><div class="kpi-lbl">${t('kpi_avg_score')}</div></div>
      <div class="kpi-card kpi-jlpt" onclick="cycleJlptGoal()">
        <div class="kpi-num kpi-jlpt-level">${jlptGoal}</div>
        <div class="kpi-jlpt-pct">${jlptPct > 0 ? jlptPct + '%' : t('kpi_start_saving')}</div>
        <div class="kpi-lbl">${t('kpi_jlpt_target')}</div>
        <div class="kpi-jlpt-hint">${t('kpi_jlpt_tap')}</div>
        <div class="kpi-jlpt-sub">${{ N5: t('jlpt_n5'), N4: t('jlpt_n4'), N3: t('jlpt_n3'), N2: t('jlpt_n2'), N1: t('jlpt_n1') }[jlptGoal]}</div>
      </div>
    </div>

    <div class="home-today">
      ${renderXPBarHTML()}
      <div class="home-today-title" style="display:flex;align-items:center;gap:8px">${t('today_title')} <button class="section-hint-btn" onclick="showTabHint('home')" aria-label="How to use Home">i</button></div>
      <div class="home-today-row">
        <span>${t('today_words_loaded')} <span style="color:var(--muted);font-weight:400;font-size:12px">${t('today_words_sub')}</span></span>
        <span class="home-today-val ${todayWords.length > 0 ? 'good' : ''}">${todayWords.length > 0 ? t('home_words')(todayWords.length) + ' ✓' : t('today_not_loaded')}</span>
      </div>
      <div class="home-today-row">
        <span>${t('today_daily_quiz')}</span>
        <span class="home-today-val ${todayQuiz ? 'good' : ''}">${todayQuiz ? todayQuiz.pct + '% ✓' : t('today_not_done')}</span>
      </div>
      <div class="home-today-row">
        <span>${t('today_weekly')} <span style="color:var(--muted);font-weight:400;font-size:12px">${t('today_weekly_sub')}</span></span>
        <span class="home-today-val ${isBiWeeklyDone(todayStr()) ? 'good' : ''}">${(() => {
          if (isBiWeeklyDone(todayStr())) {
            const bwResult = [...loadQuizHistory()].sort((a,b) => b.date.localeCompare(a.date)).find(h => h.type === 'biweekly');
            return bwResult ? `${bwResult.score}/${bwResult.total} \u00b7 ${bwResult.pct}% \u2713` : t('today_done');
          }
          return biweeklyAvailable ? t('today_available') : missedBiweekly ? t('today_missed') : '\u2014';
        })()}</span>
      </div>
    </div>

    <div>
      <div class="home-today-title" style="margin-bottom:14px">${t('actions_title')}</div>
      <div class="home-actions">
        <div class="home-action-card" onclick="switchTab('kanji')">
          <div class="home-action-icon">漢</div>
          <div class="home-action-title">${t('tab_kanji')}</div>
          <div class="home-action-sub">${t('action_kanji_sub')}</div>
        </div>
        <div class="home-action-card" onclick="switchTab('vocab')">
          <div class="home-action-icon">語</div>
          <div class="home-action-title">${t('tab_vocab')}</div>
          <div class="home-action-sub">${t('action_vocab_sub')}</div>
        </div>
        <div class="home-action-card ${dailyAvailable ? '' : 'disabled'}" onclick="switchTab('vocab'); setTimeout(launchDailyQuiz, 200)">
          <div class="home-action-icon">試</div>
          <div class="home-action-title">${t('action_quiz_title')}</div>
          <div class="home-action-sub">${todayWords.length} ${t('today_words_ready_pl')}</div>
        </div>
        <div class="home-action-card ${biweeklyAvailable || missedBiweekly ? '' : 'disabled'}" onclick="launchBiWeeklyQuiz()">
          <div class="home-action-icon">週</div>
          <div class="home-action-title">${t('action_weekly_title')}</div>
          <div class="home-action-sub">${(() => {
            if (biweeklyAvailable) return t('action_weekly_available');
            if (missedBiweekly) return t('action_weekly_missed');
            const bwDone = isBiWeeklyDone(todayStr());
            if (bwDone) {
              const bwResult = loadQuizHistory().find(h => h.type === 'biweekly' && h.date === todayStr());
              return bwResult ? `${bwResult.score}/${bwResult.total} · ${bwResult.pct}%` : t('today_done');
            }
            return t('action_weekly_next') + ' ' + dateStr(nextBiWeeklyMonday());
          })()}</div>
        </div>
      </div>
    </div>

    ${!state.isPremium ? `
    <div class="upgrade-card">
      <div class="upgrade-card-left">
        <div class="upgrade-card-title">${t('upgrade_card_title')}</div>
        <div class="upgrade-card-desc">${t('upgrade_card_desc')}</div>
        <div class="upgrade-card-price">${t('upgrade_card_price')} <span>${t('upgrade_card_price_sub')}</span></div>
      </div>
      <button class="upgrade-card-btn" onclick="openUpgradeModal()">${t('upgrade_card_btn')}</button>
    </div>` : ''}
  `;
}

// ── Stats panel ───────────────────────────────────────────────────────────
export function renderStats() {
  const stv      = getStreakTileView();
  const allHistory = loadQuizHistory();
  const history  = allHistory.filter(h => (h.type || 'daily') !== 'exam'); // exclude exam from stats
  const streak   = computeStreak();
  const best     = computeBestStreak();
  const total    = computeTotalWords();
  const monthlyCount = stv === 'month' ? computeMonthlyCount() : 0;
  const avgScore = history.length
    ? Math.round(history.reduce((s, h) => s + h.pct, 0) / history.length) : null;

  const lastBiweekly = [...history].sort((a,b) => b.date.localeCompare(a.date)).find(h => h.type === 'biweekly') ?? null;
  console.log('[KM] renderStats — history length:', history.length, '| lastBiweekly:', lastBiweekly);
  const missedMon  = getMissedBiWeeklyMonday();
  const missedHtml = '';

  // Study activity last 14 days
  const studyVals = [], studyLbls = [], today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const saved = loadDailyVocab(dateStr(d));
    studyVals.push(saved ? saved.length : 0);
    studyLbls.push(`${d.getMonth() + 1}/${d.getDate()}`);
  }

  const recent    = [...history].sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0).slice(-20);
  const scoreVals = recent.map(h => h.pct);
  const scoreLbls = recent.map(h => {
    const d = new Date(h.date + 'T12:00:00');
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });

  const nextMon       = nextBiWeeklyMonday();
  const todayIsBiW    = isBiWeeklyMonday();
  const todayDone     = isBiWeeklyDone(todayStr());
  const biweeklyInfoHtml = todayIsBiW && !todayDone
    ? `<div style="font-size:13px;color:#2e7d32;font-weight:700;padding:10px 0 0">
        ${t('stats_biw_today')}
       </div>`
    : `<div style="font-size:12px;color:var(--muted);padding:10px 0 0">
        ${t('stats_next_challenge')} <strong>${dateStr(nextMon)}</strong>
       </div>`;

  _studyVals14  = studyVals;
  _studyLbls14  = studyLbls;
  _biweeklyHtml = biweeklyInfoHtml;
  const av = localStorage.getItem('km_activity_view') || '2w';

  document.getElementById('statsSection').innerHTML = `
    <div class="stats-container">
      ${(() => {
        const u = state._fbUser;
        if (!u) return '';
        const av = u.photoURL
          ? `<img src="${u.photoURL}" class="stats-user-avatar" referrerpolicy="no-referrer" alt="">`
          : `<span class="stats-user-fallback">${(u.displayName||'?')[0].toUpperCase()}</span>`;
        const grains = parseInt(localStorage.getItem('km_xp_grains')||'0',10);
        return `<div class="stats-user-row"><div><div class="stats-user-name">${u.displayName?.split(' ')[0]||''}</div><div class="stats-user-grains">🫘 ${grains} grain${grains!==1?'s':''}</div></div>${av}</div>`;
      })()}
      ${renderXPBarHTML()}
      ${missedHtml}
      <div class="kpi-grid kpi-grid-2col">
        <div class="kpi-card kpi-streak" onclick="cycleStreakTile()"><div class="kpi-num">${stv === 'month' ? monthlyCount : streak}</div><div class="kpi-lbl">${stv === 'month' ? t('kpi_streak_month') : t('stats_kpi_streak')}</div><div class="kpi-jlpt-hint">${t('kpi_streak_hint')}</div></div>
        <div class="kpi-card"><div class="kpi-num">${total}</div><div class="kpi-lbl">${t('stats_kpi_words')}</div></div>
        <div class="kpi-card"><div class="kpi-num">${avgScore !== null ? avgScore + '%' : '—'}</div><div class="kpi-lbl">${t('stats_kpi_avg')}</div></div>
        <div class="kpi-card kpi-jlpt" onclick="cycleJlptGoal()">
          <div class="kpi-num kpi-jlpt-level">${localStorage.getItem('km_jlpt_goal') || 'N3'}</div>
          <div class="kpi-jlpt-pct">${(() => { const g = localStorage.getItem('km_jlpt_goal')||'N3'; const jlptLimits={N5:800,N4:1500,N3:3750,N2:6000,N1:10000}; const all=getAllSavedWords(); const idx=['N5','N4','N3','N2','N1'].indexOf(g); const allowed=new Set(['N5','N4','N3','N2','N1'].slice(0,idx+1)); const pct=Math.min(100,Math.round(all.filter(w=>allowed.has(w.level)).length/jlptLimits[g]*100)); return pct > 0 ? pct + '%' : t('stats_jlpt_start'); })()}</div>
          <div class="kpi-lbl">${t('stats_kpi_jlpt')}</div>
          <div class="kpi-jlpt-hint">${t('stats_jlpt_hint')}</div>
        </div>
      </div>

      <div class="chart-block">
        <div class="chart-title">${t('stats_chart_scores')}</div>
        ${history.length ? `<canvas id="scoreCanvas" class="chart-canvas"></canvas>` : `<div class="stats-empty-chart"><span>📊</span>${t('stats_no_quiz_title')}</div>`}
      </div>

      <div class="chart-block" id="activityChartBlock">
        <div class="streak-cal-header">
          <span class="chart-title" style="margin:0">${_activityTitle(av)}</span>
          <div class="streak-view-pills">
            <button class="pill activity-view-pill${av === '1w' ? ' active' : ''}" data-view="1w" onclick="setActivityView('1w')">1W</button>
            <button class="pill activity-view-pill${av === '2w' ? ' active' : ''}" data-view="2w" onclick="setActivityView('2w')">2W</button>
            <button class="pill activity-view-pill${av === 'cal' ? ' active' : ''}" data-view="cal" onclick="setActivityView('cal')">Calendar</button>
          </div>
        </div>
        <div id="activityViewContent"></div>
      </div>

      <div class="chart-block">
        <div class="chart-title">${t('stats_chart_recent')}</div>
        ${history.length ? `<div class="qh-list">
          ${[...history].sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0).reverse().slice(0, 15).map(h => {
            const qtype = h.type || 'daily';
            const badge = qtype === 'biweekly'
              ? '<span class="qh-type qh-type-biweekly">Bi-Weekly</span>'
              : qtype === 'srs'
              ? '<span class="qh-type qh-type-srs">SRS</span>'
              : '<span class="qh-type qh-type-daily">Daily</span>';
            return `
            <div class="qh-row">
              <span class="qh-date">${h.date}${badge}</span>
              <div class="qh-bar-wrap"><div class="qh-bar" style="width:${h.pct}%"></div></div>
              <span class="qh-score">${h.score}/${h.total} <span class="qh-pct">(${h.pct}%)</span></span>
            </div>`;
          }).join('')}
        </div>` : `<div class="stats-empty-chart"><span>📅</span>${t('stats_no_quiz_body')}</div>`}
      </div>

      ${lastBiweekly ? `
      <div class="chart-block">
        <div class="chart-title" style="display:flex;align-items:center;justify-content:space-between">
          <span>${t('action_weekly_title')}</span>
          <span style="font-size:11px;color:var(--muted);font-weight:500">${lastBiweekly.date}</span>
        </div>
        <div style="display:flex;align-items:center;gap:16px;margin-top:12px">
          <div>
            <div style="font-size:40px;font-weight:900;color:var(--red);line-height:1">${lastBiweekly.pct}%</div>
            <div style="font-size:12px;color:var(--muted);margin-top:4px">${lastBiweekly.score} / ${lastBiweekly.total} ${t('today_words_ready_pl')}</div>
          </div>
          <div class="qh-bar-wrap" style="flex:1;height:10px">
            <div class="qh-bar" style="width:${lastBiweekly.pct}%;height:10px"></div>
          </div>
        </div>
      </div>` : ''}
    </div>`;

  const statsEl = document.getElementById('statsSection');

  // Wire pills immediately — buttons are now in the DOM
  statsEl.querySelectorAll('.activity-view-pill').forEach(btn => {
    btn.addEventListener('click', () => setActivityView(btn.dataset.view));
  });

  requestAnimationFrame(() => {
    const sc = document.getElementById('scoreCanvas');
    if (sc) drawLineChart(sc, scoreVals, scoreLbls);
    _renderActivityContent(av);
  });
}
