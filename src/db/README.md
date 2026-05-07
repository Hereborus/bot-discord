# `db/`

> **Persistance SQLite (better-sqlite3) — schéma + repositories.**
> Parent : [`src/`](../README.md)

## Vue d'ensemble

Une seule connexion SQLite partagée, exportée par `database.js`. Les **repositories** dans `repos/` (users, permissions, sessions, subscriptions, appTokens) exposent des **prepared statements** déjà compilés ; pattern minimaliste sans ORM. Mode WAL pour les lectures concurrentes (polling fréquent de `/levels`). Pas de système de migrations — tout passe par `CREATE TABLE IF NOT EXISTS`.

## Fichiers

| Fichier | Brève | Doc complète |
|---------|-------|--------------|
| `database.js` | Init SQLite + 10 tables + 9 index + pragmas WAL/foreign_keys. | [database.md](./database.md) |
| `repos/` | Statements préparées par domaine (users, permissions, sessions, subscriptions, appTokens). | *(non couvert dans cette passe)* |

## Architecture interne

```
   db/database.js
        |
        | (export `db`)
        |
        +-----> db/repos/users.js          ← imported by tokenService, audio (upsert)
        +-----> db/repos/permissions.js    ← imported by authService.getUserRole
        +-----> db/repos/subscriptions.js  ← imported by tierService.getUserTier
        +-----> db/repos/sessions.js       ← imported by routes/sessions.js
        +-----> db/repos/appTokens.js      ← imported by authService.resolveAuth
```

Toutes les statements sont préparées **au chargement du repo** (au boot du process) — coût compilation amorti une fois.

## Audit du dossier

- 🟠 **Pas de migrations versionnées** — un changement de schéma demande un script manuel ou un nouveau `CREATE TABLE` qui ignore la nouvelle colonne sur les bases existantes.
- 🟠 **JSON blobs (`config_json`, `payload_json`, `guilds_json`) non validés** côté DB — corruption silencieuse possible.
- 🟠 **Pas de `busy_timeout`** — `SQLITE_BUSY` en cas de transaction concurrente lente.
- 🟡 **Pas de WAL checkpoint automatique** — `pngtuber.db-wal` peut grossir indéfiniment.
- 🟡 **`datetime('now')`** en TEXT UTC implicite — pas de timezone ni format ISO documenté.
- 🟡 **Pas d'`unique` ni de check** sur `permissions.role` (`'admin'|'client'|'viewer'`) — typo possible.

## Notes alternatives

Pour un futur scaling multi-instance, deux options :
1. **PostgreSQL** : ré-écrire les `prepare()` en SQL async + transactions.
2. **Litestream** : répliquer le SQLite WAL vers S3 / NFS, conserver l'API.

Aucune des deux n'est urgente pour un bot mono-container avec ~10-50 users actifs.
