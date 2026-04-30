# 📊 STATUS — Kanji Morning & Projets

> Dernière mise à jour: 1 Mai 2026 (soir)
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
- [x] Génération vocabulaire par niveau JLPT (N4/N3/N2/N1)
- [x] Filtre niveau kanji (pills N1-N4)
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

### 🟡 À faire
- [ ] Domaine Firebase Auth — ajouter `kanji.guimo-prod.com` aux domaines autorisés
- [ ] Notifications / rappel quotidien
- [ ] CMS stack (Directus ?)

---

## 💰 Services & Abonnements

| Service | Usage | Prix |
|---------|-------|------|
| **Firebase** | Auth + Firestore | Gratuit |
| **kanjiapi.dev** | API kanji/vocab | Gratuit |
| **Cloudflare** | DNS + CDN | Gratuit |
| **Hetzner CX22** | VPS | ~4€/mois |
| **Domaine guimo-prod.com** | — | ~10€/an |

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

**URL**: https://kanji-morning.netlify.app  
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
**Domaine**: À acheter (Cloudflare Registrar recommandé)  
**CMS Stack**: À décider (Directus recommandé)  
**Architecture finale**: Hetzner CX22 + Cloudflare CDN (mondial)  
**Statut**: ⏳ En attente commande VPS

### Étapes à faire (dans l'ordre)
- [ ] 1. Créer compte Cloudflare → cloudflare.com
- [ ] 2. Acheter domaine via Cloudflare Registrar (~10€/an)
- [ ] 3. Commander Hetzner CX22 → hetzner.com (Ubuntu 24.04, Helsinki)
- [ ] 4. Setup VPS : SSH + Docker + Caddy
- [ ] 5. Pointer domaine DNS vers IP Hetzner via Cloudflare
- [ ] 6. Déployer Kanji Morning sur le VPS
- [ ] 7. Mettre à jour domaines autorisés Firebase Auth
- [ ] 8. Décider et installer CMS (Directus recommandé)

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
