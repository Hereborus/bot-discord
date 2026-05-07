# `Modal.jsx`

> **Overlay générique simple** — clic extérieur = fermeture.
> 📂 `client/src/components/ui/Modal.jsx`
> 🔗 Module : [`ui/`](./README.md)

## Résumé

19 lignes. Deux composants : `Modal` (wrapper overlay + boîte centrée + titre optionnel) et `ModalRow` (utilitaire flex pour aligner des actions). Pas de portail, pas de focus trap, pas de Escape, pas de transition. Convient pour un usage très basique.

## Composants / Hooks exportés

### `Modal({ open, onClose, title, children, className = '' })`

**Props attendues** :
- `open: boolean` — si `false`, retourne `null`.
- `onClose: () => void` — appelé sur clic en dehors de la `.modal` (sur l'overlay direct).
- `title?: string` — titre `<h2>` optionnel.
- `children: ReactNode` — contenu.
- `className?: string` — classes additionnelles sur la `.modal`.

**Brève** : présentation pure.

**Comportement actuel** :
- Render `null` si `!open`.
- Click handler vérifie `e.target === e.currentTarget` pour ne fermer que sur l'overlay (pas sur la modal elle-même).

**Comportement attendu (contrat)** :
- Pas de fermeture sur Escape (à implémenter).
- Pas de focus trap (le focus peut s'échapper du modal au tab).

**Améliorations possibles** :
- `useEffect` listener Escape.
- Focus trap (focus auto-set sur premier élément focusable).
- `createPortal(children, document.body)` pour éviter les soucis de stacking.
- Animation d'apparition.

### `ModalRow({ children })`

**Brève** : flex container `.modal-row`. Trivial.

## State & Side effects

- **State local** : aucun.
- **Context utilisé** : non.
- **API appelée** : non.
- **WebSocket** : non.
- **localStorage** : non.

## Dépendances

- **Importe** : rien.
- **Utilisé par** : `App.jsx` (modal URL OBS).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **A11y nulle** : pas de `aria-modal`, `role="dialog"`, focus trap, Escape. | Refonte ou Radix Dialog. |
| 🟠 | **Pas de portail** : si un parent a `transform`/`overflow:hidden`/`z-index` < `.overlay`, problème. | `createPortal`. |
| 🟡 | **Pas d'animation** d'apparition. | CSS transition. |
| 🟡 | **Le clic extérieur** est très sensible — pas de delay. Un drag qui se termine à l'extérieur ferme le modal. | Track mousedown/up. |

## Notes alternatives

- Pour un projet plus mature, remplacer par `@radix-ui/react-dialog`.
