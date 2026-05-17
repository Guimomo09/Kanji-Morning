/**
 * content-blacklist.mjs
 *
 * Mots japonais exclus de toute génération de contenu social media
 * (cartes kanji, reels, vocab of the day, etc.)
 *
 * Raisons d'exclusion :
 *   - Insultes ou termes à connotation péjorative
 *   - Pronoms/termes qui peuvent paraître irrespectueux hors contexte
 *   - Contenu potentiellement choquant pour des apprenants débutants
 *
 * Pour ajouter un mot : ajouter son écriture japonaise dans le Set ci-dessous.
 */

export const WORD_BLACKLIST = new Set([
  // ── Pronoms irrespectueux ───────────────────────────────────────────────────
  'お前',     // "tu/toi" — familier/méprisant selon le contexte, souvent perçu comme insultant
  'おまえ',   // variante hiragana de お前
  '貴様',     // "toi" — extrêmement impoli, utilisé pour insulter
  '手前',     // "toi" (forme vieille, très arrogante)

  // ── Insultes directes ───────────────────────────────────────────────────────
  '馬鹿',     // idiot, stupide
  'バカ',     // variante katakana
  'ばか',     // variante hiragana
  '馬鹿野郎', // gros idiot
  'アホ',     // idiot (dialecte Kansai)
  'あほ',     // variante hiragana
  'クソ',     // merde
  'くそ',     // variante hiragana
  '死ね',     // "crève / va mourir" — insulte grave
  '殺す',     // tuer
  '殺せ',     // impératif de tuer
  '野郎',     // salopard, bâtard
  'ちくしょう', // maudit / putain
  '畜生',     // variante kanji de ちくしょう
]);

/**
 * Retourne true si le mot est dans la blacklist.
 * @param {string} word
 * @returns {boolean}
 */
export function isBlacklisted(word) {
  return WORD_BLACKLIST.has(word);
}
