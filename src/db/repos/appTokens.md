# `appTokens.js`

> Repository pour `app_tokens` (Bearer agent) et `notifications` (cloche frontend).
> 📂 `src/db/repos/appTokens.js`
> 🔗 Module : [`repos/`](./README.md)

## Résumé

Regroupe les prepared statements pour deux tables jugées "fonctionnellement liées" (les notifications proviennent souvent d'actions liées aux app tokens / invitations). En pratique, cette association reste lâche — on pourrait splitter en deux fichiers.

**Sécurité tokens** : seul le SHA-256 du token est stocké. Le token brut n'existe en mémoire qu'au moment de la création, le temps d'être renvoyé au client.

**Soft delete** : `revoked_at` permet de garder l'historique pour audit.

## Fonctions / Exports

### `appTokens.create` → INSERT

Insère `(token_hash, discord_id, device_name)`. `id` auto-incrémenté, `created_at`/`revoked_at` gérés par schéma.

### `appTokens.get` → SELECT par `token_hash` (actif uniquement)

`WHERE token_hash = ? AND revoked_at IS NULL` — appelé à chaque requête authentifiée par Bearer pour valider le token.

**Comportement attendu** : Lookup hot-path. Doit avoir un index unique sur `token_hash` (à vérifier dans `database.js`).

### `appTokens.byUser` → SELECT (sans token_hash)

Liste les tokens actifs d'un user. **Volontairement n'inclut pas `token_hash`** — pas besoin côté client. ✓

### `appTokens.revoke` → UPDATE soft delete

`WHERE id = ? AND discord_id = ?` — la double clause empêche un user de révoquer le token d'un autre. ✓

### `appTokens.touch` → UPDATE last_used_at

Appelé à chaque requête auth Bearer pour tracker l'usage. Génère beaucoup d'écritures DB — voir audit.

### `appTokens.revokeAll` → UPDATE all of user

Utile lors d'un logout global / changement de mot de passe Discord (non implémenté actuellement).

### `notifications.create` → INSERT

`(discord_id, type, payload_json)`. `payload_json` est une string libre — chaque type a sa propre forme.

### `notifications.list` / `notifications.unread`

Filtre + LIMIT. Pas de cap côté repo — l'appelant doit cap (cf. [notifications.md](../../routes/notifications.md)).

### `notifications.countUnread`

Pour la cloche / badge. Hot path frontend.

### `notifications.markRead` / `notifications.markAllRead`

Filtre `discord_id` ✓ — empêche le cross-user marking.

## Dépendances

- **Importe** : [`db/database`](../database.js)
- **Utilisé par** : [`routes/device.js`](../../routes/device.md) (`appTokens`), [`routes/notifications.js`](../../routes/notifications.md), [`routes/sessions.js`](../../routes/sessions.md) (`notifications.create` pour invitations), `services/authService.js` (validation Bearer via `appTokens.get` + `appTokens.touch`)

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟡 Min | `appTokens.touch` génère 1 UPDATE par requête authentifiée | Throttle (e.g. update si `last_used_at < now - 60s`) ou batcher |
| 🟡 Min | Pas de purge des notifs > 30j (mentionnée dans CLAUDE.md) | Vérifier que c'est bien dans `database.js` au boot ou cron |
| 🟡 Min | Pas de `revokeOldUntouched` (tokens jamais utilisés depuis 90j) | Ajouter pour hygiène |
| 🟡 Min | `notifications.list/unread` pas de cap LIMIT côté SQL | Cap dur 1000 par sécurité |
| 🟢 Info | Deux domaines (tokens + notifs) dans un seul fichier | Split possible mais OK |

## Notes alternatives

Considérer un index partiel sur `app_tokens(token_hash) WHERE revoked_at IS NULL` pour accélérer le lookup hot-path tout en évitant les hits sur les tokens révoqués.

Le `payload_json` libre des notifications gagnerait à être typé via un type discriminator côté code (`type: 'invitation' | 'member_joined' | 'session_started'` avec schemas zod).

Pour la scalabilité, `last_used_at` pourrait être tracké en mémoire et flush périodiquement en DB (réduit IOPS).
