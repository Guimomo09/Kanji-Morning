# 📊 STATUS — Kanji Morning & Projets

> Dernière mise à jour: 3 Mai 2026 (Stripe Premium live — webhook VPS, upgrade modal, 30-word gate, exam mode gate, icônes PWA iOS)
> **À mettre à jour à chaque changement majeur**

---

## 🌐 Infrastructure — ÉTAT ACTUEL

| Composant | État | Détail |
|-----------|------|--------|
| **VPS** | ✅ Actif | Hetzner CX22 · Ubuntu 24.04 · `95.216.168.28` |
| **Caddy** | ✅ Actif | Reverse proxy + SSL auto sur le VPS |
| **Domaine** | ✅ Actif | `guimo-prod.com` via Cloudflare |
| **DNS** | ✅ Configuré | A record `kanji` → `95.216.168.28` · proxy orange ☁️ |
| **URL prod** | ✅ Live | https://kanji.guimo-prod.com |
| **Deploy** | ✅ Auto | GitHub Actions → SCP `dist/` → `/var/www/kanji/` |
| **HTTPS** | ✅ Actif | Caddy gère le certificat automatiquement |
| **Proxy Tatoeba** | ✅ Actif | `/api/tatoeba` → reverse proxy `tatoeba.org` (fix CORS) |

### Caddyfile (`/etc/caddy/Caddyfile`)
```
kanji.guimo-prod.com {
    root * /var/www/kanji
    file_server
    encode gzip
    reverse_proxy /stripe-webhook localhost:3001
    header {
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        -Server
    }
}
```

---

## 🔥 Kanji Morning — État actuel

**URL prod**: https://kanji.guimo-prod.com  
**Stack**: Vite 8 · 21 modules ES · Firebase Auth + Firestore · kanjiapi.dev · Tatoeba (via proxy)  
**Deploy**: push sur `main` → GitHub Actions → dist/ → VPS  
**Dernier commit**: `87cc5f4`

