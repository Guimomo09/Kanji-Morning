'use strict';

/**
 * Asa no Kanji — Stripe Webhook Server
 *
 * Required env vars (set in /etc/asa-no-kanji/.env):
 *   STRIPE_SECRET_KEY               — sk_live_... (or sk_test_... for testing)
 *   STRIPE_WEBHOOK_SECRET           — whsec_... (from Stripe Dashboard → Webhooks)
 *   FIREBASE_SERVICE_ACCOUNT_PATH   — absolute path to the service account JSON file
 *   PORT                            — (optional) defaults to 3001
 *   VAPID_PUBLIC_KEY                — Web Push VAPID public key
 *   VAPID_PRIVATE_KEY               — Web Push VAPID private key
 *   VAPID_SUBJECT                   — mailto:you@domain.com
 *   PUSH_DAILY_SECRET               — secret token for /push-send-daily endpoint
 *
 * On payment, writes { premium: true, premiumSince: ISO date } to
 * Firestore users/{client_reference_id} using merge.
 */

const express = require('express');
const fs      = require('fs');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin   = require('firebase-admin');
const webpush = require('web-push');

// ── Firebase Admin init ───────────────────────────────────────────────────
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!serviceAccountPath) {
  console.error('[startup] FIREBASE_SERVICE_ACCOUNT_PATH is not set');
  process.exit(1);
}
admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'))
  ),
});
const db = admin.firestore();

// ── Web Push (VAPID) ──────────────────────────────────────────────────────
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:contact@asanokanji.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// ── Express ───────────────────────────────────────────────────────────────
const app = express();

// Stripe requires raw body for signature verification — do NOT use express.json() globally
app.post(
  '/stripe-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('[webhook] Signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const uid     = session.client_reference_id;

      if (!uid) {
        console.warn('[webhook] No client_reference_id in session:', session.id);
        return res.json({ received: true });
      }

      try {
        await db.collection('users').doc(uid).set(
          {
            premium:      true,
            premiumSince: new Date().toISOString(),
            stripeSessionId: session.id,
          },
          { merge: true }
        );
        console.log(`[webhook] ✅ Premium granted to uid: ${uid}`);
      } catch (err) {
        console.error('[webhook] Firestore write failed:', err);
        return res.status(500).send('Database error');
      }
    }

    res.json({ received: true });
  }
);

// Health check
app.get('/health', (req, res) => res.json({ ok: true }));

// ── Sentence proxy (Tatoeba, no CORS issue server-side) ──────────────────
// Maps app lang codes → Tatoeba ISO 639-3 codes
const TATOEBA_LANG = { en: 'eng', fr: 'fra', es: 'spa', de: 'deu', ru: 'rus' };

async function searchTatoeba(query, lang = 'en') {
  const tatLang = TATOEBA_LANG[lang] || 'eng';
  const url = `https://tatoeba.org/en/api_v0/search?query=${encodeURIComponent(query)}&from=jpn&to=${tatLang}&limit=20`;
  const upstream = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!upstream.ok) return null;
  const data = await upstream.json();
  for (const r of (data.results || [])) {
    if (r.text?.includes(query) && r.translations?.[0]?.[0]?.text) {
      const translation = r.translations[0][0].text.trim();
      const result = { jp: r.text.trim() };
      result[lang] = translation;
      // Always include English as fallback (re-fetch only if lang != en)
      if (lang !== 'en') result.en = translation; // overwritten below if available
      return result;
    }
  }
  return null;
}

