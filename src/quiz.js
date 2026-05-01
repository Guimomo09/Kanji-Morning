import { state } from './state.js';
import { shuffleArr, todayStr, dateStr, setStatus } from './utils.js';
import { CLOUD_ENABLED } from './config.js';
import { loadDailyVocab, getQuizDates } from './daily.js';
import { saveBiWeeklyDone, getLastBiWeeklyMonday, updateBiWeeklyBtn } from './biweekly.js';
import { cloudUpdate } from './cloud.js';
import { srsLoad, srsIntervalLabel } from './srs.js';

// ── Question type helpers ─────────────────────────────────────────────────
// Types: A = word→meaning, B = meaning→word, C = word→reading,
//        D = reading→word, E = reading→meaning
export function validTypesFor(item) {
  const base = ['A', 'B'];
  if (item.reading) base.push('C', 'D', 'E');
  return base;
}

export function buildQuestionList(pool) {
  const targetTotal = Math.round(pool.length * 1.5);
  const extraCount  = targetTotal - pool.length;

  const firstTypes = new Map();
  const questions  = pool.map(item => {
    const types = shuffleArr([...validTypesFor(item)]);
    const type  = types[0];
    firstTypes.set(item.word, type);
    return { item, type };
  });

  const extras = shuffleArr([...pool]).slice(0, extraCount);
  for (const item of extras) {
    const used      = firstTypes.get(item.word);
    const remaining = validTypesFor(item).filter(t => t !== used);
    if (!remaining.length) continue;
    const type = remaining[Math.floor(Math.random() * remaining.length)];
    questions.push({ item, type });
  }
  return shuffleArr(questions);
}

// ── Quiz engine ───────────────────────────────────────────────────────────
export function startVocabQuiz(items, dayLabel, quizType) {
  state.quizState = {
    questions: buildQuestionList(items),
    pool:      items,
    current:   0,
    score:     0,
    dayLabel:  dayLabel || '',
    type:      quizType || 'daily',
  };
  renderQuizQuestion();
}

export function renderQuizQuestion() {
  if (!state.quizState) return;
  const { questions, pool, current, score } = state.quizState;
  const total = questions.length;
  if (current >= total) { renderQuizResults(); return; }

  const { item, type } = questions[current];
  const others = shuffleArr(pool.filter(p => p.word !== item.word));
  const wrong3 = others.slice(0, 3);

  let questionLabel, promptHtml, correctText, wrongTexts;

  switch (type) {
    case 'A':
      questionLabel = '💬 What is the meaning?';
      promptHtml = `
        <div class="quiz-prompt-word">${item.word}</div>
        ${item.reading ? `<div class="quiz-prompt-reading">${item.reading}</div>` : ''}
        <span class="badge badge-${item.level}" style="margin-top:6px">${item.level}</span>`;
      correctText = item.meaning;
      wrongTexts  = wrong3.map(w => w.meaning);
      break;

    case 'B':
      questionLabel = '🔤 Which word matches?';
      promptHtml = `
        <div class="quiz-prompt-meaning">${item.meaning}</div>
        <span class="badge badge-${item.level}" style="margin-top:6px">${item.level}</span>`;
      correctText = item.word;
      wrongTexts  = wrong3.map(w => w.word);
      break;

    case 'C':
      questionLabel = '🔊 What is the reading?';
      promptHtml = `
        <div class="quiz-prompt-word">${item.word}</div>
        <span class="badge badge-${item.level}" style="margin-top:6px">${item.level}</span>`;
      correctText = item.reading;
      wrongTexts  = wrong3.filter(w => w.reading).map(w => w.reading);
      while (wrongTexts.length < 3) {
        wrongTexts.push(others[wrongTexts.length]?.reading || others[wrongTexts.length]?.word || '???');
      }
      break;

    case 'D':
      questionLabel = '🔤 Which kanji matches this reading?';
      promptHtml = `
        <div class="quiz-prompt-word" style="font-size:42px">${item.reading}</div>
        <span class="badge badge-${item.level}" style="margin-top:6px">${item.level}</span>`;
      correctText = item.word;
      wrongTexts  = wrong3.map(w => w.word);
      break;

    case 'E':
      questionLabel = '💬 What does this reading mean?';
      promptHtml = `
        <div class="quiz-prompt-word" style="font-size:42px">${item.reading}</div>
        <div class="quiz-prompt-reading">${item.word}</div>
        <span class="badge badge-${item.level}" style="margin-top:6px">${item.level}</span>`;
      correctText = item.meaning;
      wrongTexts  = wrong3.map(w => w.meaning);
      break;
  }

  const options = shuffleArr([
    { text: correctText, correct: true },
    ...wrongTexts.slice(0, 3).map(t => ({ text: t, correct: false })),
  ]);
  const pct = Math.round((current / total) * 100);
  const optionsHtml = options.map(opt =>
    `<button class="quiz-option" onclick="handleQuizAnswer(this, ${opt.correct})"
       data-correct="${opt.correct}">${opt.text}</button>`
  ).join('');

  document.getElementById('grid').innerHTML = `
    <div class="quiz-screen">
      <div class="quiz-progress-wrap">
        <div class="quiz-progress-bar" style="width:${pct}%"></div>
      </div>
      <div class="quiz-meta">${current + 1}&nbsp;/&nbsp;${total} &nbsp;·&nbsp; ⭐ ${score}</div>
      <div class="quiz-question-card">
        <div class="quiz-direction-label">${questionLabel}</div>
        ${promptHtml}
      </div>
      <div class="quiz-options">${optionsHtml}</div>
    </div>`;

  document.getElementById('countLabel').textContent = total;
  const hint = document.getElementById('quizHint');
  if (hint) hint.style.display = 'none';
}

