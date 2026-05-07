# `SubscriptionsTab.jsx`

> **Abonnement** — vue tier utilisateur + sièges streamer + panel admin.
> 📂 `client/src/components/tabs/SubscriptionsTab.jsx`
> 🔗 Module : [`tabs/`](./README.md)

## Résumé

Onglet **admin/client**. Trois sections selon rôle :

1. **Mon tier actuel** : badge coloré (free/premium/streamer) + date d'expiration.
2. **Sièges** (si tier `streamer` ou admin) : liste des Discord IDs + retrait + ajout.
3. **Panel admin** (admin only) : formulaire complet pour attribuer/annuler un abonnement à un Discord ID donné (tier, max sièges, date d'expiration).

## Composants / Hooks exportés

### `SubscriptionsTab({ toast })`

**Props attendues** :
- `toast: (msg) => void`.

**Comportement actuel** :
- 4 states : `sub`, `seats`, `loading`, `adminForm { discordId, tier, maxSeats, expiresAt }`, `newSeatId`.
- `load()` au mount : `Promise.all([/api/subscription, /api/subscription/seats])` (le second peut throw → fallback `{ seats: [] }`).
- Actions admin : `adminSet` (POST), `adminCancel` (DELETE).
- Actions sièges : `addSeat` (POST), `removeSeat` (DELETE).
- Constantes locales `TIER_LABELS` et `TIER_COLORS` (dupliquées avec `Header.jsx`).

**Comportement attendu (contrat)** :
- Le tier vu est celui du contexte (`useApp().tier`) — pas celui du `sub` retour API. Sémantique double.
- `adminCancel` cible `adminForm.discordId` — facile de se tromper et d'annuler le mauvais user.

**Améliorations possibles** :
- Confirmation pour `adminCancel`.
- Auto-clear `adminForm` après succès.
- Affichage du `maxSeats` actuel pour les streamers.
- Indication visuelle quand `seats.length === maxSeats`.

## State & Side effects

- **State local** : `sub`, `seats`, `loading`, `adminForm`, `newSeatId`.
- **Context utilisé** : `effectiveRole`, `tier`.
- **API appelée** :
  - `GET /api/subscription`, `GET /api/subscription/seats`,
  - `POST /api/subscription` (admin), `DELETE /api/subscription/:discordId` (admin),
  - `POST /api/subscription/seats` (streamer), `DELETE /api/subscription/seats/:discordId`.
- **WebSocket** : non.
- **localStorage** : non.

## Dépendances

- **Importe** : `useState`, `useEffect`, `useApp`, `apiJson`, `apiPost`, `apiDelete`.
- **Utilisé par** : `App.jsx`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **`adminCancel` sans confirmation** — peut annuler le mauvais abonnement. | `confirm()`. |
| 🟠 | **`TIER_COLORS` / `TIER_LABELS` dupliqués** avec `Header.jsx`. | Factoriser dans `constants.js`. |
| 🟠 | **`tier` lu du contexte** mais `sub` du fetch — peut diverger jusqu'à un re-bootstrap. | Utiliser uniquement `sub.tier` post-fetch. |
| 🟡 | **Pas de validation Discord ID** dans `adminForm`. | Regex. |
| 🟡 | **Pas de feedback** sur la limite de sièges atteinte. | UI. |
| 🟡 | **Inline styles**. | CSS. |

## Notes alternatives

- Pour la facturation Stripe : intégrer un webhook qui pousse les changements via WS.
