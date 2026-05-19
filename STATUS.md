# STATUS — Kanji Morning

> Dernière mise à jour: **19 Mai 2026** · Stripe LIVE ✅ · SW v21

> ⚠️ **Workflow** : toujours passer par `dev` avant `main`
> ```
> git checkout dev  →  tester sur kanji.guimo-prod.com  →  git checkout main && git merge dev && git push
> ```

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
**Git**: github.com/Guimomo09/Kanji-Morning · HEAD dev `(en cours)` · main `d393cf8` · branche active : `dev`  
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

**SEO statique JLPT** ← commit `302eb52` (main, 7 Mai 2026)
- [x] 5 pages HTML statiques générées : `/jlpt-n5.html` → `/jlpt-n1.html` (2211 kanji total)
- [x] Meta title, description, canonical, OG, JSON-LD schema · liens internes entre niveaux
- [x] `scripts/generate-seo-pages.mjs` — fetch kanjiapi.dev, rate-limited (batch 10 / 120ms)
- [x] `public/sitemap.xml` mis à jour avec 5 nouvelles URLs (priority 0.8–0.9)

**Perf & Accessibilité** ← commits `40be8f5` → `676f1ac` (main, 8 Mai 2026)
- [x] Firebase `defer` — supprime 1050ms de blocage au chargement
- [x] Google Fonts async (`media="print" onload`) — supprime 380ms de blocage
- [x] Preconnect `stats.asanokanji.com` + `client.crisp.chat` (–760ms LCP estimé)
- [x] Deploy depuis `dist/` (build Vite) — CSS+JS minifiés, assets hashés
- [x] Firestore lazy-load (chargé seulement après auth) — –99 KiB pour visiteurs non-connectés
- [x] SW v6 (invalide l'ancien cache avec la nouvelle structure `assets/`)
- [x] `--muted: #6b6b6b` (ratio 5.0:1) — fix contraste WCAG sur fond `#faf7f2`
- [x] Labels tabs : `opacity:.7` → classe `.tab-sub` sans opacité
- [x] `aria-label="Language"` sur `#langSelect`
- [x] `Cache-Control: public, max-age=31536000, immutable` sur `/assets/*` (Caddyfile) — –98 KiB cache mobile
- [x] `min-height: 80vh` sur `.home-section` — CLS footer 0.193 → 0 ✅
- [x] `font-display: optional` (was `swap`) — élimine le CLS tardif des fonts
- [x] `.quiz-elapsed-wrap` : `opacity: 0.35` → `color: var(--muted)` — fix contraste WCAG AA
- [x] `.h-date` / `.h-greet` : `opacity` → `color: rgba(255,255,255,0.9)` — fix contraste WCAG AA
- [x] `.h-settings-btn` : `rgba(.8)` → `rgba(.9)` — fix contraste WCAG AA
- [x] Suppression CSS mort (`.btn-notif-opt`, `.notif-time-*` — 19 lignes)
- **Scores Lighthouse finaux 8 Mai 2026** : Desktop **93** / 95 / 96 / 100 · Mobile **59** / 95 / 96 / 100
- **CLS** : 0.143 → **0.007** (desktop) · 0.193 → **0** (mobile) ✅
- Note : score mobile 59 = Moto G Power + 4G lente simulée (pire cas). CWV terrain attendus excellents.

**Branding & Logo** ← commits `6cd5a44` → `d87e8e9` (main, 8 Mai 2026)
- [x] Logo SVG (cercle ivoire + flamme + 朝) créé et intégré
- [x] Logo inliné dans le header — visible desktop et mobile (56px / 42px)
- [x] Favicon encodé en base64 data URI (contourne problème MIME Nginx)
- [x] PWA icons 192/512 remplacées par le nouveau logo
- [x] Couleur brand synchronisée `#c03a20` (manifest, meta theme-color, SVG)
- [x] `#hTitle` / `#hSub` conservés masqués (requis par ui.js — crash fix)

**UX session 2 — 7 Mai 2026** ← commits `67942bd` → `1f4e1bb` (main)
- [x] Streak 7-day dots : ○ vide · ● rouge = pratiqué · 🔥 = aujourd'hui + pratiqué ← `3348301`
- [x] Suppression flash "Sign in sync" avant résolution Firebase auth (`_fbAuthReady`) ← `3b00795`
- [x] Quiz reveal card après réponse : mot + lecture + signification (+extras +POS) ← `67942bd`
- [x] Bouton Next → manuel (plus d'auto-advance à 1100ms) ← `67942bd`
- [x] Reveal card n'affiche pas ce qui vient d'être testé (anti-redondance) ← `a05f07e`
- [x] Fix `ReferenceError: type` dans `handleQuizAnswer` ← `f55e13f`
- [x] `saveQuizResult` trie l'historique avant push Firestore ← `67942bd`
- [x] Tuile Weekly Challenge retirée des Quick Actions home (bouton toolbar conservé) ← `658eb71`→ rétablie
- [x] Bouton Weekly Challenge masqué dans la toolbar sur l'onglet Home ← `c2623dc`
- [x] Dark theme settings drawer complet ← `f5b9e6e`
- [x] Dark theme menu hamburger mobile — texte items lisible ← `1f4e1bb`

**Stats — Activity view switcher & Calendar** ← commits `8d0592b` → `latest` (main, 8 Mai 2026)
- [x] Heatmap streak séparé retiré — bloc "Study Activity" unifié avec switcher 1W / 2W / Calendar
- [x] Vrai calendrier mensuel iOS-style avec navigation mois · jours étudiés en rouge · aujourd'hui cerclé
- [x] Vue calendrier : quadrillage (lignes CSS) · cellules 34px · coins arrondis
- [x] Titre dynamique selon la vue : "Last 7 Days" / "Last 14 Days" / "Calendar" (5 langues)
- [x] Bouton "i" Stats déplacé dans la toolbar (pattern identique à My List)
- [x] Fix `QuotaExceededError` localStorage — `setActivityView` catch quota + `cleanupOldData` purge `vocab_daily_*` > 90 jours
- [x] Bouton "i" Stats déplacé dans la toolbar (far-right, `margin-left:auto`) — pattern unifié avec Kanji/Vocab/My List
- [x] Bouton "i" Kanji/Vocab inline avec compteur (next to count label)
- [x] Bloc Exam desktop `max-width` aligné sur Home (900px) — plus de saut de largeur au switch d'onglet

**Exam Mode** ← commit `d29e0d4` (8 Mai 2026)
- [x] Exam Mode : 40 questions · 10 min · 60% PASS · types C+D seulement (kanji↔hiragana, pas de définitions)
- [x] Pas de bouton son en mode exam
- [x] Branding "JLPT Exam" → "Exam Mode" (localisé 5 langues, `exam_mode_title`)

**Exam tab restructuré** ← commits `b58adb2` → `91418ca` (11 Mai 2026)
- [x] Onglet Exam = hub quiz : 3 tiles (Daily | Weekly grid + accordéon Exam Mode pleine largeur)
- [x] Boutons quiz retirés des toolbars Vocab + My List
- [x] Bouton Weekly Challenge masqué sur onglet Stats
- [x] Tile Exam : niveau pill garde la section ouverte après sélection
- [x] Tile Exam : sous-titre = dernier niveau + date (pas pct/PASS)
- [x] Recent Results : niveau (N5, N4…) affiché par ligne
- [x] Section auto-ouverte si dernier exam du jour (retour depuis écran résultats)
- [x] Résultats exam exclus des Stats (uniquement dans l'onglet Exam)

**localStorage quota + sauvegarde mots** ← commits `(11 Mai 2026)`
- [x] `cleanupOldData` : rétention `vocab_daily_*` réduite à 14 jours
- [x] `saveQuizResult` : éviction `vocab_daily_*` avant suppression = rebuild mirror d'abord
- [x] `km_saved_words` : miroir compact dédié — liste mots immune aux évictions
- [x] `savedWords` Firestore : backup permanent sans fenêtre de date — jamais perdu
- [x] Firestore = source de vérité unique — cloud pull **écrase** `km_saved_words` (plus de merge gonflant)
- [x] `setPostAuthCallback` : utilise directement `km_saved_words` post-pull, sans `rebuildSavedWordsMirror`
- [x] `computeTotalWords()` lit via `getAllSavedWords()` (km_saved_words) au lieu de `vocab_daily_*`
- [x] `DOMContentLoaded` ne rappelle plus `setPostAuthCallback`/`initCloud` (bug doublon)
- [x] SW cache v10
- [x] Streak tile toggle : état en mémoire (`_streakTileView`) — ne dépend plus du localStorage
- [x] `getStudiedDatesSet()` : fallback `quiz_history` pour streak/count/calendrier si `vocab_daily_*` évincés

**Fixes session 11 Mai 2026 (suite)**
- [x] Home Avg Score exclut les exams (cohérent avec Stats) ← `ceffe11`
- [x] Exam tab re-render après pull premium au refresh (plus de vue locked) ← `cb4e206`
- [x] Alt attribute sur logo tutorial img (5 langues) — SEO/accessibilité ← `e0dc990`
- [x] `og:image` + JSON-LD `Organization` + `WebSite` dans index.html (logo Google Search) ← `48a181b`

**EXAMPLE_OVERRIDE — 12 Mai 2026** ← commits `39b2acd` → `7727908` (main)
- [x] EXAMPLE_OVERRIDE 100% complet — N5 → N4 → N3 → N2 → N1 (tous les niveaux)
- [x] Exemples offensants/erronés remplacés sur l'ensemble du JLPT (rufous hawk-cuckoo, sixty-nine, slur, salmon→ayu, etc.)
- [x] `scripts/scan-overrides.mjs` — QA scan automatique · 0 issues sur tous les niveaux
- [x] 1232 kanji N1 couverts en 4 vagues

**Quiz UX #1–#6 + XP/Grains** ← commits `(dev, 17 Mai 2026)`
- [x] **#1** Quiz — définition affichée dans la reveal card après réponse
- [x] **#2** Quiz — distracteurs intelligents (même niveau JLPT, POS similaire)
- [x] **#3** Quiz — retry des mauvaises réponses en fin de session
- [x] **#4** Système XP/Grains — barre de progression + grains 🌾 accumulés
- [x] **#5** Stats — barre XP + badges calendrier
- [x] **#6** Settings — profil utilisateur + Shop (items verrouillés)

**Custom langue dropdown** ← commit `11b22c0` (dev, 17 Mai 2026)
- [x] `<select>` natif remplacé par un dropdown custom (`.lang-dropdown`, `.lang-dropdown-list`)
- [x] Portal pattern : `document.body.appendChild(list)` pour éviter le clipping du panel Settings
- [x] z-index 1100 (> Settings panel 1000) · background `var(--card)` (fix `--surface` undefined)
- [x] `applyI18nToDOM()` synchronise le label `#langDropdownLabel`

**Vocab enrichi #7+#8+#9** ← commit `f8663bf` (dev, 17 Mai 2026)
- [x] **#7** Kanji composants en bas de chaque carte vocab — lecture on/kun · signification · badge JLPT · enrichissement async
- [x] **#8** Clic carte vocab → zoom modal (`#kanjiDetailBackdrop`) · mot 68px · lecture · sens · lien Jisho
- [x] **#9** Bouton ☆ dans chaque composant kanji → sauvegarder / retirer de My List
- [x] `_extractKanji()` · `_enrichKanjiComponents()` dans `src/vocab.js`
- [x] `openVocabDetail()` exposé sur `window` via `main.js`

**Phrases exemple vocab (Tatoeba proxy)** ← commits `e01319a` → `913be72` → `8fbcf9f` (dev, 18 Mai 2026)
- [x] `webhook/server.js` — endpoint `/api/sentence?word=X&reading=Y` · proxy Tatoeba server-side (pas de CORS)
- [x] Fallback kana : si kanji form introuvable sur Tatoeba, cherche avec la lecture hiragana (ex: 他所→よそ)
- [x] `src/api.js` — `getVocabSentence(word, reading)` · cache uniquement les hits (pas les null) · timeout 6s
- [x] `src/vocab.js` — `_enrichKanjiComponents(card, word, reading)` passe la lecture au proxy
- [x] `caddy/Caddyfile` — `@restricted not path /api/*` : exclut `/api/*` de la basic_auth staging (fix fetch JS 401)
- [x] Label `例文` + bloc `vocab-example` avec `.vkc-label.vkc-ex-label` · SENTENCE_OVERRIDE conservé pour kanji simples uniquement
- [x] Onglets — `語`/`試験` wrappés dans `.tab-icon` (20px uniform, même hauteur que icônes SVG)
- [ ] **À faire** : couverture N1/N2 limitée — envisager JMdict-examples (dataset pré-indexé JP+EN, ~200k phrases)

**Furigana audit & corrections** ← commits `bd76ea2` → `25f5e98` (dev, 18 Mai 2026)
- [x] Audit complet des 4518 phrases — toutes les lectures kuromoji vérifiées
- [x] 7 erreurs corrigées : 方×4 (ほう→かた: 近所/株主/婚約/近親), 後 (こう→あと: 分岐), 道 (どう→みち: 砂利), 形 (がた→けい: 動作)
- [x] Phrase 反転 bizarre remplacée (argot internet → phrase normale)
- [x] SW v18 → v19

**Pipeline phrases unifié — source unique sentences.json** ← commits `33ebf08` → `a1330af` (dev, 18 Mai 2026)
- [x] `scripts/build-kanji-sentences.mjs` — index kanji→phrases depuis sentences.json (1636/2211 kanji couverts)
- [x] `public/kanji-sentences.json` — pré-calculé, n5:77 n4:164 n3:367 n2:339 n1:689
- [x] `generate-kanji-cards.mjs` — charge kanji-sentences.json comme step 1.5 (après SENTENCE_OVERRIDE, avant Tatoeba)
- [x] `generate-reels.mjs` — idem
- [x] `generate-vocab-reels.mjs` — restauré depuis main, branché sur sentences.json (step 1.5 avant Tatoeba)
- **Source unique** : sentences.json AI → app in-app + kanji reels + vocab reels

**Phrases vocab statiques + kanji display fix** ← commits `5e17e2f` → `2cfac6e` (dev, 18 Mai 2026)
- [x] `public/sentences.json` — pre-generated Tatoeba sentences pour 4522 mots
  * **3795 phrases générées** (84.0% coverage) · ~460 KB
  * Priority cascade : static DB → localStorage cache → live proxy (fallback)
  * Scoring priorité : formes polies (です/ます) +100pts · longueur JLPT +50pts · ponctuation +20pts
  * Top 500 : 73.1% formes polies (365/499) · 10.5 chars moyenne · 99.8% coverage
  * Génération : ~5h (rate limit Tatoeba 1 req/sec)
  * **Corrections données 18 Mai 2026** : 人生 "Life is good." → "Life is long." · 外見 mauvaise phrase remplacée → "外見より中身が大切です。" · 日本語 ajouté
  * Furigana (`ruby` HTML) sur toutes les phrases — kuromoji · affiché dans vocab cards via `sent.ruby || sent.jp`
- [x] `public/kanji_index.json` — régénéré avec champ `j` (JLPT level) pour éliminer network delay
- [x] `scripts/build-kanji-index.mjs` — ajout champ JLPT dans extraction kanjiapi.dev
- [x] `src/api.js` — `getKanjiDetail()` utilise KANJI_INDEX en priorité (0 latency)
  * Priority 1: Static pre-loaded index (instant) ← **FIX 4-5 sec delay**
  * Priority 2: localStorage cache
  * Priority 3: Live API fallback (non-JLPT kanji)
- [x] `public/sw.js` — cache v13, pre-cache kanji_index.json + sentences.json
- [x] Impact : Affichage instantané des détails kanji sous vocab cards (4-5 sec → 0 sec)
- [x] **3813 phrases réutilisables** pour vocab cards + génération reels (pierre 2 coups)

**Push notifications + A2HS** ← commit `098bff7` (dev, 19 Mai 2026)
- [x] Settings panel — section Notifications : toggle Daily reminder + sélecteur heure locale (04:00–23:00)
- [x] Bouton ℹ → guide modal Add to Home Screen (iOS / Android / Desktop, détection auto)
- [x] `subscribePush()` envoie `utcHour` (heure locale → UTC) au backend
- [x] `unsubscribePush()` : désabonnement navigateur + DELETE Firestore via `/push-unsubscribe`
- [x] Backend `/push-subscribe` stocke `utcHour` · `/push-unsubscribe` supprime le doc
- [x] `/push-send-daily` filtre par `currentUtcHour === sub.utcHour` (envoi à l'heure choisie)
- [x] Cron VPS mis à jour : `0 8 * * *` → `0 * * * *` (toutes les heures)
- [x] Caddy : route `/push-unsubscribe` → `localhost:3001`
- [x] PM2 `asa-webhook` redémarré · Caddy rechargé
- [x] i18n : `settings_notifications`, `push_setting_label`, `push_setting_time`, `a2hs_guide_title`, `a2hs_guide_close` × 5 langues

**Streak grace day** ← commit `(en cours)` (dev, 19 Mai 2026)
- [x] `computeStreak()` — 1 jour manqué toléré (grace), 2 jours consécutifs = streak cassé
- [x] `computeBestStreak()` — même logique (diff === 2 avec une seule grace par séquence)
- [x] `isGraceActive()` — détecte si la grace est actuellement utilisée
- [x] Badge `🛡️ Jour de grâce — ton streak est protégé` affiché sur la tile streak (5 langues) uniquement quand grace active

**Shop prices + Tab hints + My List design** ← commit `f2f354e` (dev, 19 Mai 2026)
- [x] `src/xp.js` — prix réels sur les 12 REWARDS : badges 5/8/12/18 🫘 · thèmes 15/20/30/40 · frames 25/35/50/90
  - Modèle actuel : **dépense et réduit** (56 beans - achat 30 = 26 restants · total pour tout = 348 beans)
  - Alternative envisagée : modèle palier (atteindre 90 débloque tout ≤ 90) — **non implémenté, à décider**
- [x] `src/i18n.js` — hints (i) `vocab`/`kanji`/`stats` mis à jour en 5 langues
  - `vocab` : ajouté "tap carte → popup Jisho + composants kanji" · remplacé "From Kanji" par "bouton 漢 Kanji"
  - `kanji` : ajouté "tap carte → popup détail" · ajouté "bouton 語 Vocab pour revenir"
  - `stats` : supprimé "Score chart" + "Streak calendar" (retirés de l'app) · ajouté XP bar + Study Activity + Weekly Challenge
- [x] `src/main.js` — `handleWordRowClick` appelle `openVocabDetail()` (design complet) au lieu de `openWordDetail()` (ancien popup basique)
- Note : refresh cartes vocab/kanji sur switch tab déjà géré — `renderVocab(forceNew=false)` + `loadAndRender(n, forceNew=false)` servent depuis le cache

**Fixes UI XP bar + contexte utilisateur** ← (dev, 18 Mai 2026)
- [x] XP bar layout : ☕ cup icon aligné en ligne avec les segments (flex row) — plus d'icône flottante au-dessus
- [x] Home (`.home-today`) : avatar + prénom affiché au-dessus de la barre XP quand connecté
- [x] Stats section : row "Guest" affichée quand pas connecté (plus de XP bar nue sans contexte)
- [x] CSS `.home-today-user`, `.home-today-avatar`, `.home-today-fallback`, `.home-today-username` ajoutés
- [x] `.xp-bar-main` wrappeur pour segs + label (cohérence layout)

**Normalisation cartes vocab** ← commit `14a5bbe` (dev, 17 Mai 2026)
- [x] Grille `minmax(330px)` → `minmax(420px)` — 2 colonnes larges · gap 24px
- [x] `min-height: 380px` sur `.card` — cartes normalisées visuellement
- [x] `.vocab-kcomp { margin-top: auto }` — section composants toujours ancrée en bas
- [x] Tailles augmentées : `vocab-word` 48→56px · `vocab-reading` 14→16px · `card-meaning` 16→17px
- [x] Mobile : `min-height: 300px` · `vocab-word` 38→44px · padding agrandi
- [x] `border-radius` cartes 12→16px

**Fixes session 12 Mai 2026** ← commits `545f1ac` → `97a90b7` (main)
- [x] More/Less incrémental — `loadAndRenderDelta(delta)` : +More appende seulement la nouvelle carte, -Less retire la dernière sans appel API ← `545f1ac`
- [x] Race condition More/Less — flag `_deltaInProgress` bloque les clicks pendant un fetch en cours ← `97a90b7`
- [x] Ordre onglets revenu à Kanji → Vocab → My List → Exam → Stats ← `97a90b7`

**Marketing & Promotion — 11 Mai 2026**
- [x] `PRODUCTHUNT.md` — dossier de lancement complet (tagline, description, timing, checklist)
- [x] `scripts/screenshot-producthunt.mjs` — génère 5 screenshots 1270×952 depuis asanokanji.com
- [x] `screenshots/` — 5 captures prêtes pour ProductHunt (home, kanji, vocab, stats, jlpt-n5)
- [x] `scripts/generate-kanji-cards.mjs` — génère des cartes kanji 1080×1080px pour Instagram/X/LinkedIn
  - Bandeau rouge pleine largeur · logo PNG · titre centré · badge JLPT
  - Tile blanche centrée · kanji 300px · signification · lectures 音/訓
  - Options CLI : `--level n5/n4/n3/n2/n1` · `--count N` · `--kanji 火,水,木` · `--theme dark`

**Tile streak switchable** ← commit `d29e0d4` (8 Mai 2026)
- [x] Tile streak cliquable — cycle 🔥 Day Streak ↔ 📅 Days This Month (`computeMonthlyCount()`)
- [x] Préférence persistée en `localStorage` (`km_streak_tile_view`)
- [x] Fonctionne Home + Stats · i18n 5 langues
- [x] CSS hover `.kpi-streak` (pattern identique JLPT tile)

**Favicon & Logo** ← commits `e01a826`, `4d843a5` (8 Mai 2026)
- [x] Favicon remplacé — inline base64 → `/icons/icon-192.svg` direct
- [x] Modal tuto welcome : kanji 朝 remplacé par le vrai logo SVG (5 langues)
- [x] SW cache bumped v6 → v7 pour forcer invalidation clients

### 🟡 Prochaines étapes

**Priorité haute**
- [x] ~~**Stripe LIVE**~~ — ✅ 7 Mai 2026 — Payment Link live · `sk_live` + `whsec_live` sur VPS · flow testé avec promo code `FRIENDFREE` ✅
- [x] ~~Quiz UX #1–#6~~ — XP/Grains · distracteurs · retry · profil/shop ✅
- [x] ~~Vocab enrichi #7+#8+#9~~ — Composants kanji · zoom + Jisho · save depuis vocab ✅
- [x] ~~Phrases unifiées~~ — sentences.json AI → app + reels kanji + reels vocab ✅
- [x] ~~**Rétention**~~ — Notifications push · Daily reminder · Re-engagement streak ✅ (commit `098bff7`)

**Priorité moyenne**
- [x] ~~Analytics~~ — Umami self-hosted ✅
- [x] ~~i18n Phase 2~~ — EN 81% · FR 91% · DE 91% · ES 91% · RU 91% ✅
- [x] ~~**Notifications push background**~~ — Push API serveur · opt-in + heure par utilisateur · grace day streak ✅
- [ ] Merger `dev` → `main` (prod) quand staging validé

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

