/**
 * scenes/quiz.mjs — content for the "Quick review" quiz reel.
 *
 * These are RECALL reels: each item must reference a kanji/word already
 * published in an earlier reel or card (explicit `source` field below —
 * never inferred just because a kanji happens to exist in the app data).
 * Readings/meanings verified against public/kanji_index.json and the app's
 * own vocab list (src/kanji.js EXAMPLE_OVERRIDE). All narration/UI text is
 * English; only the kanji/word/reading are Japanese, matching app language.
 *
 * Each item must have exactly one correct choice, and the distractor must
 * be a genuinely different, non-ambiguous reading/word (not a near-miss
 * that could also be argued correct).
 */

export const QUIZ_ITEMS = [
  {
    id: 'kiku-listen',
    // Source: kanji-cards/n5/reels/聞.mp4 (published reel) — 聞く word card,
    // verified against src/kanji.js:299 { w: '聞く', r: 'きく', m: 'to hear, to listen, to ask' }
    // and public/kanji_index.json 聞 → o: ["ブン","モン"], k: ["き.く","き.こえる"], j: 5 (N5).
    source: 'kanji-cards/n5/reels/聞.mp4',
    wordChar: '聞く',
    question: 'Can you read this kanji?',
    choices: [
      // romaji is plain Hepburn romanization of the kana shown, not a translation —
      // lets a viewer who can't read hiragana fast still follow along.
      { char: 'きく', romaji: 'kiku', reading: 'きく', meaning: 'to listen / to ask', correct: true },
      // 書く (kaku, "to write") — a different, unambiguous word/meaning, not a near-miss reading of 聞く.
      { char: 'かく', romaji: 'kaku', reading: 'かく', meaning: 'to write', correct: false },
    ],
    narrationHook: 'Quick kanji review. Can you read this word?',
    narrationReveal: 'Kiku — to listen, or to ask.',
    // Kanji detail card shown after the highlight — same data as the old 聞 reel.
    kanjiChar: '聞',
    kanjiMeaning: 'ask, hear, listen',
    onReading: 'モン・ブン',
    onRomaji: 'mon · bun',
    kunReading: 'き.く・き.こえる',
    kunRomaji: 'ki.ku · ki.koeru',
    // Order matches kanjiMeaning exactly ("ask, hear, listen") so the spoken
    // narration never contradicts the on-screen text.
    narrationDetail: 'The kanji 聞 means to ask, to hear, or to listen.',
  },
];

export function getQuizItem(id) {
  const item = QUIZ_ITEMS.find(q => q.id === id);
  if (!item) throw new Error(`Unknown quiz item: ${id}. Available: ${QUIZ_ITEMS.map(q => q.id).join(', ')}`);
  return item;
}
