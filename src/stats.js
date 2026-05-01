import { todayStr, dateStr } from './utils.js';
import { loadDailyVocab } from './daily.js';
import { loadQuizHistory } from './quiz.js';
import { getAllSavedWords } from './vocab.js';
import { getWordOfDay } from './wotd.js';
import {
  getMissedBiWeeklyMonday, nextBiWeeklyMonday, isBiWeeklyMonday,
  isBiWeeklyDone, getLastBiWeeklyMonday,
} from './biweekly.js';

// ── Streak & totals ───────────────────────────────────────────────────────
export function computeStreak() {
  const today = new Date();
  const hasTodayData = !!localStorage.getItem(`vocab_daily_${dateStr(today)}`);
  let streak = 0;
  for (let i = hasTodayData ? 0 : 1; i < 366; i++) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    if (localStorage.getItem(`vocab_daily_${dateStr(d)}`)) streak++;
    else break;
  }
  return streak;
}

export function computeBestStreak() {
  const dates = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('vocab_daily_')) dates.push(k.slice(12));
  }
  if (!dates.length) return 0;
  dates.sort();
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
  const seen = new Set();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith('vocab_daily_')) continue;
    try {
      const items = JSON.parse(localStorage.getItem(k));
      if (Array.isArray(items)) items.forEach(it => seen.add(it.word));
    } catch {}
  }
  return seen.size;
}