### ✅ Fonctionnel
- [x] Génération vocabulaire par niveau JLPT (N5/N4/N3/N2/N1)
- [x] Filtre niveau kanji (pills N5-N1)
- [x] Sauvegarde kanji (★ button) → My List
- [x] My List — 2 sections : 漢字 chips + 語彙 table
- [x] Mode "From Kanji" — vocab depuis kanjis sauvegardés
- [x] Quiz daily + Weekly Challenge + SRS (SM-2 — injected silently in daily quiz, bouton Review supprimé)
- [x] Firebase Auth (login Google) + Cloud sync Firestore
- [x] PWA — manifest + service worker v3 + icônes (installable mobile)
- [x] Cache API 24h TTL (localStorage)
- [x] Cloud sync fix — mots supprimés ne reviennent plus après re-login
- [x] Batch multi-select delete dans My List (shift+clic, barre flottante)
- [x] **My List mobile** — tap individuel ✅ + drag-to-select au doigt (style iOS Photos) ✅ + barre flottante au-dessus de la navbar ✅ + chip ✓ grande zone tactile ✅
- [x] **JLPT Target tile** — description du niveau actif seulement (ex: "Beginner"), taille de tile stable
- [x] **KPI tiles** — centrées verticalement (flex) ; JLPT align-top, WOTD layout préservé
- [x] **Streak nudge** — "☁️ Sign in to sync" si non connecté (--sub, tappable)
- [x] **Debug code supprimé** — `window.onerror` alert popup + `console.log('[openSettings]')` retirés
- [x] **My List desktop select** — click sur ✓ → entre select mode + toggle ; drag depuis ✓ → multi-sélect ; sélection visible (teinte rouge + bordure gauche)
- [x] **Scroll-to-top** — `switchTab()` scroll toujours en haut + `history.scrollRestoration='manual'` + rAF au startup
- [x] **Tab persistence** — `localStorage km_tab` → refresh reste sur l'onglet courant
- [x] **My List — click ouvre détail** — kanji chip → fiche kanji, ligne mot → fiche mot (font fluide)
- [x] **My List table** — 4 colonnes (date masquée, visible dans la fiche) ; sens tronqué avec ellipsis
- [x] **WOTD** — mot aléatoire quotidien (seed mulberry32 sur date ISO) + font-size fluide
- [x] **Footer** — padding suffisant sur mobile pour ne pas coller aux tabs de nav (`safe-area-inset-bottom`)
- [x] **Privacy Policy** — `public/privacy.html` RGPD complet (Firebase, Stripe, droits utilisateur) + lien dans footer
- [x] **Paywall soft warning** — My List affiche bannière jaune à 24/30 mots, rouge à 30/30 avec CTA "€7.99 one-time"
- [x] **Long-press hint** — "💡 Long press to select" visible uniquement sur mobile (`pointer: coarse`)
- [x] **WOTD Save CTA** — bouton "＋ Save this word" sur la tile Home, devient "✓ Saved" si déjà sauvegardé
- [x] **Crisp** — renommé "Asa no Kanji", opérateur "Support" (nom perso masqué)
- [x] Filtre de complexité des mots par niveau JLPT
- [x] Tri des définitions : sens courants en premier
- [x] **Noto Sans JP** — police chargée depuis Google Fonts (poids 700+900)
- [x] **Header redesign** — layout 3 colonnes (date | 朝の漢字 | login+⚙️), dégradé rouge
- [x] **Home grid** — Streak / Words / Today's Word (WOTD saisonnier) / JLPT Target (tap to cycle)
- [x] **Word of the Day** — saisonnier, déterministe par jour du mois (wotd.js)
- [x] **JLPT Goal** — tap KPI card → cycle N5→N4→N3→N2→N1, progress %, "Start saving words!" si 0%
- [x] **Exam Mode** — 7 min, 20 questions, pass/fail 60%, filtré par niveau JLPT cumulatif, onglet My List uniquement
- [x] **Weekly Challenge** — (ex Bi-Weekly Quiz) tous les lundis
- [x] **Stats tab** — grille 2×2 (Streak / Words Learned / Avg Score / JLPT Target)
- [x] **Bannière "missed"** — ton encourageant "💪 Keep going — one more to catch up!"
- [x] **Phrases d'exemple** — ~~Tatoeba~~ retiré (proxy non fonctionnel, feature supprimée proprement)
- [x] **Tutorial onboarding** — overlay 5 étapes au 1er visit
- [x] **Settings** — **drawer slide-in depuis la droite** (360px desktop, full-width mobile), sans backdrop — uniquement fermable via ← Retour ou Save (fix définitif ghost click iOS)
- [x] **Sign out** — demande une confirmation avant de déconnecter (évite les misclicks)
- [x] **iOS Safari compat** — `window.Notification?.permission` au lieu de `Notification?.permission` (ReferenceError si API absente sur iOS)
- [x] **Crisp** — widget SAV, bulle **cachée sur mobile** (chat:hide API), accessible via hamburger menu
- [x] **Hamburger menu mobile** — remplace ⚙️ sur mobile → dropdown avec Settings + Chat (iOS ghost click fix)
- [x] **Stripe Premium** — €7.99 one-time · Payment Link TEST `buy.stripe.com/test_cNi3cx...` · webhook Node.js/Express sur VPS (PM2, port 3001) · Caddy proxy `/stripe-webhook` · Firestore `users/{uid}.premium=true` · upgrade modal (contextes: limit/exam/generic) · 30-word hard gate · Exam Mode gate · success modal `?premium=success` · upgrade card Home

### 🟡 À faire / en cours
- [ ] **Stripe LIVE** — passer en mode production (nouveau Payment Link + sk_live + whsec live + update config.js)
- [ ] Notifications push background (Push API + serveur) — opt-in local ✅, push serveur manquant

---

## 💰 Services & Abonnements

| Service | Usage | Prix | Compte |
|---------|-------|------|--------|
| **Firebase** | Auth + Firestore (Kanji Morning) | Gratuit | guimoprod.dev@gmail.com |
| **Crisp** | Live chat SAV (Kanji Morning) | Gratuit | guimoprod.dev@gmail.com |
| **kanjiapi.dev** | API kanji/vocab | Gratuit | — |
| **Cloudflare** | DNS + CDN + Email Routing | Gratuit | guimoprod.dev@gmail.com |
| **Hetzner CX22** | VPS `95.216.168.28` | ~4€/mois | — |
| **Domaine guimo-prod.com** | — | ~10€/an | — |

