/**
 * build-quiz-scenario.mjs — turns a QUIZ_ITEM (content) into a shot list
 * (render) for render-engine.renderScenario(). This is a "recall" reel:
 * it assumes the kanji/word was already introduced in an earlier reel/card
 * and tests reading recall, not first-time teaching — so the word itself
 * stays visible through hook, pause and highlight.
 *
 * English for all narration/UI text; Japanese only for the kanji/word/reading.
 * No CTA / app footage at the end — the reel ends on the kanji detail card,
 * then fades to the brand cream background.
 *
 * Paced deliberately slow — enough time to actually read both the Japanese
 * and the English on screen, not just glimpse it. Shot durations for narrated
 * beats are sized to the ACTUAL measured length of their edge-tts audio (not
 * guessed) so no sentence gets cut off — see the duration comment on each
 * narrated shot below for the measured voice length it's built around.
 *   0–3.2s    hook: "Can you read this kanji?" alone, big and impactful
 *   3.2–6.2s  the kanji/word appears alone, 3s to look at it before choices show
 *   6.2–8.2s  both choices appear, 2s visible before the countdown starts
 *   8.2–11.2s countdown 3→2→1 under the choices, choices stay legible throughout
 *   11.2–11.7s beat of suspense: countdown goes blank for a half-beat before
 *              the reveal — straight from "1" to green felt too abrupt
 *   11.7–14.3s highlight: correct choice turns solid green in place, JP
 *              pronunciation only — the English meaning is said once, on the
 *              kanji card next, not repeated here
 *   14.3–14.7s silent beat: lets the crossfade into the kanji card finish
 *              visually before its narration starts — otherwise the voice
 *              was starting while the screen was still mid-transition
 *   14.7–20.7s kanji detail card (same format as the app's own kanji card, EN meaning)
 *   + fade to background at the very end (handled by render-engine fadeOut)
 */

import { join } from 'path';
import { quizHookHTML, quizTimerHTML, quizHighlightHTML, quizKanjiCardHTML } from '../templates.mjs';
import { ROOT } from '../render-engine.mjs';

const NARR_VOICE = 'en-US-AvaNeural';
const TICK_FILE = join(ROOT, 'kanji-cards', 'tick.mp3');

export function buildQuizShots(item) {
  const shots = [];
  const neutralChoices = item.choices.map(c => ({ char: c.char, romaji: c.romaji }));
  const correct = item.choices.find(c => c.correct);
  const highlightedChoices = item.choices.map(c => ({ char: c.char, romaji: c.romaji, status: c.correct ? 'correct' : undefined }));

  // 0–3.2s: question alone, big and impactful — the scroll-stopping first beat.
  // Measured "Quick kanji review. Can you read this word?" at en-US-AvaNeural
  // = ~3.0s; 3.2s gives it room to finish instead of cutting off.
  shots.push({
    html: quizHookHTML({ wordChar: item.wordChar, question: item.question, choices: neutralChoices, phase: 'question' }),
    duration: 3.2,
    audioText: item.narrationHook,
    audioVoice: NARR_VOICE,
  });

  // 2.0–5.0s: the kanji/word appears alone — 3s to actually look at it
  shots.push({
    html: quizHookHTML({ wordChar: item.wordChar, question: item.question, choices: neutralChoices, phase: 'word' }),
    duration: 3.0,
    silent: true,
  });

  // 5.0–7.0s: both choices appear, 2s before the countdown starts
  shots.push({
    html: quizHookHTML({ wordChar: item.wordChar, question: item.question, choices: neutralChoices, phase: 'full' }),
    duration: 2.0,
    silent: true,
  });

  // 7.0–10.0s: countdown 3-2-1 under the choices (1s each), choices stay legible.
  // Each digit gets a short tick sound right as it appears (audioFile, not
  // narrated) so the countdown reads as an actual countdown, not silence with
  // changing numbers.
  shots.push({
    html: quizTimerHTML({ wordChar: item.wordChar, question: item.question, choices: neutralChoices, seconds: 3 }),
    duration: 1.0,
    audioFile: TICK_FILE,
  });
  shots.push({
    html: quizTimerHTML({ wordChar: item.wordChar, question: item.question, choices: neutralChoices, seconds: 2 }),
    duration: 1.0,
    audioFile: TICK_FILE,
  });
  shots.push({
    html: quizTimerHTML({ wordChar: item.wordChar, question: item.question, choices: neutralChoices, seconds: 1 }),
    duration: 1.0,
    audioFile: TICK_FILE,
  });

  // 10.0–10.5s: half-beat of suspense — countdown goes blank, choices stay
  // dimmed/legible exactly as before. Marks the "...and" pause before the
  // reveal instead of cutting straight from "1" to green.
  shots.push({
    html: quizTimerHTML({ wordChar: item.wordChar, question: item.question, choices: neutralChoices, seconds: null }),
    duration: 0.5,
    silent: true,
  });

  // Highlight the correct choice in place (no screen switch yet) — just the JP
  // pronunciation here. The full English meaning is only said once, on the
  // kanji detail card right after: saying "Kiku — to listen, or to ask" here
  // AND "the kanji means to hear, to ask..." on the card was redundant.
  // audioLead: followed directly by the silent beat + kanji card narration,
  // so the voice is placed near the start instead of centered — keeps its
  // tail clear of the xfade into the next shot.
  shots.push({
    html: quizHighlightHTML({ wordChar: item.wordChar, question: item.question, choices: highlightedChoices }),
    duration: 2.6,
    audioText: item.wordChar,
    audioVoice: 'ja-JP-NanamiNeural',
    audioLead: true,
  });

  // Silent beat right after switching to the kanji card: the visual
  // crossfade (0.3s) needs to actually finish before the card's own narration
  // starts, otherwise the voice was heard while the screen was still fading
  // in from the previous shot.
  shots.push({
    html: quizKanjiCardHTML({
      char: item.kanjiChar || correct.char,
      meaning: item.kanjiMeaning || correct.meaning,
      onReading: item.onReading || '',
      onRomaji: item.onRomaji || '',
      kunReading: item.kunReading || '',
      kunRomaji: item.kunRomaji || '',
    }),
    duration: 0.4,
    silent: true,
  });

  // Kanji detail card narration. Measured "The kanji 聞 means to hear, to ask,
  // or to listen." = ~3.7s; 6s gives it plenty of room plus reading time after.
  // Last narrated shot in the reel (nothing narrated follows), so centering is fine.
  shots.push({
    html: quizKanjiCardHTML({
      char: item.kanjiChar || correct.char,
      meaning: item.kanjiMeaning || correct.meaning,
      onReading: item.onReading || '',
      onRomaji: item.onRomaji || '',
      kunReading: item.kunReading || '',
      kunRomaji: item.kunRomaji || '',
    }),
    duration: 6.0,
    audioText: item.narrationDetail || '',
    audioVoice: NARR_VOICE,
  });

  return shots;
}
