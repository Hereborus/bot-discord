# `config.js`

> Configuration audio par utilisateur, liste des users connus, validation du token bot.
> 📂 `src/routes/config.js`
> 🔗 Module : [`routes/`](./README.md)

## Résumé

Routes liées à la configuration : la config audio par utilisateur (lecture publique, écriture protégée), la liste des utilisateurs connus pour l'UI, et la validation/persistence du token Discord du bot. Inclut la logique de whitelist `ALLOWED_CONFIG_KEYS` qui empêche d'injecter des clés arbitraires dans le JSON de config, et l'enforcement du tier (suppression des features premium pour le tier `free`).

## Fonctions / Exports

### `validateUserConfig(cfg)` → `boolean`

**Brève** : Validation structurelle d'une config utilisateur (whitelist + types).

**Comportement actuel** : Refuse si non-objet, tableau ou null. Refuse toute clé hors `ALLOWED_CONFIG_KEYS`. Type-check chaque champ connu (`displayName`: string, `emotionHoldMs`: number, `thresholds`: array, etc.). Validation détaillée pour `blinkSettings` (mode toggle/transition, intervalMin/Max ≥ 200ms, durationMin/Max ≥ 50ms — rétrocompat ancien format `interval`/`duration`). Validation `emotionHotkeys` (code + emotion strings, mode toggle|hold).

**Comportement attendu (contrat)** : Pure function — renvoie boolean, ne mute rien. Doit être appelée AVANT `JSON.stringify` pour éviter une persistence corrompue. Les commentaires notent que `calibration` et `emotionFingerprints` sont conservés pour rétrocompat lecture mais sans validation stricte.

**Améliorations possibles** :
- Pas de validation du contenu de `thresholds` ou `emotions` (juste "doit être un array") — un array d'objets malformés passe
- `displayName` accepte des strings vides ou de longueur arbitraire (DoS via 1MB de texte)
- Migration vers une lib de schema (`zod`, `ajv`) serait beaucoup plus maintenable
- Pas de validation de `displayName` pour caractères XSS (échappement côté affichage requis)

### `handleGetUserConfig(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `GET /user-config/:token` — retourne la config (publique).

**Comportement actuel** : Vérifie que le token est connu (en mémoire ou en DB) sinon 404. Retourne `JSON.parse(row.config_json || '{}')` ou `{}`. Public car requis par le viewer OBS.

**Comportement attendu (contrat)** : Endpoint public — ne doit jamais exposer de données sensibles. Le `displayName` est inclus dans la config — déjà visible publiquement par design.

**Améliorations possibles** :
- `JSON.parse` peut throw si `config_json` est corrompu en DB → 500. Wrapper en try/catch.

### `handlePostUserConfig(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `POST /user-config/:token` — persiste la config (auth requise).

**Comportement actuel** :
1. 404 si token inconnu.
2. Lit/parse le body en JSON (try-catch global pour tout le handler).
3. `validateUserConfig` → 400 si invalide.
4. **Tier enforcement** : si tier free, supprime `cfg.emotions` et `cfg.emotionHotkeys` AVANT de persister.
5. UPSERT user avec `displayName || '???'` et JSON stringifié.
6. `broadcastConfigUpdate(token)` — push WebSocket aux viewers.

**Comportement attendu (contrat)** : Endpoint protégé par `requireClientOrAdmin + loadTier`. Idempotent. Le user ne peut écrire QUE sur SON propre token (vérifié par middleware en amont — `requireClientOrAdmin` doit comparer `tokenFor(session.discordId) === ctx.params.token`).

**Améliorations possibles** :
- Pas de check explicite ici que le user est bien propriétaire du token : repose entièrement sur le middleware. Risque si la chaîne middleware change.
- `JSON.parse` direct sur le body sans limite explicite (la limite passe par `readBody` à 10MB par défaut)
- Pas de logging des modifs (qui a changé quoi quand)
- Race condition : deux POST simultanés pour le même token → last-write-wins sans warning

