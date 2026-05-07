# `levels.js`

> Endpoint public temps réel des niveaux audio par token.
> 📂 `src/routes/levels.js`
> 🔗 Module : [`routes/`](./README.md)

## Résumé

Route critique en hot path : appelée toutes les ~100ms par chaque viewer OBS connecté. Traduit la `Map<discordId, levels>` interne en objet `{ [token]: levels }` pour ne jamais exposer un Discord ID en clair via HTTP. Cache 50ms pour éviter de rebuilder le JSON à chaque tick lorsque plusieurs viewers polent en rafale.

## Fonctions / Exports

### `handleLevels(req, res, ctx)` → `Promise<void>`

**Brève** : `GET /levels` — niveaux audio agrégés.

**Comportement actuel** :
1. Si `levelsCache.data` existe et `Date.now() - levelsCache.ts < 50` → retour cache.
2. Sinon, itère `userLevels` (`services/audioService`), substitue chaque `uid` par `tokenFor(uid)`.
3. Stocke `{ data: payload, ts: now }`.
4. Renvoie le payload.

**Comportement attendu (contrat)** : Endpoint public. **Aucun** Discord ID ne doit fuiter (la substitution `uid → token` est garantie par `tokenFor`). Idempotent — toujours sûr d'appeler.

**Améliorations possibles** :
- **Race condition mineure** : si `userLevels` mute pendant l'itération `for…of` (le pipeline audio écrit ces valeurs de manière asynchrone), on peut lire un mix de snapshots. Pas critique pour l'usage (animation), mais à noter.
- Le cache 50ms est partagé pour TOUS les requesters → un seul tick de rebuild même si 100 viewers. ✓
- Pas de filtrage par token : le viewer reçoit les levels de tous les users connectés (pas un problème en soi — déjà tokenisé).
- **Polling vs WebSocket** : le viewer principal (React) utilise WebSocket. Cette route reste pour le fallback HTTP du `viewer.html` standalone et la rétrocompat. Pourrait être marquée `deprecated` dans la doc.

## Dépendances

- **Importe** : [`http/helpers`](../http/helpers.js) (`json`), [`services/audioService`](../services/audioService.js) (`userLevels` Map), [`services/tokenService`](../services/tokenService.js) (`tokenFor`)
- **Utilisé par** : `index.js` (registration), polling fallback de `viewer.html`

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟢 Info | Race condition mineure sur itération concurrente | Snapshot via `Array.from(userLevels)` si critique |
| 🟢 Info | Pas de filtrage par token de viewer | OK — données déjà publiques par token |

## Notes alternatives

Le cache 50ms pourrait être configurable via env `LEVELS_CACHE_MS`. À 100ms de poll côté viewer, la latence ajoutée par le cache est ≤ 50ms — acceptable pour de l'animation. Si le poll baisse à 50ms (high-refresh OBS), le cache devient contre-productif et il faudrait l'abaisser à 20ms.

Pour réduire le coût CPU, on pourrait pré-calculer le payload directement dans le pipeline audio (writer side) plutôt qu'au tick de poll (reader side) — mais le code actuel est suffisamment léger pour ne pas justifier ce refacto.
