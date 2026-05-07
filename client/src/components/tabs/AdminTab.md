# `AdminTab.jsx`

> **Administration** — Discord bot token + permissions utilisateurs.
> 📂 `client/src/components/tabs/AdminTab.jsx`
> 🔗 Module : [`tabs/`](./README.md)

## Résumé

Onglet **admin only**. Deux sections :

1. **Token Discord du bot** : input password + bouton "Enregistrer" → `POST /bot-token`. Provoque un redémarrage du bot côté backend.
2. **Permissions utilisateurs** : formulaire (Discord ID + role select admin/client/viewer) + liste de toutes les permissions configurées avec bouton "Supprimer". `GET/POST /api/permissions`, `DELETE /api/permissions/:id`.

## Composants / Hooks exportés

### `AdminTab({ toast })`

**Props attendues** :
- `toast: (msg) => void`.

**Comportement actuel** :
- 4 states locaux : `permissions[]`, `botToken`, `form { discordId, role }`, `loading`.
- `load()` au mount : transforme `data.users` (objet) en tableau plat.
- `savePermission` : POST puis re-load.
- `removePermission` : DELETE puis re-load.
- `saveBotToken` : POST puis vidage de l'input.
- `ROLE_COLORS` constante locale pour le badge coloré.

**Comportement attendu (contrat)** :
- POST `/bot-token` redémarre le bot — pas de feedback temps réel sur le redémarrage (juste un toast "Token sauvegardé — redémarrage en cours…").
- Suppression de permission silencieuse en cas d'erreur backend (→ toast).

**Améliorations possibles** :
- Confirmation avant `removePermission`.
- Loader pendant le redémarrage du bot + reconnect auto.
- Validation du Discord ID (snowflake : 17-19 chiffres).
- Listing avec pagination si > 50 permissions.

## State & Side effects

- **State local** : `permissions`, `botToken`, `form`, `loading`.
- **Context utilisé** : aucun.
- **API appelée** : `GET /api/permissions`, `POST /api/permissions`, `DELETE /api/permissions/:id`, `POST /bot-token`.
- **WebSocket** : non.
- **localStorage** : non.

## Dépendances

- **Importe** : `useState`, `useEffect`, `apiJson`, `apiPost`, `apiDelete`, `apiFetch`.
- **Utilisé par** : `App.jsx`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **`apiFetch` importé mais inutilisé**. | Retirer. |
| 🟠 | **Pas de confirmation pour `removePermission`** — un clic suffit. | Confirm. |
| 🟠 | **Pas de validation Discord ID**. | Regex `/^\d{17,19}$/`. |
| 🟠 | **`saveBotToken` confirme "redémarrage en cours"** mais aucun mécanisme de reconnexion attendu côté UI. | WS heartbeat + reload UI. |
| 🟡 | **Re-load complet** après chaque action — peut clignoter avec l'état "loading". | Update optimiste. |
| 🟡 | **Inline styles**. | CSS. |
| 🟡 | **`p.displayName` non documenté** — pourquoi le backend renvoie ça parfois ? | Doc API. |

## Notes alternatives

- Audit log des changements de permissions (qui a fait quoi quand).
