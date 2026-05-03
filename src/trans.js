// ── src/trans.js ──────────────────────────────────────────────────────────────
// Lazy-loads /jmdict_trans.json once and exposes getMeaning(word, lang).
// Falls back gracefully: if lang === 'en', file not loaded yet, or word not
// found, returns null so the caller can use the English meaning as-is.

let _data  = null;   // { "食べる": { fr: "manger", es: "comer", … }, … }
let _loading = null; // Promise<void> – deduplicate concurrent calls

/**
 * Pre-load the translation map. Call this early (e.g. on app start) so it's
 * ready before the first quiz/vocab render. Safe to call multiple times.
 */
export async function loadTrans() {
  if (_data)    return;
  if (_loading) return _loading;

  _loading = fetch('/jmdict_trans.json')
    .then(r => {
      if (!r.ok) throw new Error(`jmdict_trans.json fetch failed: ${r.status}`);
      return r.json();
    })
    .then(json => { _data = json; })
    .catch(err  => { console.warn('[trans] Could not load jmdict_trans.json:', err); });

  return _loading;
}

/**
 * Return the translated meaning for `word` in `lang`, or null if unavailable.
 * @param {string} word  – written form, e.g. "食べる"
 * @param {string} lang  – 2-letter code: 'fr' | 'es' | 'de' | 'ru'
 * @returns {string|null}
 */
export function getMeaning(word, lang) {
  if (!_data || lang === 'en' || !lang) return null;
  return _data[word]?.[lang] ?? null;
}