### `handleKnownUsers(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `GET /known-users` — liste des users (token + displayName).

**Comportement actuel** : Combine deux sources :
1. **Users actifs en mémoire** (`uidToToken` Map — connectés en vocal) : `{ token, displayName, hasConfig: !!row }`.
2. **Users persistés en DB** : ajoutés s'ils ne sont pas déjà dans le tableau, marqués `offline: true`.

**Comportement attendu (contrat)** : Pour chaque user, expose token + displayName. Aucun discordId.

**Améliorations possibles** :
- `users.find(...)` en boucle = O(n²). Pour des centaines d'users en DB, utiliser un `Set<token>` de dédup
- `JSON.parse` sans try-catch (cf. note plus haut)
- Pas de pagination

### `handleBotToken(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `POST /bot-token` — valide et persiste le token bot, redémarre le process.

**Comportement actuel** :
1. Refuse si `< 50` chars (heuristique — un token Discord fait ~70 chars).
2. Validation auprès de Discord : `GET /api/v10/users/@me` avec le token.
3. Si OK : `setEnvKey('DISCORD_TOKEN', ...)` puis `setTimeout(() => process.exit(0), 500)` — relance le process via gestionnaire externe (Docker `restart: always`, systemd, etc.).

**Comportement attendu (contrat)** : Admin only. Doit être derrière HTTPS car le token transite en clair dans le body.

**Améliorations possibles** :
- `process.exit(0)` aveugle sans coordination — toute requête en cours est tuée. Idéalement, drainer les connexions actives, fermer le serveur HTTP, puis exit.
- Validation length 50 trop laxiste — Discord tokens ont un format précis (3 parties séparées par `.`). Check format avant d'appeler Discord.
- Si le hôte ne supporte pas le restart auto, le bot reste down → état ambigü. Documenter cette dépendance ou détecter `PM2`/`Docker` à l'init.
- Le token est temporairement loggé en clair via `console.log('Token mis à jour...')` (heureusement pas le token lui-même)

### `ALLOWED_CONFIG_KEYS` → `string[]`

Whitelist exportée des clés acceptées dans la config user. À tenir synchronisée avec le frontend.

## Dépendances

- **Importe** : [`http/helpers`](../http/helpers.js) (`json`, `readBody`), [`services/tokenService`](../services/tokenService.js) (`uidFor`, `tokenFor`), [`services/tierService`](../services/tierService.js) (`TIER_LIMITS`)
- **deps injectées** : `stmts`, `isKnownToken`, `broadcastConfigUpdate`, `uidToToken`, `setEnvKey`
- **Utilisé par** : `index.js`

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 Maj | `handleBotToken` : `process.exit(0)` dur sans drain | Fermer proprement HTTP server + Discord client avant exit |
| 🟠 Maj | Pas d'ownership check explicite dans `handlePostUserConfig` | Ajouter `if (tokenFor(ctx.session.discordId) !== ctx.params.token && role !== 'admin') return 403` |
| 🟡 Min | `validateUserConfig` ad-hoc et incomplet (arrays non validés en profondeur) | Migrer vers `zod` ou `ajv` |
| 🟡 Min | `handleKnownUsers` : O(n²) `.find` | Utiliser `Set` de tokens vus |
| 🟡 Min | `JSON.parse(row.config_json)` sans try-catch | Wrap, fallback `{}` |
| 🟡 Min | `displayName` non longueur-bornée | Tronquer à 64 chars max |
| 🟡 Min | `setEnvKey` mute le `.env` sans backup | Backup du `.env` avant write |

## Notes alternatives

- `validateUserConfig` est candidat à un refacto avec une lib de schema. Le code actuel est lisible mais accumule les règles métier ad-hoc — `zod.discriminatedUnion` pour `blinkSettings` mode serait plus expressif.
- Le pattern `deps`-injection est cohérent avec le reste des routes mais alourdit la signature. Une factory `makeRoutes(deps)` qui retourne les handlers fermés sur les deps simplifierait `index.js`.
