# `subscriptions.js`

> CRUD des abonnements + gestion des sièges (seats) du tier streamer.
> 📂 `src/routes/subscriptions.js`
> 🔗 Module : [`routes/`](./README.md)

## Résumé

Routes pour gérer le système d'abonnement à 3 tiers (`free`/`premium`/`streamer`). Le tier renvoyé par `GET /api/subscription` est résolu dynamiquement via `getUserTier()` (ordre : abonnement direct > seat streamer > free). Le tier `streamer` permet à son propriétaire de distribuer jusqu'à `max_seats` sièges premium à d'autres utilisateurs.

## Fonctions / Exports

### `handleGetSubscription(req, res, ctx)` → `Promise<void>`

**Brève** : `GET /api/subscription` — mon abonnement + tier résolu + limites.

**Comportement actuel** : Lit `subRepo.get` (status='active' uniquement), calcule `tier` via `getUserTier` (peut retourner premium via seat même si pas de subscription directe), ajoute `tierLimits` pour que le frontend puisse afficher les jauges.

### `handleSetSubscription(req, res, ctx)` → `Promise<void>`

**Brève** : `POST /api/subscription` — admin assigne un abonnement.

**Comportement actuel** : Validation minimale (`discordId && tier` requis). Aucune whitelist sur `tier` → un admin peut taper `'unicorn'` et casser silencieusement l'enforcement (rentrera dans `getUserTier` qui a un fallback).

**Améliorations possibles** :
- Whitelist `['free', 'premium', 'streamer']`
- Validation `maxSeats` int positif (≤ N par tier — un streamer peut en avoir 5, un premium 0)
- Validation `expiresAt` ISO 8601
- Pas d'audit log (qui a accordé quoi à qui)

### `handleCancelSubscription(req, res, ctx)` → `Promise<void>`

**Brève** : `DELETE /api/subscription/:discordId` — admin annule.

Soft delete via `status='cancelled'`. Les seats associés ne sont pas désactivés ici (mais `seats.byUser` filtre `s.status='active'` → effet automatique).

**Améliorations possibles** :
- Audit log
- Notification au user concerné

### `handleGetSeats(req, res, ctx)` → `Promise<void>`

**Brève** : `GET /api/subscription/seats` — sièges de mon pack streamer.

**Comportement actuel** : Si pas d'abonnement → `{ seats: [] }`. Sinon retourne `seatsRepo.bySub.all(sub.id)`.

**Améliorations possibles** :
- Pas de check que `sub.tier === 'streamer'` — un user `premium` qui a `max_seats > 0` (mauvaise config) verrait/gérerait quand même.

### `handleAddSeat(req, res, ctx)` → `Promise<void>`

**Brève** : `POST /api/subscription/seats` — ajouter un siège.

**Comportement actuel** : 400 si pas d'abo. Vérifie le plafond `count >= max_seats`. INSERT OR IGNORE (donc ré-add silencieux si déjà présent).

**Améliorations possibles** :
- Pas de validation `discordId` format (snowflake `/^\d{17,19}$/`)
- Le `INSERT OR IGNORE` masque le cas "déjà ajouté" → 200 OK trompeur. `result.changes === 0` devrait retourner 409.
- Pas de notification au user ajouté
- Le user ajouté pourrait refuser le seat (privacy) — actuellement consentement implicite

### `handleRemoveSeat(req, res, ctx)` → `Promise<void>`

**Brève** : `DELETE /api/subscription/seats/:discordId` — retirer.

Hard delete (vs soft pour les autres tables). Pas de feedback si non présent.

## Dépendances

- **Importe** : [`http/helpers`](../http/helpers.js), [`db/repos/subscriptions`](../db/repos/subscriptions.js), [`services/tierService`](../services/tierService.js)
- **Utilisé par** : `index.js`. `getUserTier` consommé partout (middleware `loadTier`, enforcement upload/config).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 Maj | `handleSetSubscription` : `tier` non whitelisté | `if (!['free','premium','streamer'].includes(tier)) 400` |
| 🟠 Maj | `discordId` accepté sans validation snowflake (toutes les routes) | Regex `/^\d{17,19}$/` |
| 🟡 Min | Pas d'audit log sur les actions admin (set/cancel) | Logger qui, quand, quoi |
| 🟡 Min | `INSERT OR IGNORE` masque le doublon | Retourner 409 sur `result.changes === 0` |
| 🟡 Min | Pas de notification sur add/remove seat | Créer une notification |
| 🟡 Min | Pas de check `tier === 'streamer'` sur `handleGetSeats`/`handleAddSeat` | Garde explicite |
| 🟡 Min | Pas de validation `maxSeats` / `expiresAt` | Validation et cap |
| 🟢 Info | Cancel admin : pas de notification au user concerné | Améliorer UX |

## Notes alternatives

Le système d'abonnements est minimaliste — pas d'intégration Stripe/Lemon Squeezy/etc. Si commercialisation future, ce fichier sera enrichi avec :
- Webhook handler (`POST /api/subscription/webhook`)
- Validation signatures HMAC
- Idempotence par `event_id`
- Mapping `customer_id → discord_id` (table additionnelle)

L'enforcement actuel est en pull (`loadTier` middleware lit la DB à chaque requête) — peut devenir un goulot d'étranglement. Cache LRU 60s par `discordId` recommandé si le trafic monte.
