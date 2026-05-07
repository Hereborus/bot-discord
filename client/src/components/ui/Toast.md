# `Toast.jsx`

> **Container minimal** des toasts — rend la liste fournie par `useToast`.
> 📂 `client/src/components/ui/Toast.jsx`
> 🔗 Module : [`ui/`](./README.md)

## Résumé

10 lignes. Si la liste est vide, retourne `null`. Sinon, un `<div id="toast">` (l'ID est utilisé par les CSS legacy) avec un `<div.toast-item>` par toast. Aucune animation interne, aucune logique de durée — c'est `useToast` qui gère le `setTimeout` et retire l'item du tableau.

## Composants / Hooks exportés

### `ToastContainer({ toasts })`

**Props attendues** :
- `toasts: { id: number, message: string }[]` — la file en provenance de `useToast`.

**Brève** : rendu pur.

**Comportement actuel** :
- Render conditionnel sur la longueur.
- `key={t.id}` (unique, monotone).

**Comportement attendu (contrat)** :
- Le composant n'a aucune responsabilité de timing ; il fait confiance à l'appelant.

**Améliorations possibles** :
- Animation d'entrée/sortie (Framer Motion ou CSS keyframes).
- Variants visuels (`type: 'success'/'error'`).
- Bouton de fermeture explicite par toast.

## State & Side effects

- **State local** : aucun.
- **Context utilisé** : non.
- **API appelée** : non.
- **WebSocket** : non.
- **localStorage** : non.

## Dépendances

- **Importe** : rien.
- **Utilisé par** : `App.jsx`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟡 | **Pas de `role="status"` / `aria-live="polite"`** → les screen readers ne signalent pas les toasts. | A11y. |
| 🟡 | **Pas de variant visuel** — un toast d'erreur ressemble à un toast de succès. | Ajouter `type`. |
| 🟡 | **`id="toast"`** sur un container — id global, conflit potentiel. | Classe seule. |

## Notes alternatives

- Remplaçable par `react-hot-toast` ou `sonner` en 1 ligne.
