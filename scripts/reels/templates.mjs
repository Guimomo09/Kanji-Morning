/**
 * templates.mjs — shared HTML building blocks (Asano Kanji visual identity)
 * for reel formats (quiz, visual memo tip, situation).
 *
 * Matches the real app / card generator (scripts/generate-kanji-cards.mjs):
 *   cream background #faf7f2 · brand red #c03a20 · Noto Sans JP ·
 *   full-width red header band (logo + "朝の漢字 · Asa no Kanji" + JLPT badge) ·
 *   white rounded cards with soft shadow, same radius/border as the app cards.
 *
 * All reel copy (questions, hooks, CTA) is English; only kanji/words/readings
 * stay in Japanese — matches the app's own UI language.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { ROOT } from './render-engine.mjs';

const LOGO_B64 = `data:image/png;base64,${readFileSync(join(ROOT, 'SVG', 'Logo_192.png')).toString('base64')}`;

const FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&display=swap" rel="stylesheet">`;

const BASE_RESET = `
  *{margin:0;padding:0;box-sizing:border-box;}
  html,body{width:1080px;height:1920px;overflow:hidden;}
  body{background:#faf7f2;font-family:'Noto Sans JP',sans-serif;display:flex;flex-direction:column;}
  ruby{display:inline ruby;}
  rt{font-weight:400;color:#888;}
`;

export function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Auto-fit font size for a kanji/kana string inside a fixed-width square card,
// so multi-character readings (e.g. "やすむ") never overflow or wrap.
function fitCharFontSize(text, base = 180, boxSize = 340, padding = 56) {
  const len = [...String(text)].length;
  if (len <= 1) return base;
  const maxWidth = boxSize - padding * 2;
  const perCharSize = maxWidth / len;
  return Math.round(Math.min(base, perCharSize * 1.35));
}

// Full-width red header band — same structure as the app's own cards
// (scripts/generate-kanji-cards.mjs buildKanjiHTML): logo left, brand
// centered, JLPT level right. `label` overrides the small kicker text
// shown just under the band (e.g. "Quick review").
function header(label = '', level = '') {
  const logoW = 70 + 36;
  return `<div class="hd">
    <div class="hl"><img src="${LOGO_B64}" width="70" height="70" style="border-radius:50%;display:block" alt=""></div>
    <div class="ht">朝の漢字 · Asa no Kanji</div>
    <div class="hr">${level ? escHtml(level) : ''}</div>
  </div>
  ${label ? `<div class="kicker">${escHtml(label)}</div>` : ''}
  <style>
    .hd{width:1080px;height:120px;background:#c03a20;display:flex;align-items:center;padding:0 48px;flex-shrink:0;}
    .hl{width:${logoW}px;}
    .ht{flex:1;text-align:center;font-size:30px;font-weight:800;color:#fff;letter-spacing:.5px;}
    .hr{color:rgba(255,255,255,.85);font-size:24px;font-weight:800;letter-spacing:1.5px;width:${logoW}px;text-align:right;white-space:nowrap;}
    .kicker{text-align:center;font-size:30px;font-weight:700;color:#c03a20;padding-top:28px;flex-shrink:0;}
  </style>`;
}

function doc(bodyInner, extraStyle = '') {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${BASE_RESET}${extraStyle}</style>${FONT_LINK}</head><body>${bodyInner}</body></html>`;
}

// ── Quiz: hook + word-in-question + two stacked choices ───────────────────────
// wordChar = the kanji/word being tested, shown at the same size as the final
// kanji detail card so it reads instantly in a fast scroll feed. choices =
// [{ char, status }], status: 'correct'|undefined. Choices stack vertically
// (not side by side) so longer words never collide.
//
// Every element (question, word card, choices, timer) lives in its own FIXED
// zone of the stage at all times — nothing is conditionally removed from the
// flex flow, so nothing already on screen ever shifts position when a later
// element appears. Only `visibility` toggles (hidden -> visible); layout is
// reserved from frame one. showQuestion/showWord/showChoices control that
// visibility to reveal "question -> kanji -> choices" in steps without motion.
function quizStageHTML({ wordChar, question, choices, timerSeconds = null, dimChoices = false, showQuestion = true, showWord = true, showChoices = true }) {
  const cards = choices.map(c => {
    const cls = [c.status === 'correct' ? 'ok' : '', dimChoices ? 'dim' : ''].filter(Boolean).join(' ');
    // romaji sits right under the kana so someone who can't read hiragana
    // quickly still knows what the choice says, not just what it means.
    return `
    <div class="choice ${cls}">
      <div class="choice-inner">
        <div class="choice-char" data-optical-center style="font-size:${fitCharFontSize(c.char, 64, 820, 60)}px">${escHtml(c.char)}</div>
        ${c.romaji ? `<div class="choice-romaji">${escHtml(c.romaji)}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  // The question only ever occupies its zone while showWord is false — once
  // the kanji appears the question's zone collapses to 0 height (not just
  // hidden-but-reserved), which is fine because showQuestion and showWord are
  // never both true in the real sequence (see buildQuizShots): the question
  // zone's height change happens on the SAME transition as the kanji zone's
  // growth from 0, so the stack's total height — and therefore the vertical
  // centering of everything below it — never jumps.
  return `
    ${header('Quick review · N5')}
    <div class="stage">
      <div class="stack">
        <div class="zone zone-q" style="${showQuestion ? '' : 'height:0;margin:0;overflow:hidden;'}"><div class="question">${escHtml(question)}</div></div>
        <div class="zone zone-w" style="visibility:${showWord ? 'visible' : 'hidden'}"><div class="word-card"><div class="word-char" data-optical-center style="font-size:${fitCharFontSize(wordChar, 300, 620, 70)}px">${escHtml(wordChar)}</div></div></div>
        <div class="zone zone-c" style="visibility:${showChoices ? 'visible' : 'hidden'}"><div class="choice-col">${cards}</div></div>
        <div class="zone zone-t"><div class="timer">${timerSeconds !== null ? timerSeconds : ''}</div></div>
      </div>
    </div>
  `;
}

const QUIZ_STAGE_STYLE = `
  .stage{flex:1;display:flex;flex-direction:column;align-items:center;padding:174px 70px 0;position:relative;}
  .stack{width:100%;display:flex;flex-direction:column;align-items:center;}
  .zone{width:100%;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:none;}
  .zone-q{height:170px;margin-bottom:48px;}
  .zone-w{height:620px;margin-bottom:64px;}
  .zone-c{height:420px;margin-bottom:24px;}
  .zone-t{height:120px;}
  .word-card{width:620px;height:620px;background:#fff;border-radius:40px;border:1.5px solid #e8e0d5;box-shadow:0 12px 40px rgba(0,0,0,.08);display:flex;align-items:center;justify-content:center;}
  .word-char{font-weight:900;color:#1a1a1a;line-height:1;display:block;text-align:center;}
  .question{font-size:68px;font-weight:900;color:#c03a20;text-align:center;line-height:1.2;}
  .choice-col{display:flex;flex-direction:column;gap:22px;width:100%;}
  .choice{width:100%;height:180px;background:#fff;border-radius:28px;border:2px solid #e8e0d5;box-shadow:0 12px 40px rgba(0,0,0,.08);display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;transition:none;}
  .choice.dim{opacity:.85;}
  .choice.ok{background:#2e7d32;border-color:#2e7d32;}
  .choice.ok .choice-char{color:#fff;}
  .choice.ok .choice-romaji{color:rgba(255,255,255,.85);}
  .choice-inner{display:flex;flex-direction:column;align-items:center;gap:6px;}
  .choice-char{font-weight:900;color:#1a1a1a;white-space:nowrap;writing-mode:horizontal-tb;line-height:1;}
  .choice-romaji{font-size:30px;font-weight:700;color:#999;letter-spacing:.5px;}
  .timer{font-size:110px;font-weight:900;color:#1a1a1a;line-height:1;text-align:center;}
`;

export function quizHookHTML({ wordChar, question, choices, phase = 'full' }) {
  // phase: 'question' (question text only, big + impactful) -> 'word' (kanji
  // appears, question disappears from its zone — the zone's height collapses
  // to 0 at the exact same beat the kanji zone fills in, so the stack's total
  // height stays constant and nothing below ever shifts) -> 'full' (+ choices
  // appear below, with a generous gap, not crammed against the kanji card).
  const opts = {
    question: { showQuestion: true,  showWord: false, showChoices: false },
    word:     { showQuestion: false, showWord: true,  showChoices: false },
    full:     { showQuestion: false, showWord: true,  showChoices: true },
  }[phase];
  return doc(quizStageHTML({ wordChar, question, choices, ...opts }), QUIZ_STAGE_STYLE);
}

// Countdown pause beat — identical zones/positions to the hook's 'full' phase,
// choices stay fully legible and exactly where they were; only the timer zone
// (already reserved, previously empty) gets a large digit with real breathing
// room below the choices — nothing else moves.
export function quizTimerHTML({ wordChar, question, choices, seconds = 3 }) {
  return doc(quizStageHTML({ wordChar, question, choices, timerSeconds: seconds, dimChoices: true, showQuestion: false }), QUIZ_STAGE_STYLE);
}

// Highlight beat — same zones/positions as hook 'full' phase, correct choice's
// whole pill turns solid green (not just an outline) with white text. No
// screen switch yet: the viewer sees the right answer land on the exact
// choice they were looking at, with nothing else shifting.
export function quizHighlightHTML({ wordChar, question, choices }) {
  return doc(quizStageHTML({ wordChar, question, choices, showQuestion: false }), QUIZ_STAGE_STYLE);
}

// ── Quiz: kanji detail card — same format as the app's own kanji card ────────
// (scripts/generate-kanji-cards.mjs buildKanjiHTML): big char, meaning (EN),
// ON/KUN readings. English meaning is shown prominently (not just JP kana)
// so a "can you read this" question doesn't end on an unreadable answer.
export function quizKanjiCardHTML({ char, meaning, onReading = '', onRomaji = '', kunReading = '', kunRomaji = '' }) {
  // Each reading shows its romaji right under the kana/kanji reading, not
  // just the English meaning — a viewer who can't parse hiragana/katanaka
  // quickly still gets how it's pronounced, not only what it means.
  const onBlock  = onReading  ? `<div class="rr"><span class="rl">ON</span><div class="tag on"><div class="tag-kana">${escHtml(onReading)}</div>${onRomaji ? `<div class="tag-romaji">${escHtml(onRomaji)}</div>` : ''}</div></div>`   : '';
  const kunBlock = kunReading ? `<div class="rr"><span class="rl">KUN</span><div class="tag kun"><div class="tag-kana">${escHtml(kunReading)}</div>${kunRomaji ? `<div class="tag-romaji">${escHtml(kunRomaji)}</div>` : ''}</div></div>` : '';
  return doc(`
    ${header('Quick review · N5')}
    <div class="stage"><div class="card">
      <div class="kanji">${escHtml(char)}</div>
      <div class="meaning">${escHtml(meaning)}</div>
      <div class="divider"></div>
      <div class="readings">${onBlock}${kunBlock}</div>
    </div></div>
  `, `
    .stage{flex:1;display:flex;align-items:center;justify-content:center;}
    .card{width:900px;background:#fff;border-radius:40px;border:1.5px solid #e8e0d5;box-shadow:0 12px 48px rgba(0,0,0,.10);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:72px 56px;}
    .kanji{font-size:240px;font-weight:900;color:#1a1a1a;line-height:1;margin-bottom:20px;}
    .meaning{font-size:46px;font-weight:800;color:#c03a20;text-align:center;margin-bottom:28px;text-transform:capitalize;}
    .divider{width:56px;height:4px;background:#c03a20;border-radius:2px;margin-bottom:28px;opacity:.35;}
    .readings{display:flex;flex-direction:column;gap:18px;align-items:center;}
    .rr{display:flex;align-items:center;gap:16px;}
    .rl{font-size:24px;font-weight:900;letter-spacing:1.5px;width:56px;text-align:right;color:#aaa;flex-shrink:0;}
    .tag{border-radius:16px;padding:12px 28px;display:flex;flex-direction:column;align-items:center;gap:2px;}
    .tag-kana{font-size:34px;font-weight:700;}
    .tag-romaji{font-size:22px;font-weight:700;opacity:.75;letter-spacing:.3px;}
    .on{background:#fdecea;color:#b91c1c;}
    .kun{background:#e8f5e9;color:#2e7d32;}
  `);
}

// ── Quiz: distinguishing detail (two chars side by side, one trait highlighted) ─
export function quizCompareHTML({ items }) {
  // items = [{ char, reading, meaning, status }]
  const blocks = items.map(it => {
    const cls = it.status === 'correct' ? 'ok' : it.status === 'wrong' ? 'ko' : '';
    return `
    <div class="col">
      <div class="choice ${cls}"><div class="choice-char" style="font-size:${fitCharFontSize(it.char, 150, 400, 40)}px">${escHtml(it.char)}</div></div>
      <div class="reading">${escHtml(it.reading)}</div>
      <div class="meaning">${escHtml(it.meaning)}</div>
    </div>`;
  }).join('');

  return doc(`
    ${header()}
    <div class="stage"><div class="row">${blocks}</div></div>
  `, `
    .stage{flex:1;display:flex;align-items:center;justify-content:center;padding:0 50px;}
    .row{display:flex;gap:44px;}
    .col{display:flex;flex-direction:column;align-items:center;gap:20px;width:400px;}
    .choice{width:100%;height:300px;background:#fff;border-radius:32px;border:4px solid #e8e0d5;display:flex;align-items:center;justify-content:center;overflow:hidden;}
    .choice.ok{border-color:#2e7d32;box-shadow:0 0 0 10px rgba(46,125,50,.12);}
    .choice.ko{border-color:#c5c5c5;opacity:.55;}
    .choice-char{font-weight:900;color:#1a1a1a;white-space:nowrap;writing-mode:horizontal-tb;}
    .reading{font-size:36px;color:#c03a20;font-weight:700;}
    .meaning{font-size:38px;font-weight:800;color:#1a1a1a;text-align:center;}
  `);
}

// ── Generic CTA card (short, 2-3s) — shown right before the real app clip ────
export function ctaCardHTML({ line1, line2 = '' }) {
  return doc(`
    <div class="stage">
      <img src="${LOGO_B64}" width="140" height="140" style="border-radius:50%" alt="">
      <div class="line1">${escHtml(line1)}</div>
      ${line2 ? `<div class="line2">${escHtml(line2)}</div>` : ''}
    </div>
  `, `
    .stage{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:32px;padding:0 90px;text-align:center;}
    .line1{font-size:54px;font-weight:900;color:#1a1a1a;}
    .line2{font-size:34px;color:#666;font-weight:600;}
  `);
}

// ── Mémo visuel: character with colored components ────────────────────────────
export function memoComponentHTML({ char, componentSpans, caption = '' }) {
  // componentSpans = [{ text, color }] rendered inline forming the full char breakdown
  const spans = componentSpans.map(s => `<span style="color:${s.color}">${escHtml(s.text)}</span>`).join('');
  return doc(`
    ${header()}
    <div class="stage">
      <div class="big">${spans}</div>
      ${caption ? `<div class="cap">${escHtml(caption)}</div>` : ''}
    </div>
  `, `
    .stage{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:44px;padding:0 70px;text-align:center;}
    .big{font-size:260px;font-weight:900;line-height:1;}
    .cap{font-size:40px;color:#444;font-weight:600;line-height:1.5;}
  `);
}

export function memoTextHTML({ title = '', body, highlight = null }) {
  return doc(`
    ${header()}
    <div class="stage">
      ${title ? `<div class="title">${escHtml(title)}</div>` : ''}
      <div class="body">${body}</div>
    </div>
  `, `
    .stage{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:36px;padding:0 80px;text-align:center;}
    .title{font-size:44px;color:#c03a20;font-weight:800;}
    .body{font-size:52px;font-weight:700;color:#1a1a1a;line-height:1.45;}
    .body .mk{color:#c03a20;}
  `);
}

export function memoWordHTML({ word, reading, meaning }) {
  return doc(`
    ${header()}
    <div class="stage">
      <div class="word">${escHtml(word)}</div>
      <div class="reading">${escHtml(reading)}</div>
      <div class="meaning">${escHtml(meaning)}</div>
    </div>
  `, `
    .stage{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;padding:0 80px;text-align:center;}
    .word{font-size:150px;font-weight:900;color:#1a1a1a;}
    .reading{font-size:48px;color:#c03a20;font-weight:700;}
    .meaning{font-size:46px;font-weight:700;color:#444;}
  `);
}

// ── Situation: reconstructed sign/panel + question overlay ───────────────────
export function situationSignHTML({ signText, signSub = '', bgColor = '#1a3a5c', textColor = '#fff' }) {
  return doc(`
    ${header()}
    <div class="stage">
      <div class="sign" style="background:${bgColor};color:${textColor}">
        <div class="sign-text">${escHtml(signText)}</div>
        ${signSub ? `<div class="sign-sub">${escHtml(signSub)}</div>` : ''}
      </div>
    </div>
  `, `
    .stage{flex:1;display:flex;align-items:center;justify-content:center;padding:0 90px;}
    .sign{width:100%;padding:90px 50px;border-radius:24px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.25);}
    .sign-text{font-size:130px;font-weight:900;letter-spacing:6px;}
    .sign-sub{font-size:36px;margin-top:24px;opacity:.85;}
  `);
}

export function situationQuestionHTML({ question, signText, signSub = '', bgColor = '#1a3a5c', textColor = '#fff' }) {
  return doc(`
    ${header()}
    <div class="stage">
      <div class="sign small" style="background:${bgColor};color:${textColor}">
        <div class="sign-text">${escHtml(signText)}</div>
        ${signSub ? `<div class="sign-sub">${escHtml(signSub)}</div>` : ''}
      </div>
      <div class="question">${escHtml(question)}</div>
    </div>
  `, `
    .stage{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:56px;padding:0 90px;}
    .sign{padding:60px 40px;border-radius:24px;text-align:center;box-shadow:0 16px 48px rgba(0,0,0,.2);}
    .sign-text{font-size:96px;font-weight:900;letter-spacing:4px;}
    .sign-sub{font-size:28px;margin-top:16px;opacity:.85;}
    .question{font-size:52px;font-weight:800;color:#1a1a1a;text-align:center;}
  `);
}

export function situationAnswerHTML({ signText, signSub = '', bgColor = '#1a3a5c', textColor = '#fff', reading, meaning }) {
  return doc(`
    ${header()}
    <div class="stage">
      <div class="sign small ok" style="background:${bgColor};color:${textColor}">
        <div class="sign-text">${escHtml(signText)}</div>
        ${signSub ? `<div class="sign-sub">${escHtml(signSub)}</div>` : ''}
      </div>
      <div class="reading">${escHtml(reading)}</div>
      <div class="meaning">${escHtml(meaning)}</div>
    </div>
  `, `
    .stage{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:32px;padding:0 90px;}
    .sign{padding:60px 40px;border-radius:24px;text-align:center;box-shadow:0 0 0 8px rgba(46,125,50,.25),0 16px 48px rgba(0,0,0,.2);}
    .sign-text{font-size:96px;font-weight:900;letter-spacing:4px;}
    .sign-sub{font-size:28px;margin-top:16px;opacity:.85;}
    .reading{font-size:48px;color:#c03a20;font-weight:700;}
    .meaning{font-size:56px;font-weight:900;color:#1a1a1a;text-align:center;}
  `);
}
