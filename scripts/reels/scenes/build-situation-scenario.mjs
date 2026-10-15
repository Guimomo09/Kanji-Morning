/**
 * build-situation-scenario.mjs — transforme un SITUATION_ITEM en shots.
 * Suit l'exemple 出口 du brief :
 *   panneau + accroche → question (pause) → surlignage/réponse → CTA app.
 */

import { situationSignHTML, situationQuestionHTML, situationAnswerHTML, ctaCardHTML } from '../templates.mjs';
import { pickCtaVideo } from '../render-engine.mjs';

const NARR_VOICE = 'fr-FR-DeniseNeural';

export function buildSituationShots(item) {
  const shots = [];
  const signProps = { signText: item.signText, signSub: item.signSub, bgColor: item.bgColor, textColor: item.textColor };

  // 0-3s: sign + hook narration
  shots.push({
    html: situationSignHTML(signProps),
    duration: 2.8,
    audioText: item.narrationHook,
    audioVoice: NARR_VOICE,
  });

  // 3-5.5s: question beat, silent pause
  shots.push({
    html: situationQuestionHTML({ ...signProps, question: item.question }),
    duration: 2.5,
    silent: true,
  });

  // 5.5-9s: answer reveal + JP pronunciation
  shots.push({
    html: situationAnswerHTML({ ...signProps, reading: item.reading, meaning: item.meaning }),
    duration: 2.0,
    audioText: item.signText,
    audioVoice: 'ja-JP-NanamiNeural',
  });
  shots.push({
    html: situationAnswerHTML({ ...signProps, reading: item.reading, meaning: item.meaning }),
    duration: 2.2,
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
