# `AppTokensTab.jsx`

> **Tokens d'application** — liste + révocation des tokens Bearer pour mini-apps/scripts.
> 📂 `client/src/components/tabs/AppTokensTab.jsx`
> 🔗 Module : [`tabs/`](./README.md)

## Résumé

Onglet **admin/client**. Liste les tokens d'application actifs (Device Auth Flow) avec leur `device_name`, `created_at`, `last_used_at`, et un bouton "Révoquer" (avec `confirm()`).

Pas de génération ici — la doc précise que la génération se fait depuis la page Device Auth de l'application qui consomme le token (mini-app side, pas dans cet onglet).

## Composants / Hooks exportés

### `AppTokensTab({ toast })`

**Props attendues** :
- `toast: (msg) => void`.

**Comportement actuel** :
- 2 states : `tokens[]`, `loading`.
- `load()` au mount : `GET /api/app-tokens`.
- `revoke(id)` : `confirm()` puis `DELETE /api/app-tokens/{id}`.

**Comportement attendu (contrat)** :
- Read + delete uniquement, pas de create.

**Améliorations possibles** :
- Bouton "Générer un token" en plus (lance le device flow).
- Affichage de la date d'expiration si applicable.
- Filtre / search.

## State & Side effects

- **State local** : `tokens`, `loading`.
- **Context utilisé** : aucun.
- **API appelée** : `GET /api/app-tokens`, `DELETE /api/app-tokens/:id`.
- **WebSocket** : non.
- **localStorage** : non.

## Dépendances

- **Importe** : `useState`, `useEffect`, `apiJson`, `apiDelete`.
- **Utilisé par** : `App.jsx`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟡 | **`confirm()` natif** — UX correcte mais pas brandé. | Modal custom. |
| 🟡 | **Pas de search / filtre** — si beaucoup de tokens, scroll long. | Search. |
| 🟡 | **Aucun lien direct** vers la page Device Auth — l'utilisateur est juste informé qu'elle existe. | Bouton ou lien. |
| 🟡 | **Inline styles**. | CSS. |

## Notes alternatives

- Permettre de renommer un token (`device_name`).
- Afficher les permissions effectives par token.
