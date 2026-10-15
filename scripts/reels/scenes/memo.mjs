/**
 * scenes/memo.mjs — contenu du concept 2 "Mémo visuel".
 *
 * Données vérifiées : composants du kanji, mot dérivé, lecture, sens —
 * cohérents avec public/kanji_index.json et EXAMPLE_OVERRIDE (src/kanji.js).
 * Le moyen mnémotechnique est explicitement présenté comme une astuce
 * inventée pour mémoriser, jamais comme une étymologie réelle.
 */

export const MEMO_ITEMS = [
  {
    id: 'yasumu-rest',
    char: '休',
    reading: 'キュウ / やす.む',
    meaning: 'day off, rest',
    components: [
      { text: '亻', color: '#c03a20', label: 'personne' },
      { text: '休', ghost: true }, // full char reference, not rendered directly
      { text: '木', color: '#2e7d32', label: 'arbre' },
    ],
    word: '休む',
    wordReading: 'やすむ',
    wordMeaning: 'se reposer',
    hookQuestion: 'Une astuce pour retenir 休 ?',
    mnemonic: 'Imagine une personne (亻) contre un arbre (木) : elle se repose.',
    mnemonicDisclaimer: 'Astuce mnémotechnique, pas l\'origine réelle du kanji.',
    narrationReveal: '休む se lit やすむ — "se reposer".',
    ctaLine1: 'Retrouve ce kanji dans Asano pour le réviser.',
    ctaLine2: 'Lien en bio.',
  },
  {
    id: 'hayashi-forest',
    char: '林',
    reading: 'リン / はやし',
    meaning: 'forest, grove',
    components: [
      { text: '木', color: '#2e7d32', label: 'arbre' },
      { text: '林', ghost: true },
      { text: '木', color: '#1a7a3a', label: 'arbre' },
    ],
    word: '林',
    wordReading: 'はやし',
    wordMeaning: 'bois, bosquet',
    hookQuestion: 'Une astuce pour retenir 林 ?',
    mnemonic: 'Deux arbres (木木) côte à côte : un petit bois.',
    mnemonicDisclaimer: 'Astuce mnémotechnique, pas l\'origine réelle du kanji.',
    narrationReveal: '林 se lit はやし — "bois, bosquet".',
    ctaLine1: 'Retrouve ce kanji dans Asano pour le réviser.',
    ctaLine2: 'Lien en bio.',
  },
  {
    id: 'akarui-bright',
    char: '明',
    reading: 'メイ / あか.るい',
    meaning: 'bright, light',
    components: [
      { text: '日', color: '#c03a20', label: 'soleil' },
      { text: '明', ghost: true },
      { text: '月', color: '#1a3a5c', label: 'lune' },
    ],
    word: '明るい',
    wordReading: 'あかるい',
    wordMeaning: 'lumineux, clair',
    hookQuestion: 'Une astuce pour retenir 明 ?',
    mnemonic: 'Le soleil (日) et la lune (月) ensemble : ça éclaire.',
    mnemonicDisclaimer: 'Astuce mnémotechnique, pas l\'origine réelle du kanji.',
    narrationReveal: '明るい se lit あかるい — "lumineux, clair".',
    ctaLine1: 'Retrouve ce kanji dans Asano pour le réviser.',
    ctaLine2: 'Lien en bio.',
  },
];

export function getMemoItem(id) {
  const item = MEMO_ITEMS.find(m => m.id === id);
  if (!item) throw new Error(`Memo item inconnu: ${id}. Disponibles: ${MEMO_ITEMS.map(m => m.id).join(', ')}`);
  return item;
}
