# STATUS — Kanji Morning

> Dernière mise à jour: **16 Mai 2026** · Buffer scheduling en cours (20/05→10/06 ✅ · 11/06→04/08 ⏳)

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
**Git**: github.com/Guimomo09/Kanji-Morning · HEAD main `1851edc` · branche active : `main`  
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

**Fixes session 12 Mai 2026** ← commits `545f1ac` → `97a90b7` (main)
- [x] More/Less incrémental — `loadAndRenderDelta(delta)` : +More appende seulement la nouvelle carte, -Less retire la dernière sans appel API ← `545f1ac`
- [x] Race condition More/Less — flag `_deltaInProgress` bloque les clicks pendant un fetch en cours ← `97a90b7`
- [x] Ordre onglets revenu à Kanji → Vocab → My List → Exam → Stats ← `97a90b7`

**Atomic savedWords sync — fix critique 12 Mai 2026** ← commits `(main)`
> Problème : `cloudUpdate({savedWords:[liste_locale]})` écrasait Firestore avec la liste locale (potentiellement < cloud). Un user a perdu 76 mots sauvegardés suite à un login sur un nouvel appareil.
- [x] `cloudSavedWordAdd(wordObj)` — `arrayUnion(wordObj)` Firestore : ajout atomique, jamais d'écrasement ← `cloud.js`
- [x] `cloudSavedWordRemove(wordOrSet)` — lit Firestore, filtre, `arrayRemove(...toRemove)` atomique ← `cloud.js`
- [x] `_cloudPull` savedWords : **merge** cloud+local (dédoublonnage par clé, tri par date) — plus d'écrasement ← `cloud.js`
- [x] `setPostAuthCallback` : ne pousse **plus** les savedWords vers Firestore après pull — ops atomiques gèrent la sync ← `main.js`
- [x] `window.kmSync()` : lit Firestore d'abord → merge local+cloud → push merged (merged ≥ cloud toujours) ← `main.js`
- [x] `vocab.js` : `updateSavedWordsMirror` / `removeFromSavedWordsMirror` utilisent les ops atomiques (plus de push complet)
- [x] Testé : save/remove en déco/reco + switch staging↔prod → aucune perte ✅

**Marketing & Promotion — 11 Mai 2026**
- [x] `PRODUCTHUNT.md` — dossier de lancement complet (tagline, description, timing, checklist)
- [x] `scripts/screenshot-producthunt.mjs` — génère 5 screenshots 1270×952 depuis asanokanji.com
- [x] `screenshots/` — 5 captures prêtes pour ProductHunt (home, kanji, vocab, stats, jlpt-n5)
- [x] `scripts/generate-kanji-cards.mjs` — génère des cartes kanji 1080×1080px (insta) et 1080×1920px (tiktok)
  - Bandeau rouge `#c03a20` pleine largeur · logo PNG · titre centré · badge JLPT
  - Tile blanche centrée · kanji · signification · lectures KUN (vert, grande) puis ON (rouge, petite), ordre popular-first
  - Options CLI : `--level n5/n4/n3/n2/n1` · `--count N` · `--kanji 火,水,木`

**Contenu cartes — 13 Mai 2026**
- [x] `EXAMPLE_OVERRIDE` — vocab curé pour tous les niveaux N5→N1 (2211 kanji)
- [x] `SENTENCE_OVERRIDE` — 2 phrases par kanji · N5→N1 · 100% couvert
  - N5 (79) : phrases curées manuellement
  - N4/N3/N2 (900) : Tatoeba réel (harvest 15h) + 53 manuelles pour gaps
  - N1 (1232) : ~1032 Tatoeba réel + ~200 templates offline (fill-n1-gaps.mjs)
  - Audit final : N5 ✅ N4 ✅ N3 ✅ N2 ✅ N1 ✅ (100% tous niveaux)
- [x] Scripts utilitaires : `build-sentence-overrides.mjs` · `inject-sentences.mjs` · `fill-n1-gaps.mjs` · `repair-example-override.mjs` · `check-n1.mjs`
- [x] `scripts/audit-kanji-quality.mjs` — audit KUN/ON qualité par kanji → génère `kanji-status.json` · statuts : `ok` / `phrase-missing` / `vocab-missing` / `both-missing`
- [x] `kanji-status.json` — 2211/2211 kanji `status: ok` + `locked: 2026-05-13` (skip auto à la génération sans `--force`)
- [x] `generate-kanji-cards.mjs` : flag `--force` · skip auto si kanji déjà locked · dossiers renommés `insta/` → `cards/` · `reels/` → `real/`

