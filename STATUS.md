# 📊 STATUS — Kanji Morning & Projets

> Dernière mise à jour: 30 Avril 2026 — Services inventory + Mobile en cours
> **À mettre à jour à chaque changement majeur**

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
