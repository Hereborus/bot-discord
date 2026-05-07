# `DbViewTab.jsx`

> **Vue base de données** — stats globales + table de toutes les frames.
> 📂 `client/src/components/tabs/DbViewTab.jsx`
> 🔗 Module : [`tabs/`](./README.md)

## Résumé

Onglet **admin only**, read-only. Deux sources :

- `GET /api/db/stats` → `{ user_count, frame_count, total_size }` (3 cards en haut).
- `GET /api/db/frames` → `[ { token, display_name, state_key, filename, original_ext, file_size, created_at }, … ]` (table).

Aucune action, aucune édition. Permet à l'admin de voir l'état brut du stockage.

## Composants / Hooks exportés

### `DbViewTab()` (sans props)

**Comportement actuel** :
- 3 states : `stats`, `frames`, `loading`.
- `useEffect[]` : `Promise.all([stats, frames])` au mount.
- Helper `formatBytes`.
- Affichage : 3 cards stats + table HTML brute (7 colonnes).

**Comportement attendu (contrat)** :
- Pas de pagination — peut charger très gros si DB volumineuse.
- Pas de tri/filtre.

**Améliorations possibles** :
- Pagination (limit + offset).
- Tri par colonne.
- Search box.
- Virtualisation (`react-window`) pour > 1000 lignes.
- Bouton "Refresh".

## State & Side effects

- **State local** : `stats`, `frames`, `loading`.
- **Context utilisé** : aucun.
- **API appelée** : `GET /api/db/stats`, `GET /api/db/frames`.
- **WebSocket** : non.
- **localStorage** : non.

## Dépendances

- **Importe** : `useState`, `useEffect`, `apiJson`.
- **Utilisé par** : `App.jsx`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **Pas de pagination** — risque OOM si DB grosse. | `?page=1&limit=50`. |
| 🟠 | **`token?.slice(0, 8)`** — affichage tronqué mais sans tooltip pour voir l'entier. | Tooltip ou copier au clic. |
| 🟡 | **Pas de bouton refresh**. | Add. |
| 🟡 | **Inline styles**. | CSS. |
| 🟡 | **`formatBytes` dupliqué** ailleurs (sans doute) — à factoriser. | Helpers. |
| 🟡 | **Date `toLocaleDateString()`** — pas d'heure. | `toLocaleString()`. |

## Notes alternatives

- Vue jointe avec preview thumbnail des frames serait utile (+ poids visuel).