export function handleQuizAnswer(btn, isCorrect) {
  document.querySelectorAll('.quiz-option').forEach(b => {
    b.disabled = true;
    if (b.dataset.correct === 'true') b.classList.add('correct');
  });
  if (!isCorrect) btn.classList.add('wrong');
  else state.quizState.score++;

  if (state.quizState && state.quizState.type === 'srs') {
    const item  = state.quizState.questions[state.quizState.current].item;
    const cards = srsLoad();
    const card  = cards[item.word] || {
      word: item.word, reading: item.reading || '', meaning: item.meaning,
      pos: item.pos || '', level: item.level,
      interval: 1, ef: 2.5, nextReview: todayStr(), reps: 0,
    };
    const labels = [0, 1, 2, 3].map(g => srsIntervalLabel(card, g, state._srsAlgo));
    const ratingWrap = document.createElement('div');
    ratingWrap.className = 'srs-rating-wrap';
    [
      { cls: 'srs-btn-again', label: 'Again', grade: 0 },
      { cls: 'srs-btn-hard',  label: 'Hard',  grade: 1 },
      { cls: 'srs-btn-good',  label: 'Good',  grade: 2 },
      { cls: 'srs-btn-easy',  label: 'Easy',  grade: 3 },
    ].forEach(({ cls, label, grade }) => {
      const b = document.createElement('button');
      b.className = `srs-btn ${cls}`;
      const span = document.createElement('span');
      span.className = 'srs-interval';
      span.textContent = labels[grade];
      b.textContent = label;
      b.appendChild(span);
      b.addEventListener('click', () => rateSrsCard(item.word, grade));
      ratingWrap.appendChild(b);
    });
    document.querySelector('.quiz-options')?.after(ratingWrap);
  } else {
    setTimeout(() => { state.quizState.current++; renderQuizQuestion(); }, 1100);
  }
}

export function renderQuizResults() {
  const { score, questions, type } = state.quizState;
  const total = questions.length;
  const pct   = Math.round((score / total) * 100);
  const isBiW = type === 'biweekly';
  const isSrs  = type === 'srs';

  saveQuizResult(score, total, type);
  if (isBiW) saveBiWeeklyDone(dateStr(getLastBiWeeklyMonday()));

  let emoji, msg;
  if (pct >= 90)      { emoji = '🏆'; msg = '素晴らしい！Excellent!'; }
  else if (pct >= 70) { emoji = '👍'; msg = 'よくできました！Good job!'; }
  else if (pct >= 50) { emoji = '📚'; msg = 'まあまあ。Keep practicing!'; }
  else                { emoji = '💪'; msg = '頑張って！Keep at it!'; }

  const typeBadge = isBiW
    ? '<span class="qh-type qh-type-biweekly">Bi-Weekly</span>'
    : isSrs
    ? '<span class="qh-type qh-type-srs">SRS</span>'
    : '<span class="qh-type qh-type-daily">Daily</span>';

  const retryFn = isBiW ? 'launchBiWeeklyQuiz()' : isSrs ? 'launchSrsReview()' : 'launchDailyQuiz()';

  document.getElementById('grid').innerHTML = `
    <div class="quiz-screen quiz-results">
      <div class="quiz-result-emoji">${emoji}</div>
      <div style="margin-bottom:6px">${typeBadge}</div>
      <div class="quiz-result-score">${score}&nbsp;/&nbsp;${total}</div>
      <div class="quiz-result-pct">${pct}%</div>
      <div class="quiz-result-msg">${msg}</div>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:28px">
        <button class="btn btn-primary" onclick="${retryFn}">↺ Retry</button>
        <button class="btn btn-ghost" onclick="resetAndBack()">📖 Back to Words</button>
        <button class="btn btn-ghost" onclick="resetAndStats()">📊 See Stats</button>
      </div>
      ${!isSrs ? `
      <div class="quiz-tomorrow">
        <div class="quiz-tomorrow-icon">🌅</div>
        <div class="quiz-tomorrow-title">See you tomorrow!</div>
        <div class="quiz-tomorrow-body">New kanji and vocabulary will be waiting.<br>Consistency beats intensity — がんばって！</div>
      </div>` : ''}
    </div>`;

  state.quizState = null;
  setStatus('ok', `Quiz done · ${score}/${total} correct (${pct}%)`);
  if (state.currentTab === 'vocab') updateBiWeeklyBtn();
}