app.get('/api/sentence', async (req, res) => {
  const word    = (req.query.word    || '').trim();
  const reading = (req.query.reading || '').trim();
  const lang    = (req.query.lang    || 'en').trim().toLowerCase();
  if (!word || word.length > 20) return res.json(null);
  try {
    // 1) Search by kanji form in requested language
    const byKanji = await searchTatoeba(word, lang);
    if (byKanji) return res.json(byKanji);
    // 2) Fallback: search by kana reading
    if (reading && reading !== word && reading.length <= 20) {
      const byReading = await searchTatoeba(reading, lang);
      if (byReading) return res.json(byReading);
    }
    // 3) Last resort: try English if non-English lang had no results
    if (lang !== 'en') {
      const byKanjiEn = await searchTatoeba(word, 'en');
      if (byKanjiEn) return res.json(byKanjiEn);
      if (reading && reading !== word && reading.length <= 20) {
        const byReadingEn = await searchTatoeba(reading, 'en');
        if (byReadingEn) return res.json(byReadingEn);
      }
    }
    res.json(null);
  } catch { res.json(null); }
});

// ── Push: save subscription ───────────────────────────────────────────────
app.post('/push-subscribe', express.json(), async (req, res) => {
  const { subscription, lang, uid, utcHour } = req.body || {};
  if (!subscription?.endpoint) return res.status(400).json({ error: 'Missing subscription' });

  // Key by endpoint hash to avoid duplicates
  const hash = Buffer.from(subscription.endpoint).toString('base64').slice(0, 40);
  try {
    await db.collection('push_subscriptions').doc(hash).set({
      subscription,
      lang:      lang    || 'en',
      uid:       uid     || null,
      utcHour:   (utcHour !== undefined && utcHour !== null) ? utcHour : 8,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    res.json({ ok: true });
  } catch (err) {
    console.error('[push-subscribe] Firestore error:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// ── Push: remove subscription ─────────────────────────────────────────────
app.post('/push-unsubscribe', express.json(), async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
  const hash = Buffer.from(endpoint).toString('base64').slice(0, 40);
  try {
    await db.collection('push_subscriptions').doc(hash).delete();
    res.json({ ok: true });
  } catch (err) {
    console.error('[push-unsubscribe] Firestore error:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// ── Push: send daily reminder (called by cron) ───────────────────────────
// Protect with a secret token: call as POST /push-send-daily with header
// Authorization: Bearer <PUSH_DAILY_SECRET>
const PUSH_MESSAGES = {
  en: { title: '朝の漢字', body: 'Your daily quiz is ready 🌅 来て！' },
  fr: { title: '朝の漢字', body: 'Ton quiz du jour t\'attend 🌅' },
  es: { title: '朝の漢字', body: 'Tu quiz diario está listo 🌅' },
  de: { title: '朝の漢字', body: 'Dein tägliches Quiz wartet 🌅' },
  ru: { title: '朝の漢字', body: 'Твоя ежедневная викторина готова 🌅' },
};

app.post('/push-send-daily', express.json(), async (req, res) => {
  const secret = (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.PUSH_DAILY_SECRET || secret !== process.env.PUSH_DAILY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Run hourly cron (0 * * * *) — only send to subscribers whose utcHour matches current UTC hour.
  // Subscribers without utcHour stored default to 8 UTC.
  const currentUtcHour = new Date().getUTCHours();

  let sent = 0, failed = 0, skipped = 0;
  try {
    const snapshot = await db.collection('push_subscriptions').get();
    const sends = snapshot.docs.map(async doc => {
      const { subscription, lang, utcHour } = doc.data();
      const subHour = (utcHour !== undefined && utcHour !== null) ? utcHour : 8;
      if (subHour !== currentUtcHour) { skipped++; return; }
      const msg = PUSH_MESSAGES[lang] || PUSH_MESSAGES.en;
      try {
        await webpush.sendNotification(subscription, JSON.stringify({ ...msg, url: '/' }));
        sent++;
      } catch (err) {
        failed++;
        // 410 Gone = subscription expired → delete it
        if (err.statusCode === 410) await doc.ref.delete();
      }
    });
    await Promise.all(sends);
    console.log(`[push-send-daily] hour=${currentUtcHour} sent=${sent} skipped=${skipped} failed=${failed}`);
    res.json({ sent, skipped, failed });
  } catch (err) {
    console.error('[push-send-daily] error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[webhook] Server listening on 127.0.0.1:${PORT}`);
});