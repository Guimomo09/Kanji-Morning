'use strict';

/**
 * Asa no Kanji — Stripe Webhook Server
 *
 * Required env vars (set in /etc/asa-no-kanji/.env):
 *   STRIPE_SECRET_KEY          — sk_live_... (or sk_test_... for testing)
 *   STRIPE_WEBHOOK_SECRET      — whsec_... (from Stripe Dashboard → Webhooks)
 *   FIREBASE_SERVICE_ACCOUNT   — JSON string of the Firebase service account key
 *   PORT                       — (optional) defaults to 3001
 *
 * On payment, writes { premium: true, premiumSince: ISO date } to
 * Firestore users/{client_reference_id} using merge.
 */

const express = require('express');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin   = require('firebase-admin');

// ── Firebase Admin init ───────────────────────────────────────────────────
admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  ),
});
const db = admin.firestore();

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

const PORT = process.env.PORT || 3001;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[webhook] Server listening on 127.0.0.1:${PORT}`);
});