// ── History ───────────────────────────────────────────────────────────────
export function saveQuizResult(score, total, type) {
  const history = loadQuizHistory();
  const today   = todayStr();
  const newPct  = Math.round((score / total) * 100);
  const qtype   = type || 'daily';
  const idx = history.findIndex(h => h.date === today && (h.type || 'daily') === qtype);
  if (idx !== -1) {
    if (newPct > history[idx].pct) history[idx] = { date: today, score, total, pct: newPct, type: qtype };
  } else {
    history.push({ date: today, score, total, pct: newPct, type: qtype });
  }
  while (history.length > 50) history.shift();
  try { localStorage.setItem('quiz_history', JSON.stringify(history)); } catch {}
  if (CLOUD_ENABLED && state._fbUser) cloudUpdate({ quizHistory: history });
}

export function loadQuizHistory() {
  try { const r = localStorage.getItem('quiz_history'); return r ? JSON.parse(r) : []; }
  catch { return []; }
}

// ── Quiz launchers ────────────────────────────────────────────────────────
export async function launchDailyQuiz() {
  const today = todayStr();
  let items   = loadDailyVocab(today);
  if (!items || items.length < 2) {
    items = [];
    for (let i = 0; i < 7 && items.length < 2; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const s = loadDailyVocab(dateStr(d));
      if (s) items.push(...s);
    }
    const seen = new Set();
    items = items.filter(it => seen.has(it.word) ? false : seen.add(it.word));
  }
  if (items.length < 2) {
    setStatus('error', 'No saved words — browse Vocabulary and tap 💾 Save for Quiz first.');
    return;
  }
  setStatus('ok', `Daily quiz · ${items.length} words from ${today}`);
  document.getElementById('grid').innerHTML = '';
  document.getElementById('levelFilter').style.display = 'none';
  startVocabQuiz(items, 'today', 'daily');
}

export async function launchBiWeeklyQuiz() {
  const dates    = getQuizDates();
  const allItems = [];
  for (const date of dates) {
    const saved = loadDailyVocab(date);
    if (saved && saved.length > 0) allItems.push(...saved);
  }
  if (allItems.length < 4) {
    setStatus('error', 'No saved words yet — browse words and tap 💾 Save for Quiz first.');
    return;
  }
  const seen   = new Set();
  const unique = allItems.filter(item => seen.has(item.word) ? false : seen.add(item.word));
  const daysWithData = dates.filter(d => {
    const s = loadDailyVocab(d); return s && s.length > 0;
  }).length;
  const dayLabel = `${daysWithData} day${daysWithData !== 1 ? 's' : ''}`;
  setStatus('ok', `Bi-Weekly quiz · ${unique.length} words from ${dayLabel}`);

  // Switch tab display if coming from a hidden-grid tab (avoid full re-render)
  const _sectionMap = { stats: 'statsSection', home: 'homeSection', mylist: 'mylistSection' };
  if (_sectionMap[state.currentTab]) {
    document.getElementById(_sectionMap[state.currentTab]).style.display = 'none';
    document.getElementById('grid').style.display         = '';
    document.getElementById('toolbarDiv').style.display   = '';
    ['tabHome', 'tabStats', 'tabMyList'].forEach(id =>
      document.getElementById(id)?.classList.remove('active')
    );
    document.getElementById('tabVocab').classList.add('active');
    state.currentTab = 'vocab';
  }
  document.getElementById('levelFilter').style.display = 'none';
  document.getElementById('legendDiv').style.display   = 'none';
  startVocabQuiz(unique, dayLabel, 'biweekly');
}
