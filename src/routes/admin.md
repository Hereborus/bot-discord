# `admin.js`

> Endpoints administrateur : permissions, navigation DB, suppression d'utilisateur en cascade.
> 📂 `src/routes/admin.js`
> 🔗 Module : [`routes/`](./README.md)

## Résumé

Regroupe les routes réservées au rôle `admin` (sauf `handlePermissionsMe` qui est ouverte à tout utilisateur connecté). Couvre la gestion CRUD des permissions, deux endpoints lecture seule pour le DB browser (stats + liste des frames), et une route destructive de suppression d'utilisateur (fichiers + DB).

Les imports dynamiques (`await import('../db/database.js')`) sont utilisés dans `handleDeleteUser` pour casser une dépendance circulaire au niveau module.

## Fonctions / Exports

### `handleGetPermissions(req, res, ctx)` → `void`

**Brève** : `GET /api/permissions` — liste tous les rôles.

**Comportement actuel** : Lit `permRepo.all.all()`, transforme la liste en objet indexé par `discord_id` (pratique côté client). Parse `guilds_json` à la volée. Retourne `{ version: 1, users: { [discordId]: { role, grantedBy, grantedAt, displayName, guilds[] } } }`.

**Comportement attendu (contrat)** : Pré-condition : ctx.session.role === 'admin' (enforcé par middleware en amont). Post : 200 + dictionnaire complet des permissions.

**Améliorations possibles** :
- Pagination si la table grandit (actuellement chargée intégralement en mémoire)
- Cache léger (les permissions changent rarement)

### `handleSetPermission(req, res, ctx)` → `void`

**Brève** : `POST /api/permissions` — attribuer un rôle.

**Comportement actuel** : Whitelist `['admin','client','viewer']`. Bug léger : passe `discordId` deux fois au prepared statement (positions `granted_by` et `display_name`). Insère un tableau vide pour `guilds_json`.

**Comportement attendu (contrat)** : Le 3ème paramètre devrait être `ctx.session.discordId` (qui a octroyé) et le 4ème un nom lisible. Le cinquième paramètre `'[]'` n'est pas paramétré côté client.

**Améliorations possibles** :
- Corriger le mismatch de paramètres : `permRepo.upsert.run(discordId, role, ctx.session.discordId, displayName, JSON.stringify(guilds))`
- Logger qui a attribué le rôle (audit trail)
- Empêcher un admin de se rétrograder lui-même par accident

### `handleDeletePermission(req, res, ctx)` → `void`

**Brève** : `DELETE /api/permissions/:discordId` — révoquer un rôle.

**Comportement actuel** : Suppression directe sans confirmation, sans logging.

**Améliorations possibles** :
- Empêcher la suppression de sa propre permission admin (lockout)
- Audit trail

### `handlePermissionsMe(req, res, ctx)` → `void`

**Brève** : `GET /api/permissions/me` — mon rôle (tout utilisateur connecté).

**Comportement actuel** : Lit `permRepo.get`, retourne `viewer` par défaut si absent.

### `handleDbStats(req, res, ctx)` → `void`

**Brève** : `GET /api/db/stats` — { user_count, frame_count, total_size }.

### `handleDbFrames(req, res, ctx)` → `void`

**Brève** : `GET /api/db/frames` — liste complète (DB browser admin).

**Améliorations possibles** :
- Pagination obligatoire si > quelques milliers de frames

### `handleDeleteUser(req, res, ctx)` → `Promise<void>`

**Brève** : `POST /delete-user/:token` — suppression cascade fichiers + DB.

**Comportement actuel** : 
1. Appel inutile à `userRepo.get.get(token)` (résultat ignoré ligne 78).
2. Suppression des frames DB.
3. Suppression du dossier `images/<token>/` via `fs.rmSync` (uniquement si l'utilisateur existe — `&&` court-circuit).
4. `await import('../db/database.js')` puis suppression directe `DELETE FROM users` (contournement du repo).

**Comportement attendu (contrat)** : Suppression idempotente, complète et atomique de toutes les données d'un utilisateur. Devrait nettoyer aussi : `app_tokens`, `notifications`, `pngtuber_sessions` (owner), `session_participants`, `subscriptions`, `subscription_seats`, `avatar_permissions`.

**Améliorations possibles** :
- Ajouter `userRepo.delete` au repo et l'utiliser au lieu de l'import dynamique
- Wrapper dans une transaction SQLite (cohérence DB)
- Cascader la suppression sur toutes les tables liées (RGPD friendly)
- Vérifier l'existence avant pour retourner 404 si absent (idempotence vs explicite)
- Path traversal : valider `token` avec `SAFE_FILENAME` regex avant `path.join(IMAGES_DIR, token)` — un token contenant `..` provoquerait `rmSync` hors du dossier prévu (atténué par le hash HMAC mais pas garanti)

## Dépendances

- **Importe** : [`http/helpers`](../http/helpers.js) (`json`), [`db/repos/permissions`](../db/repos/permissions.js), [`db/repos/users`](../db/repos/users.js) (`users`, `frames`), `node:path`, `node:fs`
- **Utilisé par** : `index.js` (route registration)

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 Maj | `handleDeleteUser` : path traversal potentiel via `token` non validé | Valider avec regex `SAFE_FILENAME` avant tout `path.join` |
| 🟠 Maj | `handleDeleteUser` : suppression non transactionnelle (fichiers OK puis crash DB → orphelins) | Wrapper en transaction, ou inverser ordre (DB d'abord) |
| 🟠 Maj | `handleDeleteUser` : ne nettoie pas tables liées (notifs, sessions, subs, app_tokens) | Cascader la suppression |
| 🟡 Min | `handleSetPermission` : passe `discordId` au lieu de `displayName` (param 4) | Corriger les arguments du UPSERT |
| 🟡 Min | Pas d'audit trail sur les modifs admin | Logger toute action admin (qui, quand, quoi) |
| 🟡 Min | `handleDbFrames` : pas de pagination | Ajouter `?limit=&offset=` |

## Notes alternatives

`handleDeleteUser` mériterait d'être déplacé dans `db/repos/users.js` comme méthode `purge(token)` orchestrant le nettoyage cross-tables. La route ne ferait alors qu'appeler ce repo.

L'import dynamique de `database.js` est un code smell — il signale que `users.js` repo n'expose pas tout ce dont la route a besoin.
