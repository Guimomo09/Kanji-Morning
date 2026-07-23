# STATUS — Kanji Morning

> Dernière mise à jour: **2 Juin 2026** · N4 reels en cours · Vocab reels N5 ✅

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

**Reels TikTok — 13 Mai 2026** ← `da85cb7` + `bcc0e1f` (restructure + edge-tts)
- [x] `scripts/generate-reels.mjs` — génère des reels 1080×1920 MP4 · **36s dynamique** par kanji
  - Structure : `3s intro` + `8s kanji` + `8s vocab` + `9s phrases` + `8s CTA` = **36s total** (xfade 0.5s entre segments)
  - Intro : carte 1 floutée (boxblur+darken) + overlay `kanji-cards/text-intro.png` · **silence** (hook visuel)
  - Cartes 1–3 : PNG TikTok + voix **edge-tts Nanami** (ja-JP) · audio centré dynamiquement avec gaps équilibrés
  - CTA : `kanji-cards/CTA_Static.png` (fallback `CTA_Footage.mp4`) + overlay `text-cta.png` centré à t=1.5s
  - Concat via `concatWithXFade` — xfade dissolve + acrossfade · re-encodé H.264 baseline 30fps aac 128k
  - Cards source : `kanji-cards/{level}/cards/{kanji}/` · Output : `kanji-cards/{level}/reels/{kanji}.mp4`
  - Fix 2 Juin 2026 : chemins corrigés (`kanjicards/.staging` → `kanji-cards/{level}/cards`) · cards préservées après génération
- [x] N5 kanji reels : **79/79** ✅ · format ~36s · ~470 kb/s · ~2MB
- [x] N5 vocab reels (`scripts/generate-vocab-reels.mjs`) : **80/80** ✅ · voix Nanami · furigana ruby · CTA HTML · `vocab-cards/reels/` ← `b563979`

**Tile streak switchable** ← commit `d29e0d4` (8 Mai 2026)
- [x] Tile streak cliquable — cycle 🔥 Day Streak ↔ 📅 Days This Month (`computeMonthlyCount()`)
- [x] Préférence persistée en `localStorage` (`km_streak_tile_view`)
- [x] Fonctionne Home + Stats · i18n 5 langues
- [x] CSS hover `.kpi-streak` (pattern identique JLPT tile)

**Favicon & Logo** ← commits `e01a826`, `4d843a5` (8 Mai 2026)
- [x] Favicon remplacé — inline base64 → `/icons/icon-192.svg` direct
- [x] Modal tuto welcome : kanji 朝 remplacé par le vrai logo SVG (5 langues)
- [x] SW cache bumped v6 → v7 pour forcer invalidation clients

**Push notifications — Mai 2026** ← commits `eaec03e` → `ce9d4d7`
- [x] Modal opt-in : backdrop opaque · no emoji · texte localisé 5 langues
- [x] Toggle feedback : état bloqué/non supporté · sync avec état réel subscription
- [x] Heure de push persistée dans Firestore · sync au démarrage

**XP / Grains — Mai 2026** ← commit `c288e71`
- [x] Système XP avec barre de progression (home) · shop · badges calendrier · section profil stats

**Quiz amélioré — Mai 2026** ← commit `0e6bd47`
- [x] Définition au reveal · distracteurs intelligents · retry réponses fausses

**Stats redesign — Mai 2026** ← commits `dbc4808` → `9885bc1`
- [x] Avatar profil · graphiques toujours visibles · accordéons récompenses · calendrier épuré

**Vocab cards UI — Mai 2026** ← commits `14a5bbe` + `f8663bf`
- [x] Cartes vocab plus grandes (min-height · fonts agrandies) · composants kanji · zoom modal · lien Jisho · save kanji depuis vocab

**My List — Juin 2026** ← commits `212d05d` → `4075634`
- [x] Bouton back-to-top flottant (arrow → noir)

**Fix mobile scroll — Juin 2026** ← commit `dd0e4a6`
- [x] Stabilité header/tabbar sur iOS PWA (scroll)

**Buffer auto-post — Mai 2026** ← commit `ec11be2` + `fa3f871`
- [x] `scripts/schedule-buffer.mjs` — post kanji/vocab vers Buffer (minuit/midi alterné) · GraphQL v2
- [x] Planifié 20/05 → 30/06 · vocab-cards gitignored

**Buffer N5 reprise — 3 Juin 2026**
- [x] TikTok : `--offset 25 --start 2026-06-11` — 100/108 posts envoyés (rate limit sur 雨 31/07)
- [x] Instagram : 0/108 (rate limit immédiat — même session)
- Cause : `--platform both` original = 2 API calls/post → rate limit à ~50 paires