**Reels TikTok — 13 Mai 2026 → 14 Mai 2026**
- [x] `scripts/generate-reels.mjs` — génère des reels 1080×1920 MP4 ~33s par kanji
  - Structure : `2s intro` + `6s` carte 1 + `7s` carte 2 + `9s` carte 3 + `7s CTA` + `2s fondu noir` = **33s**
  - Intro : carte 1 floutée + assombrie + overlay `kanji-cards/text-intro.png` (PNG manuel, centré) · silence (pas de TTS)
  - Cartes 1–3 : VOICEVOX speaker 16 (九州そら) · gaps dynamiques par `assembleWithDynamicGaps()` (minGap adaptatif)
  - Card 1 : lectures KUN+ON individuelles, max 6, gaps dynamiques (minGap 0.6s / 6s)
  - Card 2 : vocab individuel, gaps dynamiques (minGap 0.8s / 7s)
  - Card 3 : 2 phrases, gap adaptatif `max(1.0, (9 - dur1 - dur2) / 3)`
  - CTA : `CTA_Footage.mp4` (fallback vidéo) + overlay `kanji-cards/text-cta.png` centré · durée 7s
  - BGM : `kanji-cards/bgm.mp3` · fade in 1.5s · fade out calé sur fondu noir final · volume via `--bgm-vol`
  - Crossfade : 1.0s intro→card1 (reveal fluide) · 0.6s entre les autres segments
  - Audio : xfade dissolve + acrossfade, re-encodé aac 128k
  - Overlays texte via PNG transparents (police libre, indépendant de ffmpeg drawtext)
  - Output : `kanji-cards/{level}/reels/{kanji}.mp4`
  - CLI : `--speaker 16 --speed 1.1 --bgm-vol 0.07`
- [x] `scripts/generate-hook-png.mjs` — génère `kanji-cards/text-intro.png` (hook PNG intro uniquement)

**QA phrases dupliquées + améliorations cartes — 14 Mai 2026** ← commits `d9153ac` → `6ad85ad` (main)
- [x] `scripts/_check-dupes.mjs` — détecte les phrases dupliquées (JP ou EN identique) dans SENTENCE_OVERRIDE — 71 trouvées
- [x] `scripts/_patch-dupes.mjs` — remplace les dupes dans `src/kanji.js` — 65 patchées / 6 not found
- [x] `generate-kanji-cards.mjs` — auto-fit font (taille adaptée à la longueur de la signification) + vocab coverage pass à chaque génération
- [x] `src/kanji.js` — 65 phrases dupliquées remplacées par des alternatives uniques

**Clean kanji-cards + refacto dossiers — 14 Mai 2026**
- [x] Structure finale par level : `cards/` (PNG 1080×1080 Instagram) · `reels/` (PNG 1080×1920 TikTok portrait + MP4)
- [x] Suppression dossiers test/preview : `preview/` `preview2/` `preview3/` `test-kunon/` `test-merge2/` `font-test/` `n3/`
- [x] Suppression contenu test n5 : `n5/insta/` `n5/real/` `n5/reels/` (vieux MP4 de test)
- [x] `n5/tiktok/` → `n5/reels/` · `n4/tiktok/` → `n4/reels/`
- [x] `generate-kanji-cards.mjs` : output portrait `tiktok/` → `reels/`
- [x] `generate-reels.mjs` : lit depuis `reels/` (was `tiktok/`) · output MP4 dans `reels/` (was `real/`)
- [x] 4 phrases trop longues N4 fixées (使/医/英/試 ≤ 20 chars) + 3 doublons EN corrigés (酒/衝/賀)

**Vocab Reels — 15 Mai 2026**
- [x] **80/80 reels générés** → `vocab-cards/reels/` ✅
- [x] VPS : `/var/www/kanji/reels/n5/` (79 kanji MP4) + `/var/www/kanji/reels/vocab/` (80 vocab MP4)