### 📧 Emails (Cloudflare Routing → guimoprod.dev@gmail.com)
| Adresse | Usage |
|---------|-------|
| `support@guimo-prod.com` | SAV utilisateurs / Crisp |
| `billing@guimo-prod.com` | Stripe / facturation |

---

## 🤖 Agents VS Code

| Agent | Rôle |
|-------|------|
| **Feedback Coach** | Retours critiques UX/décisions |
| **Beta Client (Léa)** | Simule un vrai utilisateur |

---

## 🌐 Infrastructure — ÉTAT ACTUEL

| Composant | État | Détail |
|-----------|------|--------|
| **VPS** | ✅ Actif | Hetzner CX22 · Ubuntu 24.04 · `95.216.168.28` |
| **Caddy** | ✅ Actif | Reverse proxy + SSL auto sur le VPS |
| **Domaine** | ✅ Actif | `guimo-prod.com` via Cloudflare |
| **DNS** | ✅ Configuré | A record `kanji` → `95.216.168.28` · proxy orange ☁️ |
| **URL prod** | ✅ Live | https://kanji.guimo-prod.com |
| **Deploy** | ✅ Auto | GitHub Actions → SCP `dist/` → `/var/www/kanji/` |
| **HTTPS** | ✅ Actif | Caddy gère le certificat automatiquement |

### Caddyfile (`/etc/caddy/Caddyfile`)
```
kanji.guimo-prod.com {
    root * /var/www/kanji
    file_server
    encode gzip
    header {
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        -Server
    }
}
```

---

## 🔥 Kanji Morning — État actuel

**URL prod**: https://kanji.guimo-prod.com  
**Stack**: Vite 8 · 20 modules ES · Firebase Auth + Firestore · kanjiapi.dev  
**Deploy**: push sur `main` → GitHub Actions → dist/ → VPS

