/**
 * build-memo-scenario.mjs — transforme un MEMO_ITEM en shots pour le
 * moteur de rendu. Suit l'exemple 休 du brief :
 *   accroche → composants colorés → moyen mnémotechnique (explicitement
 *   présenté comme une astuce) → mot dérivé + prononciation → CTA app.
 */

import { memoComponentHTML, memoTextHTML, memoWordHTML, ctaCardHTML, escHtml } from '../templates.mjs';
import { pickCtaVideo } from '../render-engine.mjs';

const NARR_VOICE = 'fr-FR-DeniseNeural';

export function buildMemoShots(item) {
  const shots = [];

  // 0-2.5s: hook question, full char shown plain
  shots.push({
    html: memoComponentHTML({ char: item.char, componentSpans: [{ text: item.char, color: '#1a1a1a' }], caption: '' }),
    duration: 2.4,
    audioText: item.hookQuestion,
    audioVoice: NARR_VOICE,
  });

  // 2.5-6s: components highlighted in color (亻 red, 木 green), building the char
  const coloredSpans = item.components.filter(c => !c.ghost).map(c => ({ text: c.text, color: c.color }));
  shots.push({
    html: memoComponentHTML({ char: item.char, componentSpans: coloredSpans, caption: item.components.filter(c => !c.ghost).map(c => `${c.text} = ${c.label}`).join('   ·   ') }),
    duration: 3.4,
    audioText: `${item.char} — ${item.components.filter(c => !c.ghost).map(c => c.label).join(', ')}.`,
    audioVoice: 'ja-JP-NanamiNeural',
    audioRate: '-10%',
  });

  // 6-10s: mnemonic sentence (clearly marked as a memory aid, not etymology)
  shots.push({
    html: memoTextHTML({
      title: 'Astuce (pas l\'origine réelle)',
      body: item.mnemonic.replace(item.components.find(c => !c.ghost)?.text || '', `<span class="mk">${escHtml(item.components.find(c => !c.ghost)?.text || '')}</span>`),
    }),
    duration: 4.0,
    audioText: item.mnemonic,
    audioVoice: NARR_VOICE,
  });

  // 10-13s: derived word + reading + meaning, JP pronunciation
  shots.push({
    html: memoWordHTML({ word: item.word, reading: item.wordReading, meaning: item.wordMeaning }),
    duration: 2.6,
    audioText: item.word,
    audioVoice: 'ja-JP-NanamiNeural',
  });
  shots.push({
    html: memoWordHTML({ word: item.word, reading: item.wordReading, meaning: item.wordMeaning }),
    duration: 1.8,
    audioText: item.narrationReveal,
    audioVoice: NARR_VOICE,
  });

  // CTA
  shots.push({
    html: ctaCardHTML({ line1: item.ctaLine1, line2: item.ctaLine2 }),
    duration: 1.6,
    silent: true,
  });
  const appDemoCta = pickCtaVideo(item.id);
  if (appDemoCta) {
    shots.push({ sourceVideo: appDemoCta, duration: 2.5, silent: true });
  }

  return shots;
}
