# `useToast.js`

> **File de toasts auto-dismiss** — pas de queue, pas de priorité, juste FIFO 3s.
> 📂 `client/src/hooks/useToast.js`
> 🔗 Module : [`hooks/`](./README.md)

## Résumé

Mini hook (12 lignes). Maintient un tableau `toasts: { id, message }[]` et expose une fonction `toast(message, duration = 3000)` qui ajoute en fin de liste, puis schedule un `setTimeout` pour retirer l'entrée.

L'`id` est un compteur monotone via `useRef` — sûr et léger.

## Composants / Hooks exportés

### `useToast()` → `{ toasts, toast }`

**Retour** :
- `toasts: { id: number, message: string }[]` — file ordonnée.
- `toast(message: string, duration = 3000): void` — ajoute un toast et planifie sa disparition.

**Comportement actuel** :
- `toast` mémoïsé via `useCallback([])`.
- Pas de cap de file (théoriquement infini si on en spam beaucoup).
- Pas de cleanup des `setTimeout` à l'unmount.

**Comportement attendu (contrat)** :
- Le rendu est délégué à `<ToastContainer toasts={toasts} />` (composant séparé).

**Améliorations possibles** :
- Cap de file (FIFO max 5).
- Variants (`info`/`success`/`error`).
- Dismiss au clic.

## State & Side effects

- **State local** : `toasts`, `counterRef`.
- **Context utilisé** : non.
- **API appelée** : non.
- **WebSocket** : non.
- **localStorage** : non.

## Dépendances

- **Importe** : `useState`, `useCallback`, `useRef`.
- **Utilisé par** : `App.jsx` (`ControlApp`).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **`toast` est passé en prop drilling** à 7 onglets (AudioTab, AdminTab, …). Devrait être dans le contexte. | Déplacer dans `AppContext` ou exporter un context dédié `<ToastContext>`. |
| 🟡 | **Pas de cleanup** des `setTimeout` à l'unmount → fuite mineure + risque de `setState on unmounted`. | Stocker les ids dans un ref + `clearTimeout` dans `useEffect` cleanup. |
| 🟡 | **Pas de cap** de la file → spam infini possible. | Limiter à 5 (drop le plus ancien). |
| 🟡 | **Pas de typage variant** — tous les toasts sont visuellement identiques. | Ajouter `type: 'info'/'success'/'error'`. |
| 🟡 | **Compteur basé sur ref** — OK pour ce cas, mais `Date.now()` ou `crypto.randomUUID()` éviterait des collisions théoriques. | À voir selon volumétrie (quasi nulle ici). |

## Notes alternatives

- `react-hot-toast` ou `sonner` couvriraient tout ça en 1 ligne.
