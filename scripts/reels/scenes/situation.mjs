/**
 * scenes/situation.mjs — contenu du concept 3 "Japonais en situation".
 *
 * Panneaux reconstitués en texte fiable (pas d'image générée
 * approximativement) — mêmes couleurs que de vrais panneaux japonais
 * (fond bleu foncé pour la signalétique de gare, texte blanc, style
 * sobre). Données vérifiées (public/kanji_index.json, EXAMPLE_OVERRIDE).
 */

export const SITUATION_ITEMS = [
  {
    id: 'deguchi-station',
    signText: '出口',
    signSub: 'EXIT',
    bgColor: '#1a3a5c',
    textColor: '#fff',
    hookLine: 'Tu vois ça dans une gare.',
    question: 'Tu vas où ?',
    reading: 'でぐち',
    meaning: 'Sortie — "exit"',
    narrationHook: 'Tu vois ce panneau dans une gare. Tu vas où ?',
    narrationReveal: '出口, でぐち — c\'est la sortie.',
    ctaLine1: 'Reconnais ces mots utiles avec Asano.',
    ctaLine2: 'Lien en bio.',
  },
  {
    id: 'iriguchi-station',
    signText: '入口',
    signSub: 'ENTRANCE',
    bgColor: '#1a3a5c',
    textColor: '#fff',
    hookLine: 'Tu vois ça dans une gare.',
    question: 'Tu vas où ?',
    reading: 'いりぐち',
    meaning: 'Entrée — "entrance"',
    narrationHook: 'Tu vois ce panneau dans une gare. Tu vas où ?',
    narrationReveal: '入口, いりぐち — c\'est l\'entrée.',
    ctaLine1: 'Reconnais ces mots utiles avec Asano.',
    ctaLine2: 'Lien en bio.',
  },
  {
    id: 'push-pull-door',
    signText: '押す',
    signSub: 'PUSH',
    bgColor: '#3a3a3a',
    textColor: '#fff',
    hookLine: 'Tu vois ça sur une porte.',
    question: 'Tu pousses ou tu tires ?',
    reading: 'おす',
    meaning: 'Pousser — "push"',
    narrationHook: 'Tu vois ce mot sur une porte. Tu pousses ou tu tires ?',
    narrationReveal: '押す se lit おす — ça veut dire "pousser".',
    ctaLine1: 'Reconnais ces mots utiles avec Asano.',
    ctaLine2: 'Lien en bio.',
  },
];

export function getSituationItem(id) {
  const item = SITUATION_ITEMS.find(s => s.id === id);
  if (!item) throw new Error(`Situation item inconnu: ${id}. Disponibles: ${SITUATION_ITEMS.map(s => s.id).join(', ')}`);
  return item;
}
