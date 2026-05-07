# `subscriptions.js`

> Repository pour `subscriptions` (abos) et `subscription_seats` (places streamer).
> 📂 `src/db/repos/subscriptions.js`
> 🔗 Module : [`repos/`](./README.md)

## Résumé

Deux tables liées par `subscription_id`. Le système de **seats** permet à un abonné `streamer` de partager son abonnement premium avec jusqu'à `max_seats` autres utilisateurs. La résolution du tier d'un user (via `services/tierService.getUserTier`) cascade : abonnement direct → seat actif → free.

## Fonctions / Exports

### `subscriptions.get` → SELECT actif

`WHERE discord_id = ? AND status = 'active'` — filtre les abos cancelled/expired.

### `subscriptions.getById` → SELECT par id

Sans filtre status — utile pour audit.

### `subscriptions.upsert` → INSERT … ON CONFLICT

UPSERT sur `discord_id` (clé unique). Force `status='active'` à chaque appel, met à jour `tier`, `max_seats`, `expires_at`, `updated_at`.

**Comportement attendu** : Renouvellement = même appel que création.

### `subscriptions.cancel` → UPDATE soft

`status='cancelled'`, `updated_at=now`. Les seats deviennent automatiquement inopérants car `seats.byUser` filtre `s.status='active'`.

### `subscriptions.expire` → UPDATE batch

Marque expirées tous les abos actifs avec `expires_at < now`. **Appelée proactivement** dans `getUserTier` (pas par cron) → ajoute une écriture potentielle à chaque résolution de tier. Voir audit.

### `seats.byUser` → SELECT JOIN

```sql
JOIN subscriptions s ON ss.subscription_id = s.id
WHERE ss.discord_id = ? AND s.status = 'active'
```

Renvoie les colonnes du seat + `owner_discord_id`, `tier`, `sub_status`. Si un user a plusieurs seats actifs (rare), tous sont retournés.

### `seats.bySub` → SELECT par subscription

Pour la gestion UI ("mes seats").

### `seats.count` → COUNT

Pour vérifier `count >= max_seats` avant d'ajouter.

### `seats.add` → INSERT OR IGNORE

L'IGNORE évite les doublons (subscription_id, discord_id) — mais masque silencieusement le cas "déjà ajouté".

### `seats.remove` → DELETE hard

Pas d'historique conservé.

## Dépendances

- **Importe** : [`db/database`](../database.js)
- **Utilisé par** : [`routes/subscriptions.js`](../../routes/subscriptions.md), [`services/tierService`](../../services/tierService.js) (`getUserTier`)

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 Maj | `subscriptions.expire` lancé à chaque `getUserTier` → écriture DB sur chaque requête authentifiée si une expiration tombe | Lancer en cron au boot + 1×/h, pas synchrone sur le hot path |
| 🟡 Min | `seats.add` (INSERT OR IGNORE) masque les doublons | Retourner `result.changes` au caller pour détecter |
| 🟡 Min | `seats.remove` hard delete | Soft delete pour audit (`removed_at`) |
| 🟡 Min | Pas de table `subscription_history` pour audit (renouvellements, cancellations) | Logger toutes les transitions de status |
| 🟡 Min | `expires_at` accepté sans format imposé par schéma | CHECK contrainte ou TEXT validé côté code |
| 🟢 Info | Pas d'`expireOldSeats` | Si seats temporaires souhaités, ajouter |

## Notes alternatives

Le `subscriptions.expire` proactif est élégant mais coûteux. Alternative :
- Cron au boot + interval 1h
- Ou `WHERE status='active' AND (expires_at IS NULL OR expires_at > now)` dans `subscriptions.get` directement → expire = "filtré" sans UPDATE

La seconde approche est plus simple et plus performante :
```sql
SELECT * FROM subscriptions
WHERE discord_id = ?
AND status = 'active'
AND (expires_at IS NULL OR expires_at > datetime('now'))
```

Et lancer un cleanup `expire` une fois par jour pour la cohérence DB (sans qu'aucune logique métier en dépende).

Pour la commercialisation future, prévoir :
- `webhook_events` table (idempotence)
- `payment_provider`, `provider_subscription_id` columns
- `payment_method_id` pour reactivation rapide
