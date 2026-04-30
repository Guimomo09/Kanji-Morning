// ── Cache name — bump this string to force a hard refresh on all clients ──
const CACHE = 'kanji-morning-v1';

// ── Install: pre-cache the app shell root so offline load works ───────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.add('/'))
  );
  self.skipWaiting();
});

// ── Activate: evict old cache versions ────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Skip: Firebase CDN, Google APIs, any non-GET external except kanjiapi
  const isOwnOrigin   = url.origin === self.location.origin;
  const isKanjiApi    = url.hostname === 'kanjiapi.dev';
  if (!isOwnOrigin && !isKanjiApi) return;

  if (isKanjiApi) {
    // Network-first for API (app also caches in localStorage — this is a 2nd layer)
    e.respondWith(
      fetch(e.request)
        .then(r => {
          if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()));
          return r;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for same-origin assets (hashed JS/CSS, icons, manifest)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(r => {
        if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()));
        return r;
      }).catch(() => caches.match('/'));  // offline fallback → app shell
    })
  );
});
