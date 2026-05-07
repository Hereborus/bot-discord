# `permissions.js`

> Repository pour `permissions` (rôles globaux) et `avatar_permissions` (visibilité par guilde).
> 📂 `src/db/repos/permissions.js`
> 🔗 Module : [`repos/`](./README.md)

## Résumé

Deux tables liées à l'autorisation, mais distinctes :
1. **`permissions`** : rôle global d'un utilisateur (`admin` / `client` / `viewer`). Stocké par `discord_id` pour permettre à un admin d'attribuer un rôle avant que l'utilisateur se connecte pour la première fois.
2. **`avatar_permissions`** : indique si l'avatar d'un utilisateur (par token) doit s'afficher dans une guilde Discord donnée.

## Fonctions / Exports

### `permissions.get` → SELECT par discord_id

Retourne le rôle d'un user (1 ligne ou undefined).

### `permissions.upsert` → INSERT … ON CONFLICT

Pattern UPSERT classique. Met à jour `role`, `granted_by`, `display_name`, `guilds_json`, `granted_at` sur conflit.

**Comportement attendu** : `granted_at` est rafraîchi à chaque update — utile pour l'audit "dernière modif".

### `permissions.delete` → DELETE par discord_id

Hard delete. L'historique est perdu — voir audit.

### `permissions.all` → SELECT \*

Pas de pagination. Le DB browser et la liste admin chargent tout.

### `avatarPerms.byToken` → SELECT par token

Liste des guildes avec leur règle pour un avatar.

### `avatarPerms.get` → SELECT (token, guild_id)

Look-up unitaire utilisé par `isAvatarAllowed` ([routes/permissions.js](../../routes/permissions.md)).

### `avatarPerms.upsert` → INSERT … ON CONFLICT(token, guild_id)

UPSERT couple (token, guild_id) avec mise à jour `allowed` et `updated_at`.

## Dépendances

- **Importe** : [`db/database`](../database.js)
- **Utilisé par** : [`routes/admin.js`](../../routes/admin.md) (`permRepo`), [`routes/permissions.js`](../../routes/permissions.md), `services/authService.js` (pour `getUserRole` — à confirmer)

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟡 Min | `permissions.delete` hard delete sans audit trail | Soft delete (status='revoked') ou table `audit_log` |
| 🟡 Min | `permissions.all` sans pagination | LIMIT/OFFSET |
| 🟡 Min | `guilds_json` stocké comme string opaque | Migrer vers une table `permission_guilds` normalisée pour requêtes natives |
| 🟢 Info | Pas de méthode `expireOldPermissions` | Si des rôles temporaires sont prévus, ajouter |
| 🟢 Info | `avatarPerms` peu utilisé en pratique (pas d'UI active) | Vérifier si feature à conserver |

## Notes alternatives

Le pattern `JSON.parse(guilds_json)` partout serait inutile si on normalisait avec une table `permission_guilds(discord_id, guild_id)`. Trade-off : simplicité actuelle vs requêtes SQL plus expressives ("tous les users qui ont accès à la guild X").

Un index sur `(token, guild_id)` est nécessaire pour `avatarPerms.get` — à confirmer dans `database.js`.

Considérer une vue pour le cas fréquent "résoudre tier + permissions en une requête" — actuellement deux round-trips DB par requête authentifiée.
