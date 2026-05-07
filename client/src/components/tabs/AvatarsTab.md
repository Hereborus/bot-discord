# `AvatarsTab.jsx`

> **Page d'accueil** — grille des `<UserCard>` pour chaque token actif.
> 📂 `client/src/components/tabs/AvatarsTab.jsx`
> 🔗 Module : [`tabs/`](./README.md)

## Résumé

Onglet par défaut. Affiche un `<UserCard>` par token présent dans `levels`. Pour le rôle `client`, filtre pour ne montrer que **son propre token** (`myToken`). Si aucun token, affiche un état vide contextuel selon l'état réseau (apiConnected, botStatus.connected, botStatus.inVoice).

## Composants / Hooks exportés

### `AvatarsTab({ onOpenSettings })`

**Props attendues** :
- `onOpenSettings: (token) => void` — handler qui ouvre `<UserSettingsModal>` (cf. `App.jsx`).

**Brève** : panneau de cards.

**Comportement actuel** :
- Lit `levels`, `botStatus`, `configData`, `apiConnected`, `effectiveRole`, `myToken`.
- Filtre `tokens = Object.keys(levels)` selon le rôle (`client` voit que `myToken`).
- État vide : 4 cas (cascade de `if`).
- Sinon : grille `.profile-cards-grid` avec `<UserCard key={token} ...>`.

**Comportement attendu (contrat)** :
- Toujours afficher un message clair même si liste vide.
- Le rôle `viewer` voit tout (lecture seule, mais pas de filtre — sémantique étrange).

**Améliorations possibles** :
- Mémoïser `tokens` via `useMemo`.
- `React.memo` sur `<UserCard>` pour éviter re-render quand un autre token change.
- Pour `viewer`, filtrer aussi par `myToken` ? (Comportement à clarifier.)

## State & Side effects

- **State local** : aucun.
- **Context utilisé** : `levels`, `botStatus`, `configData` (lu mais non utilisé directement ici), `apiConnected`, `effectiveRole`, `myToken`.
- **API appelée** : non (consomme `levels`).
- **WebSocket** : non.
- **localStorage** : non.

## Dépendances

- **Importe** : `useApp`, `UserCard`.
- **Utilisé par** : `App.jsx`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🔴 | **`dangerouslySetInnerHTML` avec `msg`** (string codée en dur) — actuellement sans risque (pas d'input user) mais piège futur. | `<p>{msg}</p>` avec rendu structuré. |
| 🟠 | **`configData` lu mais inutilisé** dans `useApp()` destructure → re-render à chaque update de `configData` pour rien. | Retirer. |
| 🟠 | **Re-render à chaque tick de polling** (10 fps) car `levels` est dans le context global non splitté. | Mémoïsation contexte ou splitting. |
| 🟡 | **4 messages d'état vide** mais pas typés — risque de drift. | Constantes. |
| 🟡 | **`viewer` voit tous les tokens** (sémantique pas claire). | Documenter ou filtrer. |

## Notes alternatives

- Animation FLIP lors du tri/ajout/retrait des cards.
