# Project Status

> Historique détaillé complet : `STATUS.md`. Ce fichier ne contient que l'état actuel.

## Current state

Kanji Morning est en production (asanokanji.com), Premium Stripe live, i18n 5 langues, PWA installable.
Campagne contenu N4 (kanji + vocab reels) terminée et programmée sur Buffer jusqu'à mi-janvier 2027.

## Recently completed

- Campagne N4 Buffer (kanji+vocab) : 166/166 programmés TikTok (fin 18/01/2027) et Instagram (fin 25/01/2027)
- Fix `scripts/generate-vocab-reels.mjs` (encodage japonais cassé depuis mai) — restauré et commité (`2b0b53b`)
- Découverte : `--level` non câblé dans `generate-vocab-reels.mjs` pour la sélection par défaut (utiliser `--from-kanji`)

## Next

- Décider quoi faire des 70 vocab reels N4 générés mais non programmés (lot "vocab-only" à construire dans `schedule-buffer.mjs`, ou réserve pour N3)
- Auditer les 9 posts Buffer en erreur de la campagne N5 (8 TikTok + 1 Instagram, non bloquants)
- Préparer N3 : même pipeline (cartes → reels → upload VPS → Buffer), à lancer après épuisement N4

## Known issues

- Rate limit Buffer variable et imprévisible (de ~98 à ~188 appels avant blocage) — toujours prévoir une reprise le lendemain avec `--offset`
- 9% du vocab (JMdict) sans traduction disponible (EN 81%, FR/DE/ES/RU 91%) — plafond des sources open data atteint

## Important decisions

- Firestore = source de vérité unique pour `savedWords` (plus de merge côté client qui pouvait écraser le cloud avec une liste locale incomplète)
- `.vocab-tmp/` maintenant gitignored (dossier de travail temporaire du pipeline reels, jamais destiné à être suivi)
