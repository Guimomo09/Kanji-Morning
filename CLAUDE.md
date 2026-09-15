# Kanji Morning (asanokanji.com)

App d'apprentissage du japonais (JLPT N5→N1) : kanji, vocab, quiz SRS, exam mode.
Génère aussi des reels vidéo (kanji/vocab) postés automatiquement sur TikTok/Instagram via Buffer.

## Stack

- Vanilla JS ES modules (`src/`), pas de framework — Vite 8 pour dev/build
- Firebase Auth (Google) + Firestore (cloud sync) — clé API Firebase publique par design (sécurité = Firestore Rules, pas la clé)
- kanjiapi.dev pour les données kanji/vocab
- Stripe (Payment Link, one-time €7.99) pour Premium
- Scripts Node (`scripts/*.mjs`) : génération de cartes/reels (ffmpeg, sharp, edge-tts, playwright), scheduling Buffer (GraphQL)

## Environments

- **Local dev** : `npm run dev` (Vite)
- **Staging** : push sur `dev` → déploie auto sur `kanji.guimo-prod.com` (protégé basic_auth)
- **Production** : push sur `main` → déploie auto sur `asanokanji.com`
- Déploiement = GitHub Actions → SSH vers VPS Hetzner → `npm run build` → copie `dist/`
- **Ne jamais push/merger sur `main` sans demande explicite.** Workflow obligatoire : `dev` → tester sur staging → merge vers `main`.

## Chemins importants

- `src/` — code app (config.js, main.js, vocab.js, quiz.js, cloud.js, etc.)
- `scripts/` — pipeline génération contenu (cartes, reels, i18n dictionnaires, Buffer scheduling)
- `kanji-cards/`, `vocab-cards/` — médias générés (gitignored, gros volumes, régénérables)
- `.vocab-tmp/`, `.reels-tmp/` — dossiers temporaires du pipeline reels (gitignored) ; doivent être auto-nettoyés en fin de script, un run interrompu peut en laisser des traces sans conséquence
- `STATUS.md` — journal historique détaillé du projet (contexte long, ne pas dupliquer ici)
- `.github/agents/` — agents custom (Beta Client Léa, Feedback Coach) pour retours UX simulés

## Règles permanentes

- Ne jamais confondre staging et production ; toujours valider sur `dev`/staging avant `main`
- Aucun secret réel dans le code, la doc, ou les scripts trackés — `.env` est gitignored, `.env.example` ne contient que des noms de variables
- Les scripts de génération de contenu (reels, cartes) et de scheduling Buffer sont sensibles au rate-limit — ne jamais lancer un batch complet sans `--offset`/reprise si un run précédent a été interrompu
- `kanji-cards/`, `vocab-cards/`, `dist/` sont gitignored : ne pas essayer de les committer

## Workflow

```
npm run dev       # serveur local Vite
npm run build     # build production → dist/
npm run preview   # preview du build
```

Pipeline contenu (usage ponctuel, voir `scripts/` pour flags détaillés) :
- `scripts/generate-reels.mjs` — reels kanji
- `scripts/generate-vocab-reels.mjs` — reels vocab
- `scripts/schedule-buffer.mjs` — programmation posts TikTok/Instagram via Buffer

## Efficacité (règles de session Claude)

- Pas d'exploration large du repo si l'info est déjà connue ou dans ce fichier / `PROJECT_STATUS.md`
- Pas de subagent pour une recherche/modif simple (CSS, petit JS, texte, config) — lecture ciblée + Grep/Glob directs
- Pas de `/run` ni Playwright pour une modif visuelle/simple — laisser l'utilisateur vérifier, sauf demande explicite ou bug runtime réel
- Mettre à jour `PROJECT_STATUS.md` en fin de tâche importante ; ne mettre à jour ce fichier que si une règle stable change
