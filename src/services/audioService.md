# `audioService.js`

> **Module de données pur — état partagé du pipeline audio (Maps en mémoire + constantes).**
> `src/services/audioService.js`
> Module : [`services/`](./README.md)

## Résumé

Source de vérité unique pour les structures de données du pipeline audio (Opus → PCM → RMS/dB → FFT → bandes de fréquences). N'expose aucune fonction de traitement — celles-ci vivent dans [`bot/audio.js`](../bot/audio.md). C'est un module **stateful sans encapsulation** : tout est exporté tel quel sous forme de `Map` mutable, ce qui couple fortement les producteurs (`bot/audio.js`) aux consommateurs (`routes/levels.js`, `routes/emotion.js`, etc.).

## Exports

### `userLevels` — `Map<userId, { db, speaking, freq, formants, ... }>`

**Brève** : niveaux audio courants par utilisateur, mis à jour toutes les ~50 ms.
**Comportement actuel** : écrit par `subscribeUser()` dans `bot/audio.js` ; lu par `routes/levels.js`, `bot/discord.js` (`!status`), et le WebSocket d'`index.js`.
**Contrat attendu** : un userId présent ⇒ pipeline actif (ou pipeline cleanup pas encore expiré). `speaking=false` + `db=-100` après cleanup.
**Améliorations possibles** :
- Wrapper `setLevel()` / `getLevel()` pour permettre une instrumentation (logs, métriques) sans modifier les call sites.
- Documenter la liste exhaustive des champs (actuellement implicite dans `subscribeUser`).

### `userFreqHistory` — `Map<userId, Array<{db, freq, ts}>>`

**Brève** : historique glissant pour le lissage temporel (fenêtre ~5 s, max 10 ticks dans la pratique).
**Comportement actuel** : push à chaque tick dans `subscribeUser` ; trim à 10 entrées.
**Contrat attendu** : taille bornée. Cleanup différé (5 min) après déconnexion.

### `userBaseline` — `Map<userId, { dbMean, dbStd, freqMean, freqStd, sampleCount, lastUpdate, dirty }>`

**Brève** : baseline acoustique EMA (α=0.005) pour l'auto-seuillage.
**Comportement actuel** : `dirty=true` ⇒ persisté en DB toutes les 60 s par `startBaselinePersistence`.
**Contrat attendu** : converge en ~10 s à 20 Hz.

### `voiceProfiles` — `Map<userId, { bufs, head, filled, total, dirty }>`

**Brève** : buffers circulaires bruts du profil vocal passif (1000 samples × 10 marqueurs).
**Comportement** : Float32Array par marqueur ; `dirty` déclenche le recalcul des stats tous les 50 ticks.

### `voiceStatsCache` — `Map<userId, { n, markers: { [key]: { min, p10..p90, max, mean } } }>`

**Brève** : stats percentiles calculées sur `voiceProfiles` ; utilisé par `computeFormants` pour l'affinage adaptatif.
**Comportement** : recalculé hors hot-path (tri O(n log n) sur 1000 flottants ≈ 0.1 ms) tous les `PROFILE_STATS_EVERY` ticks.

### `PROFILE_MARKERS` — `string[]`

**Brève** : 10 dimensions vocales (`db`, `zcr`, `centroid`, `energyVar`, `freq_low/mid/high`, `f1`, `f2`, `f3`).

### `PROFILE_BUF_SIZE` — `1000`, `PROFILE_STATS_EVERY` — `50`

Capacité du buffer circulaire (~50 s de parole) et fréquence de recalcul des stats.

### `AUDIO` — `{ sampleRate, sampleInterval, durationWindow, fftSize, freqBands }`

**Brève** : config centralisée du pipeline (48 kHz, tick 50 ms, FFT 1024 points, 3 bandes low/mid/high).
**Contrat attendu** : valeurs `const` à la création — ne pas muter à chaud.

## Dépendances
- **Importe** : aucune (module pur).
- **Utilisé par** : [`bot/audio.js`](../bot/audio.md), [`bot/discord.js`](../bot/discord.md) (`userLevels` pour `!status`), `index.js` (subscriber WebSocket), `routes/levels.js`, `routes/emotion.js`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | Toutes les Maps sont **exportées mutables** : n'importe quel module peut écrire des données invalides. | Encapsuler derrière `getLevel(uid) / setLevel(uid, payload)` avec validation Zod-like minimale. |
| 🟠 | Pas de **cleanup automatique** ici (uniquement dans `bot/audio.js` après 5 min) ; sur un Discord avec beaucoup de turnover vocal, fuite mémoire possible si `subscribeUser` crash avant `cleanup()`. | Ajouter un GC périodique scanning `userLevels` pour purger les entrées non-`updated` depuis > 30 min. |
| 🟡 | `AUDIO.freqBands.high.max = 10000` mais Discord livre 48 kHz ; les bandes au-dessus de 10 kHz sont ignorées. | Documenter le choix ou étendre à 20 kHz selon le cas d'usage (sibilances). |
| 🟡 | Pas de versionning du schéma `voiceProfile` persisté en DB — un changement de `PROFILE_MARKERS` casse la rétro-compat. | Ajouter `version` dans `cfg.voiceProfile`. |

## Notes alternatives

Le commentaire en tête mentionne que les **fonctions de traitement** restent dans `index.js` "lors de la migration complète". En pratique elles ont migré vers [`bot/audio.js`](../bot/audio.md) — le commentaire est obsolète.
