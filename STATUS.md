# STATUS — Kanji Morning

> Dernière mise à jour: **7 Mai 2026** · Commit `e908fe7` (main) · Stripe LIVE ✅

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
**Git**: github.com/Guimomo09/Kanji-Morning · HEAD dev `bab3425` · main `405d561` · branche active : `dev`  
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
- [x] Settings drawer · hamburger menu mobile
- [x] Hamburger menu mobile (Settings + Crisp Chat)
- [x] Sign out avec confirmation · scroll-to-top · tab persistence

**Monétisation**
- [x] Stripe Premium €7.99 one-time (**LIVE ✅ 7 Mai 2026**)
- [x] Webhook Node.js/PM2 → Firestore `premium=true`
- [x] Paywall soft 24/30 + hard gate 30 mots + Exam Mode gate
- [x] Upgrade modal (contextes: limit / exam / generic)
- [x] Bandeau upgrade masqué pour les utilisateurs premium ← commit `3def01b`

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

**Cache-Control no-cache** ← commit `23876ad` (main)- [x] SW v5 — network-first avec `cache: 'no-cache'`
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

**Fix i18n fin de quiz** ← commit `bab3425` (main + dev)
- [x] Fenêtre "See you tomorrow" traduite en 5 langues (FR/ES/DE/RU/EN) via `quiz_tomorrow_*` dans i18n.js
- [x] Bouton 🔔 traduit dans toutes les langues
- [x] Bouton 🔊 parle la lecture hiragana en priorité (`item.reading || item.word`) — quiz types A, E + cartes vocab

**UI tabs + toolbar** ← commit `(main, 7 Mai 2026)`
- [x] Icônes onglets remplacées par Lucide SVGs (Home, My List, Stats)
- [x] Emoji retirés des boutons toolbar (btn_from_kanji, btn_save_quiz, btn_weekly_challenge) via i18n.js
- [x] CSS `.tab` flexbox colonne pour alignement SVG

**Fixes vocab qualité** ← commits `57431e7` + `fdcf60f` (main, 7 Mai 2026)
- [x] N5/N4 vocab — fréquence corpus domine le score dictionnaire (`freqBonus` x2) — 食べ物 > 食物
- [x] Guard kanji-level pour N5/N4/N3 — tous les kanji du composé doivent être au niveau ou au-dessus
- [x] From Kanji "New Selection" — shuffle top-8, pick 4 (variété garantie)
- [x] JLPT Target cycle — re-render correct tab (stats ou home)
- [x] Quiz status home — `.find()` au lieu de `history[last]` (bug post cloud sync tri décroissant)

**Barre de recherche kanji** ← commit `f7488ac` (main)
- [x] Onglet Kanji uniquement (vocab retiré — filtre sur 10 cartes inutile)
- [x] Cherche dans les cartes affichées, puis dans tout le pool 2211 kanji via API si nécessaire
- [x] Message "Aucun résultat" si kanji inconnu
- [x] Reset automatique au changement d'onglet et sur ↺ New Selection

**UX monochrome & nettoyage** ← commits `de3b997` → `e908fe7` (main, 7 Mai 2026)
- [x] Rappel matin supprimé (118 lignes retirées) ← commit `5a31e67`
- [x] Thème dark/light — pill toggle Light/Auto/Dark · `localStorage km_theme` · anti-flash inline script ← commit `6689950`
- [x] Dark theme : `.vocab-word`, `.vocab-reading`, `.card-meaning` correctement colorés ← commit `cca892a`
- [x] Tous les emoji retirés — Settings (⚙️🌐🎨), KPI labels (🔥🎯🎌☁️), quiz questions (💬🔤🔊📊)
- [x] Tutoriel : icônes emoji → kanji monochromes (朝/漢/語/試 + SVG bar-chart)
- [x] Historique quiz trié par date (résout désordre post-sync cloud) ← commit `e20adbf`
- [x] Greeting + date redondants retirés du home (déjà dans le header) ← commit `e908fe7`

### 🟡 Prochaines étapes

**Priorité haute**
- [x] ~~**Stripe LIVE**~~ — ✅ 7 Mai 2026 — Payment Link live · `sk_live` + `whsec_live` sur VPS · flow testé avec promo code `FRIENDFREE` ✅

**Priorité moyenne**
- [x] ~~Analytics~~ — Umami self-hosted ✅
- [x] ~~i18n Phase 2~~ — EN 81% · FR 91% · DE 91% · ES 91% · RU 91% ✅
- [ ] **Notifications push background** — Push API serveur (opt-in local déjà OK)

**Priorité basse**
- [ ] App Store / Play Store (via Capacitor ou Median.co)
- [x] ~~Promo codes Stripe~~ — Coupon `FRIENDFREE` 100% off · 10 utilisations max ✅

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
| Stripe | Paiements (LIVE ✅) | 1.5%+0.25€ | guimoprod.dev@gmail.com |

**Emails** (Cloudflare → guimoprod.dev@gmail.com)
- `support@asanokanji.com` — SAV / Crisp
- `billing@asanokanji.com` — Stripe / facturation

**Stripe LIVE**
- Payment Link : `https://buy.stripe.com/28E6oGcuBbDH5cP7g2cIE00`
- Prix : €7.99 one-time
- Redirect : `https://asanokanji.com?premium=success`
- Promo code : `FRIENDFREE` (100% off · 10 utilisations)

---

## Agents VS Code

| Agent | Rôle |
|-------|------|
| Feedback Coach | Retours critiques UX/décisions |
| Beta Client (Léa) | Simule un vrai utilisateur |