// ── Canvas helpers ────────────────────────────────────────────────────────
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
  grad.addColorStop(0, 'rgba(183,28,28,0.22)');
  grad.addColorStop(1, 'rgba(183,28,28,0)');
  ctx.beginPath();
  values.forEach((v, i) => i === 0 ? ctx.moveTo(xOf(i), yOf(v)) : ctx.lineTo(xOf(i), yOf(v)));
  ctx.lineTo(xOf(n - 1), P.t + cH);
  ctx.lineTo(xOf(0), P.t + cH);
  ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = '#b71c1c'; ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  values.forEach((v, i) => i === 0 ? ctx.moveTo(xOf(i), yOf(v)) : ctx.lineTo(xOf(i), yOf(v)));
  ctx.stroke();

  // Dots
  values.forEach((v, i) => {
    ctx.beginPath(); ctx.arc(xOf(i), yOf(v), 4, 0, Math.PI * 2);
    ctx.fillStyle = '#b71c1c'; ctx.fill();
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

    ctx.fillStyle = v > 0 ? '#b71c1c' : '#ede3d8';
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
  const streak      = computeStreak();
  const best        = computeBestStreak();
  const total       = computeTotalWords();
  const history     = loadQuizHistory();
  const avgScore    = history.length
    ? Math.round(history.reduce((s, h) => s + h.pct, 0) / history.length) : null;
  const todayWords  = loadDailyVocab(todayStr()) || [];
  const lastQuiz    = history.length ? history[history.length - 1] : null;
  const todayQuiz   = lastQuiz && lastQuiz.date === todayStr() ? lastQuiz : null;

  const hour      = new Date().getHours();
  const greetWord = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

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
      <div class="home-hero-title">10 words every morning.<br><strong style="font-size:1.15em">7 minutes.</strong> That's all it takes.</div>
      <div class="home-hero-sub">kanji · vocabulary · smart daily review · offline</div>
      <div class="home-hero-actions">
        <button class="btn-white" onclick="switchTab('kanji')">Start Today's Kanji →</button>
        <button class="btn-outline" onclick="showTutorial()">How it works</button>
      </div>
    </div>

    <div>
      <div class="home-greeting">${greetWord} <span>👋</span></div>
      <div class="home-sub">${new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-num">${streak}</div><div class="kpi-lbl">🔥 Day Streak</div></div>
      <div class="kpi-card"><div class="kpi-num">${total}</div><div class="kpi-lbl">📖 Words Learned</div></div>
      <div class="kpi-card kpi-wotd">
        <div class="kpi-wotd-banner">
          <div class="kpi-wotd-banner-emoji">${wotd.emoji}</div>
          <div class="kpi-wotd-banner-title">Today's Word</div>
        </div>
        <div class="kpi-wotd-body">
          <div class="kpi-wotd-kanji">${wotd.word}</div>
          <div class="kpi-wotd-reading">${wotd.reading}</div>
          <div class="kpi-wotd-meaning">${wotd.meaning}</div>
        </div>
      </div>
      <div class="kpi-card"><div class="kpi-num">${avgScore !== null ? avgScore + '%' : '—'}</div><div class="kpi-lbl">🎯 Avg Score</div></div>
      <div class="kpi-card kpi-jlpt" onclick="cycleJlptGoal()">
        <div class="kpi-num kpi-jlpt-level">${jlptGoal}</div>
        <div class="kpi-jlpt-pct">${jlptPct}%</div>
        <div class="kpi-lbl">🎌 JLPT Target</div>
        <div class="kpi-jlpt-hint">tap to change ↻</div>
      </div>
    </div>

    <div class="home-today">
      <div class="home-today-title">Today</div>
      <div class="home-today-row">
        <span>Words loaded <span style="color:var(--muted);font-weight:400;font-size:12px">(today's set)</span></span>
        <span class="home-today-val ${todayWords.length > 0 ? 'good' : ''}">${todayWords.length > 0 ? todayWords.length + ' words ✓' : 'Not loaded yet'}</span>
      </div>
      <div class="home-today-row">
        <span>Daily Quiz</span>
        <span class="home-today-val ${todayQuiz ? 'good' : ''}">${todayQuiz ? todayQuiz.pct + '% ✓' : 'Not done yet'}</span>
      </div>
      <div class="home-today-row">
        <span>Weekly Challenge <span style="color:var(--muted);font-weight:400;font-size:12px">(every Monday)</span></span>
        <span class="home-today-val ${isBiWeeklyDone(todayStr()) ? 'good' : ''}">${isBiWeeklyDone(todayStr()) ? 'Done ✓' : biweeklyAvailable ? '⏰ Available today!' : missedBiweekly ? '⚠️ Missed' : '—'}</span>
      </div>
    </div>

    <div>
      <div class="home-today-title" style="margin-bottom:14px">Quick actions</div>
      <div class="home-actions">
        <div class="home-action-card" onclick="switchTab('kanji')">
          <div class="home-action-icon">漢</div>
          <div class="home-action-title">Kanji</div>
          <div class="home-action-sub">Morning study</div>
        </div>
        <div class="home-action-card" onclick="switchTab('vocab')">
          <div class="home-action-icon">語</div>
          <div class="home-action-title">Vocabulary</div>
          <div class="home-action-sub">Save new words</div>
        </div>
        <div class="home-action-card ${dailyAvailable ? '' : 'disabled'}" onclick="switchTab('vocab'); setTimeout(launchDailyQuiz, 200)">
          <div class="home-action-icon">試</div>
          <div class="home-action-title">Daily Quiz</div>
          <div class="home-action-sub">${todayWords.length} word${todayWords.length !== 1 ? 's' : ''} ready</div>
        </div>
        <div class="home-action-card ${biweeklyAvailable || missedBiweekly ? '' : 'disabled'}" onclick="launchBiWeeklyQuiz()">
          <div class="home-action-icon">週</div>
          <div class="home-action-title">Weekly Challenge</div>
          <div class="home-action-sub">${biweeklyAvailable ? 'Available today!' : missedBiweekly ? 'Missed — catch up!' : 'Next: ' + dateStr(nextBiWeeklyMonday())}</div>
        </div>
      </div>
    </div>`;
}

// ── Stats panel ───────────────────────────────────────────────────────────
export function renderStats() {
  const history  = loadQuizHistory();
  const streak   = computeStreak();
  const best     = computeBestStreak();
  const total    = computeTotalWords();
  const avgScore = history.length
    ? Math.round(history.reduce((s, h) => s + h.pct, 0) / history.length) : null;

  const missedMon  = getMissedBiWeeklyMonday();
  const missedHtml = missedMon ? `
    <div class="stat-notif">
      <div class="stat-notif-icon">⏰</div>
      <div class="stat-notif-body">
        <div class="stat-notif-title">Weekly Challenge missed!</div>
        <div class="stat-notif-sub">
          Your weekly review for <strong>${dateStr(missedMon)}</strong> has not been completed yet.<br>
          The next scheduled date is <strong>${dateStr(nextBiWeeklyMonday())}</strong>.
        </div>
        <button class="btn btn-quiz" onclick="launchBiWeeklyQuiz()" style="font-size:13px;padding:8px 18px">
          Catch Up Now
        </button>
      </div>
    </div>` : '';

  // Study activity last 14 days
  const studyVals = [], studyLbls = [], today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const saved = loadDailyVocab(dateStr(d));
    studyVals.push(saved ? saved.length : 0);
    studyLbls.push(`${d.getMonth() + 1}/${d.getDate()}`);
  }

  const recent    = history.slice(-20);
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
        📅 Weekly Challenge is available <strong>today</strong>! Go to Vocabulary tab.
       </div>`
    : `<div style="font-size:12px;color:var(--muted);padding:10px 0 0">
        Next Weekly Challenge: <strong>${dateStr(nextMon)}</strong>
       </div>`;

  document.getElementById('statsSection').innerHTML = `
    <div class="stats-container">
      ${missedHtml}
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-num">${streak}</div><div class="kpi-lbl">🔥 Day Streak</div></div>
        <div class="kpi-card"><div class="kpi-num">${best}</div><div class="kpi-lbl">🏆 Best Streak</div></div>
        <div class="kpi-card"><div class="kpi-num">${total}</div><div class="kpi-lbl">📖 Words Learned</div></div>
        <div class="kpi-card"><div class="kpi-num">${avgScore !== null ? avgScore + '%' : '—'}</div><div class="kpi-lbl">🎯 Avg Score</div></div>
      </div>

      ${history.length ? `
      <div class="chart-block">
        <div class="chart-title">Quiz Score Progression (last 20 quizzes)</div>
        <canvas id="scoreCanvas" class="chart-canvas"></canvas>
      </div>` : ''}

      <div class="chart-block">
        <div class="chart-title">Study Activity — Last 14 Days</div>
        <canvas id="studyCanvas" class="chart-canvas"></canvas>
        ${biweeklyInfoHtml}
      </div>

      ${history.length ? `
      <div class="chart-block">
        <div class="chart-title">Recent Quizzes</div>
        <div class="qh-list">
          ${[...history].reverse().slice(0, 15).map(h => {
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
        </div>
      </div>` : `
      <div class="chart-block" style="text-align:center;padding:48px 20px;color:var(--muted)">
        <div style="font-size:48px;margin-bottom:14px">📊</div>
        <div style="font-size:16px;font-weight:700;color:var(--sub)">No quiz history yet</div>
        <div style="font-size:13px;margin-top:8px;line-height:1.6">
          Complete a <strong>Daily Quiz</strong> or <strong>Weekly Challenge</strong> to track your score progression here.
        </div>
      </div>`}
    </div>`;

  requestAnimationFrame(() => {
    const sc = document.getElementById('scoreCanvas');
    const st = document.getElementById('studyCanvas');
    if (sc) drawLineChart(sc, scoreVals, scoreLbls);
    if (st) drawBarChart(st, studyVals, studyLbls);
  });
}
