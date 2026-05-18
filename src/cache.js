import { CACHE_TTL } from './config.js';

export function cacheGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) { localStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}

export function cacheSet(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

/** Remove all API cache entries to free up localStorage space. */
export function evictAllCache() {
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && (k.startsWith('jlpt_list_') || k.startsWith('kanji_') ||
              k.startsWith('words_') || k.startsWith('vsent_'))) {
      toRemove.push(k);
    }
  }
  toRemove.forEach(k => localStorage.removeItem(k));
  if (toRemove.length) console.info(`[cache] evicted ${toRemove.length} cache entries to free localStorage`);
  return toRemove.length;
}
