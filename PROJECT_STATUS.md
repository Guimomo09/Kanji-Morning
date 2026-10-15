# Project Status

> Historique détaillé complet : `STATUS.md`. Ce fichier ne contient que l'état actuel.

## Current state

Kanji Morning est en production (asanokanji.com), Premium Stripe live, i18n 5 langues, PWA installable.
Campagne contenu N4 (kanji + vocab reels) terminée et programmée sur Buffer jusqu'à mi-janvier 2027.
Nouveau format de reel "Quick review" (rappel kanji déjà publié) prototypé et validé sur `dev`, pas encore généré en volume.

## Recently completed

- Nouveau pipeline reel "Quick review" (`scripts/generate-quiz-reels.mjs` + `scripts/reels/`) : reel de rappel (pas de première découverte) testant la lecture d'un mot déjà publié — DA alignée sur les vraies cartes de l'app (bandeau rouge, badges ON/KUN), romaji sous chaque kana, centrage optique auto pour le texte CJK mixte, timing calé sur la durée réelle mesurée des voix edge-tts, tick de décompte + musique de fond. Prototype validé sur 聞く (きく) — voir `kanji-cards/reels-v3/quiz/kiku-listen.mp4` (gitignored, à régénérer localement).
- Vérification globale kanji/vocab vs Jisho (`scripts/verify-against-jisho.mjs`, nouveau script) : 8567 entrées comparées (kanji_index.json, vocab affiché dans l'app `src/kanji.js`, et `vocab-db.json`). 542 signalées par l'heuristique, relecture manuelle → 6 vraies erreurs corrigées (mauvais kanji 且て→且つ又, sens trop étroit/faux/manquant pour 留まる, 場所, 重量, 皇后 [reine→impératrice], 全米). Le reste des signalements étaient des doubles-sens légitimes (ex: 社 = company ET shrine), pas des erreurs.
- Campagne N4 Buffer (kanji+vocab) : 166/166 programmés TikTok (fin 18/01/2027) et Instagram (fin 25/01/2027)
- Fix `scripts/generate-vocab-reels.mjs` (encodage japonais cassé depuis mai) — restauré et commité (`2b0b53b`)
- Découverte : `--level` non câblé dans `generate-vocab-reels.mjs` pour la sélection par défaut (utiliser `--from-kanji`)

## Next

- Lancer un premier lot de reels "Quick review" sur d'autres kanji déjà publiés (pipeline validé, pas encore utilisé en volume)
- Décider quoi faire des 70 vocab reels N4 générés mais non programmés (lot "vocab-only" à construire dans `schedule-buffer.mjs`, ou réserve pour N3)
- Auditer les 9 posts Buffer en erreur de la campagne N5 (8 TikTok + 1 Instagram, non bloquants)
- Préparer N3 : même pipeline (cartes → reels → upload VPS → Buffer), à lancer après épuisement N4

## Known issues

- Rate limit Buffer variable et imprévisible (de ~98 à ~188 appels avant blocage) — toujours prévoir une reprise le lendemain avec `--offset`
- 9% du vocab (JMdict) sans traduction disponible (EN 81%, FR/DE/ES/RU 91%) — plafond des sources open data atteint

## Important decisions

- Firestore = source de vérité unique pour `savedWords` (plus de merge côté client qui pouvait écraser le cloud avec une liste locale incomplète)
- `.vocab-tmp/` maintenant gitignored (dossier de travail temporaire du pipeline reels, jamais destiné à être suivi)
- Vérification Jisho = garde-fou, jamais une source de vérité à copier telle quelle : le premier sens remonté par Jisho/JMdict n'est souvent pas le plus pertinent pédagogiquement (ex: 高 → Jisho priorise "quantity" alors qu'un N5 doit retenir "tall, expensive"). Toute divergence détectée passe par une relecture humaine avant correction, jamais de fix automatique sur ces données.
