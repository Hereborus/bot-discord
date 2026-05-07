# `database.js`

> **Initialisation SQLite (better-sqlite3) + schéma complet en un seul `db.exec`.**
> `src/db/database.js`
> Module : [`db/`](./README.md)

## Résumé

Crée le dossier `DATA_ROOT` si absent, ouvre `pngtuber.db` en mode WAL avec `foreign_keys=ON`, et applique **idempotamment** le schéma (10 tables + 9 index). Un seul `Database` partagé via export — correct pour SQLite mono-process. Pas de système de migrations versionné.

## Exports

### `db` — `Database` *(better-sqlite3)*

**Brève** : connexion unique partagée par tous les repositories de [`db/repos/`](./README.md).
**Contrat attendu** : import statique en haut de chaque repo. Ne **jamais** ouvrir une seconde connexion sur le même fichier (le mode WAL le supporte mais le projet n'en a pas besoin).

## Schéma

10 tables :
- `users` — profil PNGTuber (token PK, displayName, config_json blob).
- `frames` — un sprite uploadé (token, state_key, filename, sort_order).
- `permissions` — rôle par discord_id (admin/client/viewer).
- `avatar_permissions` — droits par token × guild_id.
- `subscriptions` — abonnements premium/streamer (Stripe).
- `subscription_seats` — slots premium dans un pack streamer.
- `pngtuber_sessions` — sessions collaboratives (voice/standalone).
- `session_participants` — qui est dans quelle session.
- `invitations` — invitations ciblées ou liens.
- `app_tokens` — Bearer tokens (Device Auth Flow), stockés en SHA-256.
- `notifications` — file de notifications par user.

9 index couvrant les requêtes courantes : `idx_frames_token_state`, `idx_seats_*`, `idx_psessions_*`, `idx_sparticipants_user`, `idx_invitations_*`, `idx_app_tokens_discord`, `idx_notifications_user`.

## Pragmas

- `journal_mode = WAL` : lectures non bloquantes, important pour le polling fréquent de `/levels`.
- `foreign_keys = ON` : applique les `ON DELETE CASCADE` (sessions/participants, invitations).

## Dépendances
- **Importe** : `better-sqlite3`, `node:path`, `node:fs`.
- **Utilisé par** : tous les fichiers `db/repos/*.js`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **Pas de système de migrations versionné** — `CREATE TABLE IF NOT EXISTS` est idempotent, mais une **modification de schéma** (ALTER TABLE, nouvelle colonne) nécessite une migration manuelle. Aucun schéma version stocké. | Ajouter table `schema_migrations` + un script `applyMigrations()` au boot. |
| 🟠 | `JSON` blobs en `TEXT` (`config_json`, `payload_json`, `guilds_json`) **sans validation** côté DB. Une donnée corrompue est détectée seulement au `JSON.parse()` côté code. | Au minimum `CHECK(json_valid(config_json))` (SQLite ≥3.38). |
| 🟠 | Pas de `synchronous` pragma explicite — défaut WAL = `NORMAL`, perte possible des dernières écritures sur power loss. Pour un bot Discord c'est acceptable, mais à doc. | Doc explicite + considérer `FULL` pour les writes critiques (subscriptions). |
| 🟡 | Pas de **busy_timeout** — si une transaction lente bloque, les lectures concurrentes échouent immédiatement avec `SQLITE_BUSY`. | `db.pragma('busy_timeout = 5000')`. |
| 🟡 | `created_at`/`updated_at` en TEXT `datetime('now')` UTC implicite — pas de timezone explicite. | Documenter "UTC" ; envisager INTEGER `unixepoch()`. |
| 🟡 | Pas de **VACUUM** ni **WAL checkpoint** automatique → fichier `pngtuber.db-wal` peut croître indéfiniment. | Cron `db.pragma('wal_checkpoint(TRUNCATE)')` toutes les 24 h. |
| 🟡 | Schema en string littéral 100+ lignes → diff peu lisible. | Externaliser en `db/schema.sql`. |

## Notes alternatives

`better-sqlite3` est synchrone par design — toutes les statements bloquent la single-thread Node. Acceptable pour un bot mono-process avec ~10 users vocaux ; à profiler si la base passe les 100k frames ou les 10k notifications par user.

Une migration future à **PostgreSQL** (multi-instance, scaling) demanderait de remplacer `better-sqlite3` par `pg`/`postgres`, ré-écrire les statements préparées, et gérer les transactions async dans tous les repos.
