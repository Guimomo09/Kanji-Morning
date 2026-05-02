import { state } from './state.js';
import { CLOUD_ENABLED, FIREBASE_CONFIG } from './config.js';
import { loadQuizHistory } from './quiz.js';
import { _cloudPullSrs } from './srs.js';

let _postAuthCallback = null;

/** Register a callback to re-render the current tab after cloud login/pull. */
export function setPostAuthCallback(fn) {
  _postAuthCallback = fn;
}

// ── Auth UI ───────────────────────────────────────────────────────────────
function _renderAuthUI(user) {
  const wrap = document.getElementById('authWrap');
  if (!wrap) return;
  if (!CLOUD_ENABLED) { wrap.innerHTML = ''; return; }
  if (user) {
    const name  = (user.displayName || 'User').split(' ')[0];
    const photo = user.photoURL
      ? `<img src="${user.photoURL}" class="auth-avatar" referrerpolicy="no-referrer" alt="">`
      : `<span class="auth-avatar auth-avatar-fallback">${name[0].toUpperCase()}</span>`;
    wrap.innerHTML = `
      <div class="auth-user">
        ${photo}
        <span class="auth-name">${name}</span>
        <button class="auth-btn auth-btn-out" onclick="confirmSignOut()">Sign out</button>
      </div>`;
  } else {
    wrap.innerHTML = `<button class="auth-btn auth-btn-in" onclick="cloudSignIn()">☁ Sign in</button>`;
  }
}

export async function cloudSignIn() {
  if (!state._fbAuth) return;
  try {
    await state._fbAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
  } catch (e) {
    alert('Sign-in failed: ' + e.message);
  }
}

export function cloudSignOut() {
  if (!state._fbAuth) return;
  state._fbAuth.signOut();
}

// ── Pull cloud data into localStorage on login ────────────────────────────
async function _cloudPull() {
  if (!state._fbDb || !state._fbUser) return;
  try {
    const doc = await state._fbDb.collection('users').doc(state._fbUser.uid).get();
    if (!doc.exists) return;
    const data = doc.data();

    // Pull vocab_daily_* for the last 30 days — merge with local
    if (data.dailyWords) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      let pulled = 0;
      Object.entries(data.dailyWords).forEach(([date, cloudItems]) => {
        if (!Array.isArray(cloudItems)) return;
        const d = new Date(date + 'T12:00:00');
        if (d < cutoff) return;
        try {
          const local      = JSON.parse(localStorage.getItem(`vocab_daily_${date}`) || '[]');
          const localWords = new Set(local.map(i => i.word));
          const merged     = [...local, ...cloudItems.filter(i => !localWords.has(i.word))];
          localStorage.setItem(`vocab_daily_${date}`, JSON.stringify(merged));
          pulled++;
        } catch {}
      });
      console.log(`[_cloudPull] Pulled ${pulled} days of vocab from cloud.`);
    }

    // Pull quiz history — merge, keep best score per day
    if (data.quizHistory && Array.isArray(data.quizHistory)) {
      const local  = loadQuizHistory();
      const merged = [...local];
      data.quizHistory.forEach(cloudEntry => {
        const idx = merged.findIndex(
          h => h.date === cloudEntry.date && (h.type || 'daily') === (cloudEntry.type || 'daily')
        );
        if (idx === -1) merged.push(cloudEntry);
        else if (cloudEntry.pct > merged[idx].pct) merged[idx] = cloudEntry;
      });
      merged.sort((a, b) => b.date.localeCompare(a.date));
      while (merged.length > 50) merged.pop();
      try { localStorage.setItem('quiz_history', JSON.stringify(merged)); } catch {}
    }

    // Restore level preferences
    if (data.vocabLevel && state.vocabLevelFilter !== data.vocabLevel) {
      state.vocabLevelFilter = data.vocabLevel;
      localStorage.setItem('vocabLevelFilter', data.vocabLevel);
    }
    if (data.kanjiLevel && state.kanjiLevelFilter !== data.kanjiLevel) {
      state.kanjiLevelFilter = data.kanjiLevel;
      localStorage.setItem('kanjiLevelFilter', data.kanjiLevel);
    }

    // Pull learned words
    if (data.learnedWords) {
      try {
        const raw  = localStorage.getItem('learned_words');
        const local = raw
          ? JSON.parse(raw)
          : { byWord: [], byMeaning: [] };
        const wSet = new Set([...local.byWord,    ...(data.learnedWords.byWord    || [])]);
        const mSet = new Set([...local.byMeaning, ...(data.learnedWords.byMeaning || [])]);
        localStorage.setItem('learned_words', JSON.stringify({
          byWord:    [...wSet],
          byMeaning: [...mSet],
        }));
      } catch {}
    }

    // Pull biweekly done markers
    if (data.biweeklyDone) {
      Object.entries(data.biweeklyDone).forEach(([ds, done]) => {
        if (done) {
          try { localStorage.setItem(`biweekly_done_${ds}`, '1'); } catch {}
        }
      });
    }

    // Pull SRS cards
    await _cloudPullSrs(data);

    // Pull premium status
    if (data.premium === true) {
      state.isPremium = true;
      console.log('[cloud] Premium status: active');
    }

  } catch (e) {
    console.warn('[_cloudPull] Failed to pull from cloud:', e);
  }
}

// ── Re-check premium (call after ?premium=success redirect) ──────────────
export async function checkPremiumStatus() {
  if (!state._fbDb || !state._fbUser) return false;
  try {
    const doc = await state._fbDb.collection('users').doc(state._fbUser.uid).get();
    if (doc.exists && doc.data().premium === true) {
      state.isPremium = true;
      return true;
    }
  } catch (e) {
    console.warn('[cloud] checkPremiumStatus failed:', e);
  }
  return false;
}

// ── Push a partial update to Firestore ───────────────────────────────────
export async function cloudUpdate(partial) {
  if (!state._fbDb || !state._fbUser) return;
  try {
    await state._fbDb.collection('users').doc(state._fbUser.uid).set(partial, { merge: true });
  } catch (e) {
    if (e.code === 'resource-exhausted') {
      console.warn('Cloud storage quota exceeded, skipping sync');
    } else {
      console.warn('Cloud update failed:', e);
    }
  }
}

// ── Firebase initialisation ───────────────────────────────────────────────
export function initCloud() {
  if (!CLOUD_ENABLED) { _renderAuthUI(null); return; }
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    state._fbAuth = firebase.auth();
    state._fbDb   = firebase.firestore();
    _renderAuthUI(null); // show Sign in button immediately

    state._fbAuth.onAuthStateChanged(async user => {
      state._fbUser = user;
      _renderAuthUI(user);
      if (user) {
        await _cloudPull();
        if (_postAuthCallback) _postAuthCallback();
      }
    });
  } catch (e) {
    console.warn('Firebase init failed:', e);
  }
}
