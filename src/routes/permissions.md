# `permissions.js`

> Permissions globales (rôles) + permissions d'avatar par guilde + endpoints user "self".
> 📂 `src/routes/permissions.js`
> 🔗 Module : [`routes/`](./README.md)

## Résumé

Couvre **deux niveaux de permissions** :
1. **Permissions globales** (`admin`/`client`/`viewer`) — rôle par discordId
2. **Permissions d'avatar par guild** — un user peut autoriser/interdire l'affichage de son avatar dans une guilde Discord donnée

Comprend aussi des endpoints "self" : `GET /api/permissions/me` et `GET /api/my-token`. Coexiste partiellement avec [`admin.js`](./admin.md) qui gère les mêmes routes globales — voir audit transversal.

## Fonctions / Exports

### `loadPermissions(stmts)` → `{ version, users }`

Helper interne. Lit toutes les permissions, indexe par `discord_id`, parse `guilds_json`. Identique à `handleGetPermissions` dans `admin.js`.

### `isAvatarAllowed(stmts, token, guildId)` → `boolean`

**Brève** : Vérifie si un avatar peut s'afficher dans une guilde.

**Comportement actuel** : Si `guildId` falsy → `true` (rétrocompat / contexte direct). Sinon lit `getAvatarPerm.get(token, guildId)`. Renvoie `!!row.allowed` si ligne, `true` par défaut si aucune règle (allow-by-default).

**Comportement attendu (contrat)** : Pure function (signature avec `stmts` injecté). Sémantique allow-by-default — un user qui n'a JAMAIS configuré ses permissions est visible partout.

**Améliorations possibles** :
- La sémantique **deny-by-default** serait plus sûre côté privacy (user pas configuré → pas affiché par erreur). Mais demande migration et UX explicite.
- Cache léger : ces permissions changent rarement, hit fréquent depuis le pipeline d'affichage.

### `handleGetPermissions(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `GET /api/permissions` — liste (admin only).

Strictement équivalent à `admin.js#handleGetPermissions`. Voir [admin.md](./admin.md).

### `handleSetPermission(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `POST /api/permissions` — set/upsert.

**Comportement actuel** : Whitelist `['admin','client','viewer']`. Insère `displayName` (ou `'Unknown'`) et `JSON.stringify(guilds || [])`. Bug **fixé ici** : passe correctement `displayName` (vs `discordId` dans admin.js).

### `handleDeletePermission(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `DELETE /api/permissions/:discordId`. Identique à `admin.js`.

### `handleGetMyPermissions(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `GET /api/permissions/me` — mon rôle + guildes attribuées.

Combine `getUserRole(discordId)` (tier/admin computation) avec la lecture brute de la permission DB. Retourne `{ role, guilds }`. `guilds` peut être `null` si aucune ligne en DB (le user a un rôle calculé sans entrée explicite, e.g. admin via `ADMIN_DISCORD_ID`).

### `handleMyToken(req, res, ctx)` → `Promise<void>`

**Brève** : `GET /api/my-token` — token opaque + displayName de l'utilisateur connecté.

`tokenFor(session.discordId)` → token déterministe HMAC. Le user obtient son token persistant pour configurer son avatar.

### `handleGetAvatarPerms(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `GET /api/avatar-permissions/:token` — autorisations par guilde.

**Comportement actuel** : Lit `getAvatarPerms.all(token)`, enrichit chaque ligne avec `guildName` + `guildIcon` depuis le cache Discord (si `botConnected`). Fallback sur `r.guild_id` brut.

**Améliorations possibles** :
- Pas de check ownership : un user peut lire les permissions d'un autre user (pas critique car juste guildId+allowed, mais fuite metadata)
- Si le bot n'a pas la guild en cache (server bot pas dedans), l'icon est null — UX dégradée

### `handleSetAvatarPerm(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `POST /api/avatar-permissions` — set autorisation.

**Comportement actuel** : Vérifie ownership : si non admin, `body.token` doit égaler `tokenFor(ctx.session.discordId)`. ✓ Bonne pratique.

**Améliorations possibles** :
- Pas de validation que `guildId` correspond à un format Discord (snowflake) — `body.guildId === '../etc/passwd'` est inséré tel quel en DB. Pas exploitable directement (juste une string en DB), mais contamine le DB browser.

## Dépendances

- **Importe** : [`http/helpers`](../http/helpers.js), [`services/tokenService`](../services/tokenService.js), [`services/authService`](../services/authService.js) (`getUserRole`, `getSession`)
- **deps injectées** : `stmts`, `client` (Discord), `botConnected`
- **Utilisé par** : `index.js`. `isAvatarAllowed` consommé par les pipelines de filtrage d'avatar dans le bot.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🔴 Crit | **Doublon partiel avec `admin.js`** : `handleGetPermissions`, `handleSetPermission`, `handleDeletePermission` existent dans les deux fichiers | Décider lequel garder. Recommandation : garder `permissions.js` (gère aussi avatar perms + endpoints self), supprimer ces 3 handlers de `admin.js`. |
| 🟠 Maj | `isAvatarAllowed` allow-by-default | Considérer deny-by-default avec UX explicite |
| 🟡 Min | `handleGetAvatarPerms` : pas de check ownership | Vérifier `tokenFor(session.discordId) === token \|\| admin` |
| 🟡 Min | `guildId` non validé (regex snowflake) | `/^\d{17,19}$/` |
| 🟡 Min | `handleGetMyPermissions` : `guilds: null` ambigu vs `[]` | Renvoyer `[]` par défaut |

## Notes alternatives

La logique avatar perms n'est pas exposée dans le frontend React migré (selon CLAUDE.md). Si la feature n'est pas activement utilisée, marquer obsolète ou créer une vraie UI.

`isAvatarAllowed` mériterait d'être dans `services/` plutôt que `routes/` (c'est une fonction utilitaire pure, pas un handler HTTP).
