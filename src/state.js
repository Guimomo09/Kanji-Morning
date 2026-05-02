// Shared mutable application state — all modules import this object and mutate its properties.
// Using a plain object avoids circular-import issues with ES module live bindings.

export const state = {
  // Kanji + vocab pools (built once, cached)
  POOL:       [],  // { char, jlptNum }[] for kanji tab
  VOCAB_POOL: [],  // { char, jlptNum }[] for vocab tab

  // Kanji tab
  count: 10,
  quizMode: false,
  currentKanjiCards: [],

  // Active quiz session
  quizState: null,

  // Vocab tab
  currentVocabItems: [],
  currentTab:        'vocab',
  vocabLevelFilter:  'all',  // always start fresh — not persisted across sessions
  kanjiLevelFilter:  localStorage.getItem('kanjiLevelFilter') || 'all',
  vocabFromKanjiMode: false,

  // SRS — always SM-2, no user choice needed
  _srsAlgo: 'sm2',

  // Firebase (set by cloud.js during initCloud)
  _fbAuth: null,
  _fbDb:   null,
  _fbUser: null,

  // Premium status (read from Firestore on login)
  isPremium: false,
};
