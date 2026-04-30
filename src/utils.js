// ── Date helpers ──────────────────────────────────────────────────────────
// Uses local components (not toISOString) to avoid UTC shift in UTC+X zones.
export function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function todayStr() { return dateStr(new Date()); }

// ── Array utility ─────────────────────────────────────────────────────────
export function shuffleArr(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Meaning normalisation ─────────────────────────────────────────────────
// For learned-words dedup: lowercase, strip punctuation/spaces
export function normMeaning(m) {
  return (m || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
}

// For display dedup: strip parens, collapse spaces
export function normalizeMeaning(gloss) {
  return gloss.toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);
}

// ── Status bar helper ─────────────────────────────────────────────────────
export function setStatus(type, msg) {
  const el = document.getElementById('statusMsg');
  if (!el) return;
  el.textContent = msg;
  el.className   = 'status-' + type;
}
