# STATUS — Kanji Morning

> Dernière mise à jour: **4 Mai 2026** · Commit `f7488ac` (main) · Barre de recherche kanji ✅

---

## Infrastructure

| Composant | État | Détail |
|-----------|------|--------|
| VPS | OK | Hetzner CX22 · Ubuntu 24.04 · `95.216.168.28` |
| Caddy | OK | Reverse proxy + SSL auto |
| Domaine | OK | `asanokanji.com` via Cloudflare (DNS proxied) |
| URL prod | OK | https://asanokanji.com |
| Stripe webhook | OK | PM2 `asa-webhook` · port 3001 · `/stripe-webhook` |
| Search Console | OK | sitemap indexé · 2 pages découvertes |

```
# /etc/caddy/Caddyfile
asanokanji.com, www.asanokanji.com {
    root * /var/www/kanji
    file_server
    encode gzip
    reverse_proxy /stripe-webhook localhost:3001
    header { X-Frame-Options "SAMEORIGIN" ... }
}

kanji.guimo-prod.com {
    root * /var/www/kanji-staging
    file_server
    encode gzip
    basic_auth { GuimoProd <hash> }
    header { X-Frame-Options "SAMEORIGIN" ... }
}
```

---

## Kanji Morning — État

**URL**: https://asanokanji.com  
**Stack**: Vanilla JS ES modules · Firebase Auth + Firestore · kanjiapi.dev  
**Git**: github.com/Guimomo09/Kanji-Morning · HEAD dev `246a28d` · main `f7488ac` · branche active : `dev`  
**Deploy**: GitHub Actions automatique
- push `dev` → staging `kanji.guimo-prod.com` (protégé basic_auth)
- push `main` → prod `asanokanji.com`

### ✅ Fonctionnel

**Core**
- [x] Vocabulaire JLPT N5-N1 · filtre niveau · cache 24h
- [x] Quiz daily + Weekly Challenge (lundis) + SRS SM-2
- [x] Exam Mode (7 min · 20 questions · 60% pass)
- [x] Firebase Auth Google + Cloud sync Firestore
- [x] PWA installable (manifest + service worker)

**UX**
- [x] Home : Streak / Words / WOTD / JLPT Target (tap to cycle)
- [x] My List : 2 sections kanji+vocab · multi-select · drag mobile
- [x] Tutorial onboarding 5 étapes
- [x] Settings drawer · notifications locales + time picker
- [x] Hamburger menu mobile (Settings + Crisp Chat)
- [x] Sign out avec confirmation · scroll-to-top · tab persistence

**Monétisation**
- [x] Stripe Premium €7.99 one-time (mode TEST actif)
- [x] Webhook Node.js/PM2 → Firestore `premium=true`
- [x] Paywall soft 24/30 + hard gate 30 mots + Exam Mode gate
- [x] Upgrade modal (contextes: limit / exam / generic)

**SEO**
- [x] sitemap.xml · robots.txt · meta/og tags · canonical

**i18n Phase 1** ← commit `0e58fec`
- [x] `src/i18n.js` — `t('key')` · 5 langues : EN · FR · ES · DE · RU
- [x] Détection navigateur auto + `localStorage km_lang`
- [x] Sélecteur de langue dans Settings (⚙️)
- [x] ui.js · main.js · quiz.js · stats.js · index.html entièrement traduits
- [x] `applyI18nToDOM()` — attributs `data-i18n` sur tous les éléments statiques

**TTS (Web Speech API)** ← commit `3202139` (main)
- [x] `src/audio.js` — `speakJapanese(text)` · lang ja-JP · rate 0.85 · lazy voice loading
- [x] Bouton 🔊 sur les cartes kanji, vocab et les 5 types de questions quiz
- [x] Exposé via `window.speakJapanese` dans main.js

**Fix quiz bloqué** ← commit `3202139` (main)
- [x] Items `_isSrs: true` des jours précédents ne déclenchent plus les boutons SRS dans le quiz quotidien

**Cache-Control no-cache** ← commit `23876ad` (main)
- [x] SW v5 — network-first avec `cache: 'no-cache'`
- [x] Caddyfile — `Cache-Control: no-cache, must-revalidate` sur `/src/*.js /src/*.css /sw.js`
- [x] CSS — opacity bouton 🔊 à 0.7, `.vocab-header` fusionné