### ✅ Fonctionnel
- [x] Génération vocabulaire par niveau JLPT (N5/N4/N3/N2/N1)
- [x] Filtre niveau kanji (pills N5-N1)
- [x] Sauvegarde kanji (★ button) → My List
- [x] My List — 2 sections : 漢字 chips + 語彙 table
- [x] Mode "From Kanji" — vocab depuis kanjis sauvegardés
- [x] Quiz daily + Bi-Weekly + SRS (SM-2 ou Simple)
- [x] Firebase Auth (login Google) + Cloud sync Firestore
- [x] PWA — manifest + service worker + icônes (installable mobile)
- [x] Cartes taille uniforme (grid stretch + flex column)
- [x] Cache API préservé lors du Save for Quiz
- [x] Cloud sync fix — mots supprimés ne reviennent plus après re-login
- [x] Batch multi-select delete dans My List — sélection par clic sur chip/ligne, barre flottante "Supprimer"
- [x] Boutons "☑ All / ☐ None" par section (Kanji + Mots séparément)
- [x] Shift+clic + drag-select dans My List
- [x] Bouton "📖 From Kanji" toujours visible — charge les kanjis du jour à la demande
- [x] Vocab tab génère toujours de nouveaux mots (fini le "already saved" au démarrage)
- [x] Filtre de niveau vocab ne persiste plus (repart à "All" à chaque ouverture)
- [x] Filtre de complexité des mots par niveau JLPT — N4/N5: max 2 kanji par mot, N3: max 3, N2/N1: illimité
- [x] Tri des définitions : sens courants en premier, sens spécialisés repoussés en fin
- [x] **N5 level** — pool `/kanji/jlpt-5` (~103 kanji), badge teal, pill de filtre, légende (~2153 kanji total)
- [x] **Visual polish** — lectures kana en brun chaud (#6d4c41), border-radius normalisé (12px/8px), safe area inset iPhone 14+
- [x] **Home hero CTA** — bannière rouge avec titre, tagline, boutons "Start Today's Kanji" + "How it works"
- [x] **Tutorial onboarding** — overlay 5 étapes au 1er visit, accessible à tout moment, fermable via ✕ ou Escape
- [x] **Popup kanji depuis My List** — clic sur chip → fond sombre + blur + détails live (kanji, sens, lectures, exemples)
- [x] **Hiérarchie des cartes** — badge JLPT passe sous le sens (order CSS), flux kanji → sens → badge → lectures → exemples

### 🟡 À faire
- [x] Domaine Firebase Auth — `kanji.guimo-prod.com` ajouté aux domaines autorisés ✅
- [x] SAV — Crisp widget intégré + identification auto utilisateur Firebase (email + displayName)
- [x] **UX round 1** — Hero "10 words every morning", sous-titre "~7 min a day", post-quiz "See you tomorrow" card, empty state My List
- [x] **UX round 2 (agents)** — Hero "7 minutes." dans headline, timer de session visible pendant quiz, opt-in notif PWA 8am dans quiz results, "why build a list" sur My List vide, jargon "spaced repetition" → "smart daily review"
- [x] **Settings modal** — ⚙️ dans le header, toggle notif + time picker accessible à tout moment
- [x] **Header redesign** — layout 3 colonnes (date | titre | login+⚙️), dégradé rouge restauré (premium), icônes tabs monochrome unicode
- [x] **Action cards** — icônes emoji (🎯📅) remplacées par kanji monochromes (試/週), cohérent avec 漢/語
- [ ] Monétisation — Stripe freemium (free: N5/N4, premium: tout + SRS + Stats)
- [ ] Notifications push background (Push API + serveur) — opt-in local déjà en place, push serveur manquant

---

## 💰 Services & Abonnements

| Service | Usage | Prix | Compte |
|---------|-------|------|--------|
| **Firebase** | Auth + Firestore (Kanji Morning) | Gratuit | guimoprod.dev@gmail.com |
| **Crisp** | Live chat SAV (Kanji Morning) | Gratuit | guimoprod.dev@gmail.com |
| **kanjiapi.dev** | API kanji/vocab | Gratuit | — |
| **Cloudflare** | DNS + CDN + Email Routing | Gratuit | guimoprod.dev@gmail.com |
| **Hetzner CX22** | VPS `95.216.168.28` | ~4€/mois | — |
| **Domaine guimo-prod.com** | — | ~10€/an | — |

### 📧 Emails (Cloudflare Routing → guimoprod.dev@gmail.com)
| Adresse | Usage |
|---------|-------|
| `support@guimo-prod.com` | SAV utilisateurs / Crisp |
| `billing@guimo-prod.com` | Stripe / facturation |

---

## 🤖 Agents VS Code

| Agent | Rôle |
|-------|------|
| **Feedback Coach** | Retours critiques UX/décisions |
| **Beta Client (Léa)** | Simule un vrai utilisateur |

---

## � Services & Abonnements

| Service | Usage | Prix | Tier | Renouvellement |
|---------|-------|------|------|----------------|
| **Firebase** (Auth + Firestore) | Login + Cloud sync Kanji Morning | Gratuit | Spark (free) | — |
| **kanjiapi.dev** | API données kanji/vocabulaire | Gratuit | Free | — |
| **Netlify** | Hébergement Kanji Morning (actuel) | Gratuit | Free (limité) | ⚠️ Bloqué |
| **Cloudflare** | Compte créé, domaine en attente | Gratuit | Free | — |
| **Hetzner CX22** | VPS futur — toutes les apps | ~4€/mois | Cloud | Mensuel |
| **Domaine** | À acheter (~guimo-prod ou autre) | ~10€/an | — | Annuel |

### Notes
- Firebase free tier: 1GB Firestore, 10k auth/mois — suffisant pour longtemps
- kanjiapi.dev: open source, pas de clé, pas de quota connu — surveiller si trafic monte
- Netlify: remplacer par Hetzner dès que VPS est en place
- Budget infra cible: **~4€/mois + 10€/an domaine**

---

## �🔥 Kanji Morning — État actuel

**URL prod**: https://kanji.guimo-prod.com/kanji-morning.html ✅  
**Fichier**: `kanji-morning.html` (single-file app)  
**Stack**: HTML/CSS/JS + Firebase Auth + Firestore + kanjiapi.dev

### ✅ Fonctionnel
- [x] Génération vocabulaire par niveau JLPT (N4/N3/N2/N1)
- [x] Filtrage qualité (top 6000 mots modernes seulement)
- [x] Canonical form — formes rares exclues
- [x] Variété POS (verbes, noms, adjectifs)
- [x] Affichage cartes avec "Also:" (formes liées)
- [x] Sauvegarde "Save for Quiz" → localStorage
- [x] My List — tableau cumulatif des mots sauvegardés
- [x] Quiz — 5 formats (kanji↔sens↔lecture)
- [x] Firebase Auth (login Google)
- [x] Cloud sync Firestore (push uniquement)
- [x] Cache clearing auto avant save (fix quota overflow)

### 🟡 En cours / À améliorer
- [ ] UI mobile — non optimisée pour smartphone ⚠️ priorité suivante
- [ ] Spaced repetition — pas encore implémenté
- [ ] Progression JLPT — pas de scoring long terme
- [ ] Notifications / rappel quotidien

### ❌ Problèmes connus
- Aucun bloquant actuel

---

## 🏗️ Infrastructure

**Décision**: Hetzner CX22 (4€/mois) — VPS unique pour toutes les apps

**Plan:**
```
Hetzner CX22 · Ubuntu 24.04
  ├── Caddy (reverse proxy + SSL auto)
  ├── kanji.[domaine].com  → HTML statique
  ├── cms.[domaine].com    → App CMS (stack à décider)
  └── Backups snapshots Hetzner
```
**Domaine**: `guimo-prod.com` ✅ acheté  
**CMS Stack**: À décider (Directus recommandé)  
**Architecture finale**: Hetzner CX22 + Cloudflare CDN (mondial)  
**Statut**: ⏳ En attente commande VPS

- [x] 1. Créer compte Cloudflare → cloudflare.com ✅
- [x] 2. Acheter domaine `guimo-prod.com` via Cloudflare ✅
- [x] 3. DNS CNAME `kanji.guimo-prod.com` → GitHub Pages ✅
- [x] 4. Enforce HTTPS sur GitHub Pages ✅
- [x] 5. Ajouter `kanji.guimo-prod.com` dans Firebase Auth ✅
- [ ] 6. Commander Hetzner CX22 → hetzner.com (Ubuntu 24.04, Helsinki)
- [ ] 7. Setup VPS : SSH + Docker + Caddy
- [ ] 8. Migrer `kanji.guimo-prod.com` → Hetzner (remplace GitHub Pages)
- [ ] 9. Décider et installer CMS (Directus recommandé)

---

## 🤖 Agents VS Code disponibles

| Agent | Rôle | Appel |
|-------|------|-------|
| **Feedback Coach** | Retours critiques sur idées, décisions, UX | `@feedback` dans chat |
| **Beta Client (Léa)** | Simule un vrai utilisateur qui teste l'app | `@beta-client` dans chat |

---

## 📱 Roadmap — Mobilisation

### Phase 0 — Consolidation (actuel)
- [x] Sauvegardes fonctionnelles
- [x] Firebase stable
- [x] Cloud sync cross-device validé ✅ (iOS Safari testé — My List visible)
- [x] `_cloudPull()` réactivé: pull sélectif 30 derniers jours au login
- [x] Nudge login avant Save si non connecté

### Phase 1 — Mobile PWA
- [ ] Ajouter manifest.json (installable sur homescreen)
- [ ] Service Worker (offline mode)
- [ ] Optimiser UI pour mobile

### Phase 2 — Capacitor (iOS/Android natif)
- [ ] Init projet Capacitor
- [ ] Build APK test Android
- [ ] Build IPA test iOS (TestFlight)

### Phase 3 — Freemium
- [ ] Logique free/premium
- [ ] In-app purchase (RevenueCat recommandé)
- [ ] Soumission App Store + Google Play

---

## 📁 Autres Projets en Dev

| Projet | Type | Stack | État |
|--------|------|-------|------|
| Kanji Morning | Web app | HTML/Firebase | ✅ Actif |
| *(à compléter)* | Web | — | — |
| *(à compléter)* | Web + CMS/Backend | — | — |

---

## 📝 Décisions prises

| Date | Décision | Raison |
|------|----------|--------|
| Avr 2026 | Push-only cloud sync | Éviter quota overflow localStorage |
| Avr 2026 | Cache clearing avant save | Fix QuotaExceededError |
| Avr 2026 | kanjiapi.dev (no auth) | Gratuit, suffisant pour JLPT |

---

*Mettre à jour ce fichier à chaque: déploiement, fix majeur, nouvelle feature, ou décision d'architecture.*
