# `UserCard.jsx`

> **Tuile live d'un utilisateur PNGTuber** — flipbook + bars audio canvas + bouton config.
> 📂 `client/src/components/avatars/UserCard.jsx`
> 🔗 Module : [`avatars/`](./README.md)

## Résumé

Composant central de l'onglet "Avatars". Pour chaque token actif, montre :

1. Header : nom + pill `🎙 parle` / `🔇 silencieux`.
2. Stage : `<img>` du frame courant (animé en flipbook setInterval) + `<canvas>` overlay avec 3 bars (low/mid/high) animés en `requestAnimationFrame`.
3. Footer : `${db} dB — {currentState}`.
4. Bouton "⚙ Configurer" si admin OU si `token === myToken`.

## Composants / Hooks exportés

### `UserCard({ token, levelInfo, onOpenSettings })`

**Props attendues** :
- `token: string` — le token utilisateur.
- `levelInfo: { db, speaking, freq, … } | undefined` — payload live de `/levels[token]`.
- `onOpenSettings: (token) => void` — handler pour ouvrir le modal config.

**Brève** : rend une carte live.

**Comportement actuel** :
- Lit `configData[token]`, `audioConfig`, `effectiveRole`, `myToken` du contexte.
- 4 refs locaux : `canvasRef`, `animRef` (jamais lu), `flipRef` (`{ intervalId, frames, idx }`), `smoothRef` (`{ low, mid, high }` smoothing exponentiel).
- 2 states locaux : `currentFrame: string | null`, `currentState: string` (défaut `'silent'`).
- `resolveState` (callback mémoïsé sur `[db, speaking, audioConfig.thresholds]`) : trie les seuils décroissants, retourne le premier dont le seuil ≤ db. Si pas speaking → `'silent'`.
- **`useEffect` flipbook** (deps `[resolveState, user.states, audioConfig.frameSpeed, speaking]`) : choisit la liste de frames (state ou `state_closed`), reset `flipRef`, `setInterval(audioConfig.frameSpeed || 150)` qui incrémente `idx` et set `currentFrame`.
- **`useEffect` canvas** (deps `[freq, speaking]`) : à chaque changement, recalcule `dpr`, ré-init `canvas.width/height`, lance `requestAnimationFrame` pour les bars (smoothing 0.2). Cleanup `cancelAnimationFrame`.
- `canEdit = effectiveRole === 'admin' || token === myToken`.

**Comportement attendu (contrat)** :
- Le flipbook doit changer de frame à chaque `frameSpeed` ms tant que les frames sont chargées.
- Le canvas doit afficher des bars proportionnels aux 3 freq bands (low/mid/high), saturés à 100% de la hauteur.
- L'état `silent` utilise le couple `state_closed` si disponible (alternance bouche fermée).

**Améliorations possibles** :
- Sortir le canvas en composant mémoïsé séparé (re-init coûteux à 10 fps).
- Mémoïser `UserCard` via `React.memo` sur `[token, levelInfo, ...]` pour éviter les re-renders quand un *autre* token change.
- Stocker `freq`/`speaking` dans un ref pour ne pas relancer le `useEffect` canvas à chaque tick.
- Précharger les images frames pour éviter le pop-in.

## State & Side effects

- **State local** : `currentFrame`, `currentState`, refs.
- **Context utilisé** : `configData`, `audioConfig`, `effectiveRole`, `myToken`.
- **API appelée** : non (consomme `levelInfo` en prop).
- **WebSocket** : non.
- **localStorage** : non.

## Dépendances

- **Importe** : `useState`, `useEffect`, `useRef`, `useCallback`, `useApp`, `useAudioStates`, `apiFetch`, `getApiBase`.
- **Utilisé par** : `AvatarsTab.jsx`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🔴 | **`useEffect` canvas re-déclenché à chaque tick de polling** (`freq` et `speaking` changent souvent) → resize + re-init context à 10 fps. Fuite de perf. | Lecture de `freq` via ref ; init une seule fois au mount. |
| 🟠 | **Pas de `React.memo`** → quand un autre `UserCard` change, tous re-render. | `memo` + comparaison custom. |
| 🟠 | **`apiFetch` et `getApiBase` importés mais jamais utilisés**. | Supprimer les imports. |
| 🟠 | **`animRef` declared but unused**. | Code mort. |
| 🟡 | **`audioConfig.frameSpeed || 150`** : si l'utilisateur saisit `0`, fallback. OK mais piège à doc. | RAS. |
| 🟡 | **Smoothing 0.2 hardcodé** dans le canvas. | Constante nommée. |
| 🟡 | **A11y** : `<img alt="">` vide (acceptable car décoratif), mais le bouton ⚙ n'a pas d'aria-label. | Améliorer. |
| 🟡 | **`flipRef.current.intervalId` peut être stale** entre cleanup et nouveau setup en cas de race rapide (déstructuration). | OK en pratique. |

## Notes alternatives

- Pour des perfs solides : un seul `<canvas>` partagé qui rend toutes les cartes en un draw call. Beaucoup plus complexe.
