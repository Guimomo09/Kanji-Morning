// ── kanjiapi.dev ──────────────────────────────────────────────────────────
export const API      = 'https://kanjiapi.dev/v1';
export const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 h

// JLPT weights for kanji tab (N3+N2 most frequent)
export const LEVEL_WEIGHT       = { 5: 8, 4: 10, 3: 40, 2: 30, 1: 12 };
export const LEVEL_LABEL        = { 5: 'N5', 4: 'N4', 3: 'N3', 2: 'N2', 1: 'N1' };

// JLPT weights for vocab tab (N5+N4+N3 dominant for beginners)
export const VOCAB_LEVEL_WEIGHT = { 5: 20, 4: 25, 3: 35, 2: 15, 1: 5 };
export const VOCAB_COUNT        = 10; // fixed daily word count

// Bi-weekly epoch: Monday April 27, 2026
export const BIWEEKLY_EPOCH = new Date(2026, 3, 27);

// ── Firebase ──────────────────────────────────────────────────────────────
export const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyD1cLVhMTIe9l-UQ4l9t4BGVBoCv-mV8jg',
  authDomain:        'kanji-morning.firebaseapp.com',
  projectId:         'kanji-morning',
  storageBucket:     'kanji-morning.firebasestorage.app',
  messagingSenderId: '661061743660',
  appId:             '1:661061743660:web:a4a12c45a19804fb720d89',
};

export const CLOUD_ENABLED = FIREBASE_CONFIG.apiKey !== 'REPLACE_WITH_YOUR_API_KEY';

// ── Stripe ────────────────────────────────────────────────────────────────
// Test link — replace with live link before going live
export const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/test_cNi3cxd4Jg5H2htf1o7N600';
