# `authService.js`

> **Sessions OAuth2 Discord (cookies HMAC) + Bearer tokens (Device Auth Flow).**
> `src/services/authService.js`
> Module : [`services/`](./README.md)

## Résumé

Gère deux mécanismes d'authentification fondamentalement différents :
1. **Sessions navigateur** — cookie `pngtuber_session` signé HMAC-SHA256, stockage en `Map` mémoire.
2. **App tokens (Bearer)** — issus du Device Auth Flow ; comparés via leur SHA-256 stocké en DB (`appTokens`), jamais le secret brut.

Expose `resolveAuth(req)` qui choisit le bon mécanisme selon les headers de la requête. Auto-disable si `DISCORD_CLIENT_ID` n'est pas configuré (mode dev local).

## Fonctions / Exports

### `sign(value)` / `verify(signed)` *(internes)*

**Brève** : signature HMAC-SHA256 + comparaison `crypto.timingSafeEqual` pour éviter les timing attacks.
**Comportement actuel** : format `<value>.<sigBase64url>`. Verify retourne la valeur ou `null` si signature invalide.
**Améliorations** : aucune — implémentation correcte.

### `parseCookies(req)` → `Object<string,string>`

**Brève** : split naïf `;` puis `=` sur l'en-tête `Cookie`.
**Contrat** : ne supporte pas les valeurs avec `;` quoté. Suffisant pour des cookies simples.

### `getSession(req)` → `session | null`

**Brève** : extrait + vérifie le cookie, lit la session in-memory, supprime si expirée.
**Comportement actuel** : cleanup à la lecture — bonne pratique.

### `createSession(discordUser, userGuildIds)` → `sessionId`

**Brève** : crée un sessionId aléatoire (32 bytes hex) ; durée 7 jours.
**Effet de bord** : appelle `getUserRole(discordUser.id)` qui touche la DB.

### `setSessionCookie(res, sessionId, baseUrl)`

**Brève** : pose le cookie `HttpOnly; SameSite=Lax`, `Secure` conditionnel à HTTPS.
**Contrat** : appelée juste après `createSession` dans `/auth/callback`.

### `getUserRole(discordId)` → `'admin' | 'client' | 'viewer'`

**Brève** : lookup synchrone en DB `permissions`. Default `viewer` si absent.

### `resolveAuth(req)` → `session | null`

**Brève** : Bearer token prioritaire ; fallback sur cookie.
**Comportement actuel** :
- Bearer → SHA-256 → lookup `appTokens.get` → `appTokens.touch` (last_used_at) → forcage du rôle à `client` même si l'user est admin (réduction de surface).
- Cookie → `getSession`.
**Contrat attendu** : retourne `null` si auth invalide ; le caller (`middleware.requireAuth`) décide de la réponse 401 / redirect.
**Améliorations** :
- L'usage de `appTokens.touch.run(hash)` à **chaque requête authentifiée** crée une écriture SQLite par appel API → peut devenir un bottleneck (voir `pngtuber.db-wal`).
- `actualRole === 'admin' ? 'client' : actualRole` rétrograde silencieusement — devrait logger.

### `AUTH_ENABLED` — `boolean`

**Brève** : `true` si `DISCORD_CLIENT_ID` **et** `DISCORD_CLIENT_SECRET` présents.
**Note** : si `false`, **tous** les middlewares (`requireAuth`, `requireAdmin`, `requireClientOrAdmin`) sont court-circuités → mode "dev local plein admin". À ne **jamais** activer en prod par accident.

### Maps `sessions`, `oauthStates`

`sessions` : sessionId → user. `oauthStates` : state CSRF → `{ expiresAt, redirect? }`. GC périodique toutes les 60 s.

## Dépendances
- **Importe** : `node:crypto`, [`db/repos/permissions.js`](../db/repos/permissions.js), [`db/repos/appTokens.js`](../db/repos/appTokens.js).
- **Utilisé par** : [`http/middleware.js`](../http/middleware.md), `index.js` (`/auth/login`, `/auth/callback`, `/auth/logout`), [`routes/device.js`](../routes/device.js).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | `SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')` — si `SESSION_SECRET` n'est pas fixé en env, **toutes les sessions sont invalidées** à chaque redémarrage (UX catastrophique). | Au minimum logger un WARN au boot quand le secret est généré ; persister sur disque comme fallback. |
| 🟠 | Sessions **stockées en mémoire** : un redémarrage déconnecte tout le monde. Aucune session sticky possible derrière un LB multi-instance. | Migrer sur SQLite si scaling envisagé. |
| 🟡 | `appTokens.touch.run(hash)` à chaque requête → I/O DB sur le hot-path. | Coalescer (touch toutes les 60 s par token via `Map<hash, ts>`). |
| 🟡 | `parseCookies` ne décode pas les valeurs (pas de `decodeURIComponent`). | OK pour notre cas (signed cookie hex), mais à documenter. |
| 🟡 | Le rôle des app tokens est plafonné à `client` à la résolution mais `actualRole` est leaké dans le retour — un caller négligent pourrait l'utiliser. | Renommer ou ne pas exposer. |

## Notes alternatives

`oauthStates` est créé/lu par `index.js` directement, ce qui couple `authService` à l'orchestrateur OAuth — à terme une fonction `createOAuthState(redirect)` ferait sens.