**4 Juin 2026 :**
- [x] TikTok N5 : 8 restants ✅ (雨/電/食/高 → 31/07→03/08) — N5 TikTok **COMPLET**
- [x] Instagram N5 : 91/108 ✅ (rate limit sur 車 27/07) · 1 erreur API (殺人 vocab 10/07)
- [x] Instagram N5 fin : 8 restants ✅ (車/金/長/間 → 27/07→03/08) — N5 Instagram **COMPLET**
- [x] N4 TikTok tenté → 0 schedulés · 84 erreurs 404 (reels N4 pas sur VPS) · rate limit brûlé

**État Buffer — 9 Juin 2026**
- ✅ N5 TikTok : 79/79 kanji + 79 vocab · jusqu'au 03/08/2026
- ✅ N5 Instagram : 79/79 kanji + 79 vocab · jusqu'au 03/08/2026
- ❌ N4 TikTok : 0/166 — bloqué, reels pas sur VPS
- ❌ N4 Instagram : 0/166 — bloqué, reels pas sur VPS

**⚠️ Prochaines étapes Buffer N4 :**
1. **Uploader reels N4 sur VPS** (SSH/rsync vers `/var/www/kanji/reels/n4/`)
   → 166 fichiers dans `kanji-cards/n4/reels/*.mp4`
2. Vérifier : `curl -I https://asanokanji.com/reels/n4/%E4%B8%80.mp4` → doit retourner 200
3. **TikTok N4** : `node scripts/schedule-buffer.mjs --level n4 --platform tiktok --kanji-only --start 2026-08-04`
4. **Instagram N4** : `node scripts/schedule-buffer.mjs --level n4 --platform instagram --kanji-only --start 2026-08-04`
   → Attention rate limit ~100 posts/session → 2 sessions par plateforme si 166 kanji

**Debug Buffer — 24 Juin 2026**
- ✅ Cause des échecs : BUFFER_TOKEN expiré (UNAUTHENTICATED) → nouveau token généré dans `.env`
- ✅ Fix `scripts/post-reels.mjs` : endpoint corrigé (`/graphql` manquait) + fail-fast UNAUTHENTICATED
- ✅ Fix `scripts/schedule-buffer.mjs` : vérification auth au démarrage + fail-fast clair
- ✅ Planning N5 intact : 9 800 posts schedulés TikTok + Instagram jusqu'au **05/08/2026**
- ✅ VPS up (ping bloqué par Hetzner = normal) · 79 kanji + 80 vocab MP4 en sync local/VPS
- ⚠️ 4 posts en erreur (passé, non bloquants) :
  - `息子` kanji (24/06) TikTok + Instagram → jamais généré, absent local ET VPS
  - `学` vocab (23/06) Instagram → ancien vocab-cards avec kanji simples, disparu
  - `四` vocab (15/06) TikTok → idem
- ℹ️ `息子` optionnel à générer : `node scripts/generate-reels.mjs --kanji 息子 --level n5`
  puis uploader sur VPS et poster manuellement

---

## Contenu N4 — État 9 Juin 2026

| Contenu | État | Détail |
|---------|------|--------|
| N4 tiktok cards PNG | ✅ | 166/166 kanji · 3 PNG · `kanji-cards/n4/tiktok/` · 1080×1920px |
| N4 kanji reels | ✅ | 166/166 · `kanji-cards/n4/reels/*.mp4` · 36s · locaux seulement |
| N4 vocab reels | ❌ | `generate-vocab-reels.mjs` à fixer avant de lancer |
| N4 reels sur VPS | ❌ | À uploader via SSH/rsync |

---

### 🟡 Prochaines étapes

**Priorité haute**
- [x] ~~**Stripe LIVE**~~ — ✅ 7 Mai 2026
- [x] ~~Notifications push~~ — ✅ modal + toggle + Firestore sync
- [x] ~~N4 kanji reels~~ — ✅ 166/166 générés localement
- [ ] **Upload N4 reels sur VPS** → SSH/rsync `kanji-cards/n4/reels/` → `/var/www/kanji/reels/n4/`
- [ ] **Schedule Buffer N4** → TikTok + Instagram · kanji-only · start 2026-08-04
- [ ] **N4 vocab reels** — fixer `generate-vocab-reels.mjs` puis générer ~166 mots

**Priorité moyenne**
- [x] ~~Analytics~~ — Umami self-hosted ✅
- [x] ~~i18n Phase 2~~ — EN 81% · FR 91% · DE 91% · ES 91% · RU 91% ✅
- [x] ~~Buffer auto-post~~ — planifié jusqu'au **05/08/2026** ✅ (token regénéré 24/06)

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

