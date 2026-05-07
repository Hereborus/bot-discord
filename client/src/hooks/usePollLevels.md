# `usePollLevels.js`

> **Hook critique** — polling de `/levels` toutes les `interval` ms, auto-charge les frames des nouveaux users.
> 📂 `client/src/hooks/usePollLevels.js`
> 🔗 Module : [`hooks/`](./README.md)

## Résumé

C'est le poumon de l'app. Toutes les 100 ms (par défaut), il :

1. `GET /levels` (dB, freq bands, formants, displayName, etc. par token).
2. Met à jour `apiConnected` (`true`/`false` selon succès).
3. Sépare la clé `_bot` (statut bot) du reste (`userLevels`).
4. Pour chaque token inconnu (pas dans `configData`), lance un `GET /frames/{token}` en parallèle (fire-and-forget) et insère les frames dans `configData`.
5. Pour chaque token connu dont le `displayName` a changé, met à jour le state.

Utilise des `useRef` pour `configData` et `audioConfig` afin que les comparaisons à l'intérieur de `poll()` voient toujours la valeur actuelle sans re-créer le callback (et donc sans relancer le `setInterval`).

## Composants / Hooks exportés

### `usePollLevels(interval = 100)` — hook

**Args** :
- `interval: number` — millisecondes entre 2 polls.

**Retour** : rien — side-effect-only.

**Comportement actuel** :
- `useCallback` `poll` mémoïsé sur `[setLevels, setBotStatus, setApiConnected, updateConfigData]` (refs stables car issus du context).
- `useEffect` lance un poll immédiat puis `setInterval(poll, interval)` ; cleanup `clearInterval`.
- Dans `poll`, lecture via `configDataRef.current` pour éviter la race "configData déjà à jour mais closure stale".

**Comportement attendu (contrat)** :
- Doit toujours mettre à jour `apiConnected` à chaque tick (succès ou échec).
- Ne doit pas dupliquer le fetch des frames pour un même token.
- Ne doit pas tourner si l'onglet est masqué (PAS implémenté actuellement).

**Améliorations possibles** :
- Pause sur `document.visibilitychange = hidden`.
- Backoff exponentiel sur erreur (actuellement, on continue au même rythme à mitrailler un backend down).
- WebSocket prioritaire avec polling en fallback.
- AbortController pour annuler les fetches en cours sur unmount.

## State & Side effects

- **State local** : aucun (refs uniquement).
- **Context utilisé** : `setLevels`, `setBotStatus`, `setApiConnected`, `configData`, `updateConfigData`, `audioConfig` (pour la ref).
- **API appelée** : `GET /levels` (chaque tick), `GET /frames/{token}` (à l'apparition d'un nouveau token).
- **WebSocket** : non.
- **localStorage** : non.

## Dépendances

- **Importe** : `useEffect`, `useRef`, `useCallback`, `getApiBase`, `useApp`.
- **Utilisé par** : `App.jsx` (`ControlApp`).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🔴 | **Polling 10x/s même tab cachée** → consommation réseau et CPU inutile, batterie laptop. | `document.visibilityState === 'hidden'` → skip. |
| 🔴 | **Pas de backoff sur erreur** — si backend down, on hammer le serveur à 10 req/s. | Exponential backoff jusqu'à `5s` + reset au succès. |
| 🟠 | `audioCfgRef` capturé mais **jamais lu** dans la fonction `poll`. Code mort. | Supprimer ou utiliser. |
| 🟠 | **Fetches `/frames/{token}` non annulés** sur unmount → memory leak mineur + warning React possible (`setState on unmounted`). | `AbortController` + flag `cancelled`. |
| 🟠 | Pas de retry / déduplication : si `/frames/{token}` répond 404, on retentera **à chaque nouveau tick** (puisque `configData[token]` reste vide, sauf qu'on l'aurait initialisé en cas d'ok). | Retentera systématiquement → pour les tokens 404, marquer un état "tried". |
| 🟡 | `cache: 'no-store'` sur chaque fetch (OK pour `/levels`, mais inutile pour `/frames/{token}` qui change rarement). | Laisser cache HTTP gérer. |
| 🟡 | `setInterval` au lieu de `setTimeout` recursif — risque de stacking si une réponse tarde > 100 ms. | `setTimeout(poll, interval)` après chaque `await`. |
| 🟡 | Pas de WebSocket pour `levels` alors qu'un WS existe déjà (`useWebSocket`) — gaspillage. | Émettre `levels` côté serveur via WS, polling en fallback. |

## Notes alternatives

- Polling 100 ms = 10 fps pour les niveaux audio. Si on veut animer les bars audio fluidement, c'est limite mais OK. Pour des niveaux affichés dans les `UserCard`, `requestAnimationFrame` côté canvas suffit (ce qui est déjà fait).
