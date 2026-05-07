# `useAudioStates.js`

> **Dérive la liste des états et helpers d'affichage** depuis `audioConfig`.
> 📂 `client/src/hooks/useAudioStates.js`
> 🔗 Module : [`hooks/`](./README.md)

## Résumé

Malgré son préfixe `use`, **ce n'est pas un hook React** au sens strict — il n'utilise aucun hook (`useState`/`useMemo`/etc). C'est une fonction pure qui prend `audioConfig` et renvoie un objet de dérivés (listes + 5 helpers).

Permet à `AvatarsTab`, `AudioTab`, `ExperimentTab`, `UserCard`, `UserSettingsModal` de partager la même logique pour : trier les seuils, énumérer tous les états (open/closed + émotions/silent), classifier une clé d'état, et résoudre la couleur d'affichage.

## Composants / Hooks exportés

### `useAudioStates(audioConfig)` → `{ audioStates, allStates, isClosedState, isEmotionSilent, baseState, isAudioState, isEmotion, stateColor }`

**Args** :
- `audioConfig`: `{ thresholds: [{ key, label, db, color }], emotions: [{ key, label, color }], … }`.

**Retour** :
- `audioStates: string[]` — `['silent', ...thresholds.key triés par db asc]`. Ex: `['silent', 'low', 'medium', 'high']`.
- `allStates: string[]` — pour chaque audio state, `key + key_closed` ; pour chaque émotion, `key + key_silent`.
- `isClosedState(k)` — `true` si `k` finit par `_closed`.
- `isEmotionSilent(k)` — `true` si `k` finit par `_silent` ET la base n'est pas un audio state (ex: `joie_silent`).
- `baseState(k)` — strip `_closed` et `_silent` (ex: `low_closed` → `low`).
- `isAudioState(k)` — `audioStates.includes(k)`.
- `isEmotion(k)` — pas un audio state, pas closed, pas emotion-silent.
- `stateColor(k)` — résout la couleur CSS : seuil → emotion → fallback `var(--accent)` ou `var(--c-silent)`.

**Comportement actuel** : pure, idempotent.

**Comportement attendu (contrat)** : aucun side effect ; doit pouvoir être appelé dans le render sans surcoût notable.

**Améliorations possibles** :
- Mémoïsation interne via `useMemo` pour ne pas re-trier `thresholds` à chaque render.
- Renommer `useAudioStates` → `deriveAudioStates` (puisque ce n'est pas un hook).
- Typer la signature (TypeScript).

## State & Side effects

- **State local** : aucun.
- **Context utilisé** : non (l'appelant lui passe `audioConfig` issu du context).
- **API appelée** : aucune.
- **WebSocket** : non.
- **localStorage** : non.

## Dépendances

- **Importe** : rien.
- **Utilisé par** : `UserCard`, `UserSettingsModal`, `AudioTab`, `ExperimentTab`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟡 | **Pas un hook réel** mais préfixé `use` → confusion + ESLint `react-hooks` peut faire des avertissements faux positifs. | Renommer en `deriveAudioStates` ou wrapper avec `useMemo`. |
| 🟡 | Recalcul + `sort()` + `flatMap()` à chaque render. Pour 5 onglets concernés, c'est négligeable mais évitable. | `useMemo([audioConfig])`. |
| 🟡 | `stateColor` appelle `audioConfig.thresholds.find(...)` à chaque appel — quadratique potentiel si appelé en boucle. | Construire un Map en amont. |
| 🟡 | Convention `_silent` + `_closed` comme suffixes magiques, pas typée. Risque de collision (ex: une émotion s'appelant `low_closed`). | Documenter / extraire en constantes. |

## Notes alternatives

- Une version `useMemo` retournant le même shape éviterait toute optimisation manuelle côté appelants.