**Buffer Scheduling — 16 Mai 2026**
- [x] `scripts/schedule-buffer.mjs` — GraphQL v2 · kanji (minuit) + vocab (midi) · TikTok + Instagram
- [x] `scripts/clear-buffer-queue.mjs` — vide la queue Buffer
- [x] 17/05 → 19/05 : postés **manuellement** dans Buffer UI
- [x] 20/05 → 10/06 : schedulés par le script (89 posts)
- ⏳ 11/06 → ~04/08 : en attente reset rate limit Buffer (~24h)
- **Next** : `node scripts/schedule-buffer.mjs --platform both --start 2026-06-11`
- Batch suivants : 2026-07-03, puis 2026-07-25 (`--count 13`)

**Assets locaux (non trackés dans git)**
- `kanji-cards/` — PNG 1080×1080 (insta) + 1080×1920 (tiktok) + MP4 kanji reels → gitignored
- `vocab-cards/` — MP4 vocab reels → non tracké
- `.env` — BUFFER_TOKEN, BUFFER_TIKTOK_ID, BUFFER_INSTAGRAM_ID → **ne jamais commiter**
- MP4s en prod sur le VPS : `/var/www/kanji/reels/`

---

## Setup nouvelle machine

```bash
# 1. Cloner le repo
git clone https://github.com/Guimomo09/Kanji-Morning.git
cd Kanji-Morning
npm install

# 2. Python (pour vocab reels)
pip install edge-tts

# 3. Outils système
# macOS :
brew install ffmpeg node
# Windows :
# → ffmpeg : https://ffmpeg.org/download.html (ajouter au PATH)
# → Node.js : https://nodejs.org

# 4. VOICEVOX (pour kanji reels — TTS japonais)
# → https://voicevox.hiroshiba.jp/  (dispo Windows + Mac)
# → Lancer l'app avant de générer des reels kanji

# 5. Créer le fichier .env (clés dans password manager)
```

**Contenu du `.env` à recréer :**
```
BUFFER_TIKTOK_ID=<dans password manager>
BUFFER_INSTAGRAM_ID=<dans password manager>
BUFFER_TOKEN=<dans password manager>
```
  - **edge-tts** `ja-JP-NanamiNeural`
  - **6 slides** xfade 0.5s : hook (3s) → ProgA mot (3s) → ProgB +lecture (3s) → ProgC +def (4s) → ProgD +exemple (6s) → CTA (7s) = **~26s** + fade out 1.5s
  - `visibility:hidden` (espace réservé) → aucun déplacement lors des transitions
  - Fond dégradé rouge `#c03a20 → #8b2510` · logo header centré sur chaque slide
  - Mot prononcé ProgA (0.3s silence) + ProgB (0.3s silence) · exemple prononcé ProgD (0.6s silence)
  - Exemple réel depuis **Tatoeba** API · mot surligné en `#ffe0b2`
  - **Furigana kuromoji** sur la phrase exemple (ruby HTML) · lecture masquée sur le mot principal
  - **CTA HTML** — slide rouge "Make Japanese part of your daily routine." + asanokanji.com
  - Fade to black 1.5s sur la fin du CTA
  - CLI : `--words`, `--from-kanji`, `--level`, `--count`, `--bgm-vol`, `--dry-run`
  - Output : `vocab-cards/reels/{word}.mp4` (flat)
- [x] VPS : kanji reels déplacés dans `/reels/n5/` (79 MP4)
- [x] Génération 80 reels vocab lancée → `vocab-cards/reels/` (`vocab-gen.log`)
- [x] **VOCAB_SENTENCE_OVERRIDE** — 80 phrases desu/masu curatées (voyage/quotidien) · priorité sur Tatoeba
- [x] **WORD_DICT_FORM** — 22 stems → formes dictionnaire (分か→分かる, 食べ→食べる, 行け→行く…)
- [x] Lecture + définition + TTS basés sur la forme dictionnaire (plus de `わか` ni `分か` dans les slides)
- [x] Voix sur ProgB (lecture hiragana révélée) — ProgA kanji silencieux
- [x] `WORD_DEF_OVERRIDE` — fix 息子 (son) + 仲間 (companion, colleague)
- [x] **80/80 reels générés** → `vocab-cards/reels/` ✅

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

