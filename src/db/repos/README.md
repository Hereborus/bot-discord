# `repos/`

> Prepared statements better-sqlite3 par domaine — couche d'accès DB.
> 🔗 Parent : [`db/`](../README.md)

## Vue d'ensemble

Ce dossier expose les **prepared statements** SQLite groupés par table/domaine. Pattern simple, sans ORM : chaque fichier `import { db }` depuis `db/database.js` et déclare ses statements en const top-level (compilés une seule fois au load).

Avantages :
- **Performance** : zéro re-parse SQL, exécution rapide
- **Sécurité** : injection SQL impossible par construction (paramètres positionnels)
- **Lisibilité** : SQL inline, comportement transparent

Les "repos" exportés sont des **objets bag** (`{ get, upsert, delete, ... }`) plutôt que des classes — cohérent avec la convention fonctionnelle du projet.

## Fichiers

| Fichier | Brève | Doc complète |
|---------|-------|--------------|
| `appTokens.js` | `app_tokens` (Bearer hashes) + `notifications` | [appTokens.md](./appTokens.md) |
| `permissions.js` | `permissions` (rôles) + `avatar_permissions` | [permissions.md](./permissions.md) |
| `sessions.js` | `pngtuber_sessions` + `session_participants` + `invitations` | [sessions.md](./sessions.md) |
| `subscriptions.js` | `subscriptions` + `subscription_seats` | [subscriptions.md](./subscriptions.md) |
| `users.js` | `users` (config audio) + `frames` (images) | [users.md](./users.md) |

## Architecture interne

### Mapping fichier → tables

```
appTokens.js     →  app_tokens, notifications
permissions.js   →  permissions, avatar_permissions
sessions.js      →  pngtuber_sessions, session_participants, invitations
subscriptions.js →  subscriptions, subscription_seats
users.js         →  users, frames
```

Chaque fichier groupe **plusieurs tables liées fonctionnellement** dans un seul module. `appTokens.js` est le moins cohérent (notifications n'ont rien à voir avec les Bearer tokens — c'est juste qu'elles ont été créées au même moment dans le développement).

### Conventions

- **Soft delete partout sauf `subscription_seats` et `permissions`** : `revoked_at`, `left_at`, `status='ended'/'cancelled'`. Permet l'audit a posteriori.
- **UPSERT pattern** : `INSERT … ON CONFLICT(key) DO UPDATE SET ... = excluded.X` pour les tables `users`, `permissions`, `subscriptions`, `avatar_permissions`. Cohérent avec une logique CRUD simple.
- **Filtrage status au niveau SQL** : `subscriptions.get` ne retourne que les actifs, `participants.list` que ceux non partis. Évite la duplication de filter côté JS.
- **Préparation au load** : les `db.prepare(...)` sont au top-level — exécutés au premier import. Side-effect mais acceptable car `db` est singleton.

## Audit du dossier

### Issues majeures transversales

1. **🟠 Pagination absente** sur `users.all`, `frames.allForAdmin`, `permissions.all`, `notifications.list/unread` — DoS mémoire potentiel sur grosse base.

2. **🟠 `INSERT OR IGNORE` masque silencieusement les doublons** (`participants.add`, `seats.add`, `frames.insert`). L'appelant ne sait pas si l'opération a fait quelque chose. Devrait retourner `result.changes` au caller.

3. **🟠 `participants.add` ne réactive pas un user qui re-rejoint** (left_at != NULL) — bug fonctionnel. Migrer vers UPSERT avec `DO UPDATE SET left_at = NULL`.

4. **🟠 Pas d'UNIQUE partiel** sur `(guild_id, channel_id) WHERE status='active'` dans `pngtuber_sessions` → risque de sessions doubles.

5. **🟠 `subscriptions.expire` proactif sur le hot path** (appelé dans `getUserTier`) — UPDATE potentiel à chaque requête authentifiée. Devrait être un cron horaire.

### Issues mineures fréquentes

- **Pas de méthodes `purge*` / `cleanup*`** : pas de moyen propre de purger les notifs > 30j (mentionnée dans CLAUDE.md mais non visible ici), les sessions ended depuis longtemps, les seats expirés, etc.
- **Pas de méthode `users.delete`** orchestrant la suppression cross-tables — `admin.js` doit faire un `await import('database.js')` dynamique.
- **Pas de table `audit_log`** centralisée pour tracer les actions admin (set/cancel subscription, set/delete permission, revoke token).
- **`frames.stats` : 3 sous-requêtes** scannant la table — coûteux en grosse base. Cacher au minimum.
- **Indices à vérifier** : `app_tokens.token_hash UNIQUE`, `session_participants(discord_id, left_at)`, `frames(token, state_key, sort_order)`, `avatar_permissions(token, guild_id)` — pas visibles ici, à confirmer dans `database.js`.

### Patterns transversaux à introduire

1. **Helper `expireFilter`** : générer un fragment SQL `... AND (expires_at IS NULL OR expires_at > datetime('now'))` réutilisable pour subscriptions, invitations, app_tokens.
2. **Méthodes `purgeOlderThan(days)`** sur chaque repo soft-delete pour faciliter la rétention.
3. **Wrapper transaction** : le pattern `db.transaction(() => { ... })` n'est utilisé que dans `routes/upload.js`. Encapsuler dans des méthodes repo (`users.purge(token)`) plutôt que d'exposer la transaction au handler.

### Doublons / redondances

- **`appTokens.js`** mélange deux domaines (tokens + notifications). Splitter en `appTokens.js` et `notifications.js` clarifierait.
- **`sessions.js`** est gros (3 tables, ~13 statements). Acceptable mais à surveiller.

### Ce qui fonctionne bien

- **Statements préparés top-level** = perf maximale + zéro injection SQL
- **JSON en colonne** (`config_json`, `payload_json`, `guilds_json`) flexible (mais coûte les requêtes natives — trade-off connu)
- **Soft delete cohérent** — facilite audit et rollback
- **JOINs explicites** dans `byUser`, `pending`, `byUser` (seats) — lisibles et performants si indexes bien posés
- **`COALESCE(MAX(sort_order), -1)`** : astuce élégante pour démarrer à 0 sur table vide (`users.js#frames.maxOrder`)