**i18n Phase 2** ← commits `98db03e` → `3eda6fd` (sur `main`)
- [x] `public/jmdict_trans.json` — 292k entrées JP→EN/FR/DE/ES/RU (~30MB)
- [x] `src/trans.js` — `getMeaning(word, lang)` lazy-load
- [x] Intégré dans vocab.js, quiz.js, kanji.js, stats.js
- [x] `scripts/build-jmdict.mjs` — extraction JMdict (EN inclus, merge homographes)
- [x] `scripts/patch-fr-stems.mjs` — héritage par stems (+435 FR)
- [x] `scripts/patch-morpho.mjs` — conjugaisons godan/ichidan (+1294 toutes langues)
- [x] `scripts/patch-wordnet.mjs` — JWN v1.1 + OMW (FR/DE/ES/RU via synsets)
- [x] `scripts/patch-en-pivot.mjs` — pivot EN→cible via en.wiktionary (FR+487, ES+329, RU+128)
- [x] `scripts/patch-jpndict.mjs` — FreeDict jpn-fra/deu/rus (direct JP→cible)
- [x] `scripts/patch-morph.mjs` — fallback morphologique e→u row (+3453 toutes langues)
- [x] `scripts/patch-fallback.mjs` — fallback EN pour noms propres/mots rares (+4664)
- [x] `src/kanji.js` — fix meanings kanji cards : getMeaning() fallback via exemples
- Couverture finale : **EN 81% · FR 91% · DE 91% · ES 91% · RU 91%**
- 9% restants (1133 mots) : aucune source disponible — plafond open data atteint

**Analytics** ← commit `4d829b1`
- [x] Umami self-hosted sur le VPS (`/opt/umami`, PostgreSQL, PM2)
- [x] Dashboard → https://stats.asanokanji.com
- [x] Script tracking dans `index.html` (sans cookie, RGPD-friendly)
- [x] DNS `stats.asanokanji.com` → VPS, SSL Let's Encrypt via Caddy

**Deploy pipeline** ← commits `37536d9` + `151ddb1`
- [x] GitHub Actions — push `dev` → staging auto (~10s)
- [x] GitHub Actions — push `main` → prod auto (~10s)
- [x] Staging `kanji.guimo-prod.com` protégé par basic_auth (privé)
- [x] Merge workflow : `git checkout main && git merge dev && git push`

**Fix lecture vocab katakana** ← commit `a0e47bf` (main)
- [x] Mots avec kanji dont l'API retourne une lecture tout-katakana → lecture supprimée
- [x] Ex: 馬車 → plus de マーチョ, affiche correctement ばしゃ

**Barre de recherche kanji** ← commit `f7488ac` (main)
- [x] Onglet Kanji uniquement (vocab retiré — filtre sur 10 cartes inutile)
- [x] Cherche dans les cartes affichées, puis dans tout le pool 2211 kanji via API si nécessaire
- [x] Message "Aucun résultat" si kanji inconnu
- [x] Reset automatique au changement d'onglet et sur ↺ New Selection

### 🟡 Prochaines étapes

**Priorité haute**
- [ ] **Stripe LIVE** — Payment Link live + `sk_live` + `whsec` live + update `config.js` (prévu ~10 Mai 2026)

**Priorité moyenne**
- [x] ~~Analytics~~ — Umami self-hosted ✅
- [x] ~~i18n Phase 2~~ — EN 81% · FR 91% · DE 91% · ES 91% · RU 91% ✅
- [ ] **Notifications push background** — Push API serveur (opt-in local déjà OK)

**Priorité basse**
- [ ] App Store / Play Store (via Capacitor ou Median.co)
- [ ] Promo codes Stripe (affiliés / influenceurs)

---

## Services & Clés

| Service | Usage | Prix | Compte |
|---------|-------|------|--------|
| Firebase | Auth + Firestore | Gratuit | guimoprod.dev@gmail.com |
| Crisp | Live chat SAV | Gratuit | guimoprod.dev@gmail.com |
| kanjiapi.dev | API kanji/vocab | Gratuit | — |
| Cloudflare | DNS + CDN + Email | Gratuit | guimoprod.dev@gmail.com |
| Hetzner CX22 | VPS | ~4€/mois | — |
| asanokanji.com | Domaine | ~10$/an | — |
| Stripe | Paiements (TEST actif) | 1.5%+0.25€ | — |

**Emails** (Cloudflare → guimoprod.dev@gmail.com)
- `support@asanokanji.com` — SAV / Crisp
- `billing@asanokanji.com` — Stripe / facturation

**Stripe TEST**
- Payment Link : `https://buy.stripe.com/test_cNi3cxd4Jg5H2htf1o7N600`
- Prix : €7.99 one-time
- Redirect : `https://asanokanji.com?premium=success`

---

## Agents VS Code

| Agent | Rôle |
|-------|------|
| Feedback Coach | Retours critiques UX/décisions |
| Beta Client (Léa) | Simule un vrai utilisateur |

