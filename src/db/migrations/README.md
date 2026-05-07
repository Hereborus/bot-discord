# `migrations/`

> Migrations SQL versionnees. Appliquees automatiquement au demarrage par le runner dans `src/db/database.js`.

## Fonctionnement

Chaque fichier `.sql` ici est une migration. Au demarrage :

1. Le runner cree (si pas la) la table `_migrations`.
2. Il lit la liste des fichiers `.sql` du dossier, **tries lexicographiquement**.
3. Pour chaque fichier non encore enregistre dans `_migrations`, il l'applique en **transaction** et insere son nom dans `_migrations`.
4. Si une migration echoue, le serveur **refuse de demarrer** (exit non-zero).

## Convention de nommage

```
NNN_description_courte.sql
```

- `NNN` : numero a 3 chiffres (001, 002, 003...). Garantit l'ordre.
- `description_courte` : snake_case lisible (ex: `add_user_avatar_url`).
- Toujours `.sql` (pas `.SQL`).

## Idempotence

Les migrations doivent etre **idempotentes autant que possible** :

- `CREATE TABLE IF NOT EXISTS` au lieu de `CREATE TABLE`.
- Pour `ALTER TABLE ... ADD COLUMN`, SQLite n'a pas de `IF NOT EXISTS`. Use:
  ```sql
  -- migrations/00X_add_user_email.sql
  ALTER TABLE users ADD COLUMN email TEXT;
  ```
  Si la colonne existe deja (ex: la migration a deja ete appliquee mais
  `_migrations` a ete reset), la transaction echouera. Dans ce cas, soit
  on accepte le crash (bug de configuration), soit on ecrit une migration
  defensive avec `PRAGMA table_info(users)` + check applicatif.

## Exemple

```sql
-- migrations/001_add_user_avatar_url.sql
ALTER TABLE users ADD COLUMN avatar_url TEXT;
CREATE INDEX IF NOT EXISTS idx_users_avatar ON users(avatar_url);
```

## Etat actuel

Aucune migration n'a encore ete creee — le schema initial est entierement defini dans `src/db/database.js` via `CREATE TABLE IF NOT EXISTS` (idempotent). Cette table `_migrations` reste vide jusqu'a la premiere evolution post-PR `release/v2-with-fixes`.

## Notes

- Pas de migration `down` (rollback) : SQLite ne supporte pas tout, et le projet privilegie les changements additifs.
- En cas de besoin de rollback, restaurer un backup `data/pngtuber.db` du jour.
- Le runner s'execute **a chaque demarrage**, donc les migrations doivent etre rapides (< quelques secondes idealement).
