# `auth.js`

> Flux OAuth2 Discord complet (login / callback / logout / me) + toggle test-mode admin.
> 📂 `src/routes/auth.js`
> 🔗 Module : [`routes/`](./README.md)

## Résumé

Implémente le pipeline OAuth2 Discord côté navigateur : redirection vers Discord, échange du code, création de session signée, retour des infos courantes. Inclut une protection anti-CSRF par `state` (nonce 16 octets, expiration 5 min, taille capée à 1000), un rate limit par IP sur `/auth/login` (30/min), et un mode debug `/api/test-mode` qui permet à un admin de simuler un rôle `client`.

L'authentification est **optionnelle** au démarrage — désactivée si `DISCORD_CLIENT_ID` n'est pas configuré (`AUTH_ENABLED = false`).

## Fonctions / Exports

### `getClientIp(req)` → `string`

**Brève** : Helper interne — extrait l'IP en respectant `TRUST_PROXY`.

Si `TRUST_PROXY=true|1`, lit `X-Forwarded-For` (premier élément seulement). Sinon `req.socket.remoteAddress`. Renvoie `'unknown'` si rien. Dupliqué dans `device.js` — candidat à un helper partagé.

### `verifyCookie(signed)` → `string | null`

**Brève** : Vérifie un cookie signé HMAC-SHA256.

**Comportement actuel** : Sépare `value.signature` au dernier `.`, recalcule l'HMAC, compare en temps constant via `timingSafeEqual`. Retourne la valeur ou null. Utilisé uniquement par `handleAuthLogout` pour identifier la session à supprimer.

**Comportement attendu (contrat)** : Robuste contre les attaques par timing (✓), mais retourne null silencieusement si `SESSION_SECRET` absent — pourrait signaler une mauvaise config.

### `handleAuthLogin(req, res, ctx, rateLimit)` → `Promise<void>`

**Brève** : `GET /auth/login` — initie le flux OAuth2.

**Comportement actuel** :
1. Rate limit : 30/min/IP. 429 + HTML simple si dépassé.
2. Si `oauthStates.size > 1000`, purge les 200 plus anciens (cap mémoire — DoS protection).
3. Génère un `state` aléatoire 16 octets et stocke `{ expiresAt, next }` (5 min).
4. Valide le `next` query param : doit commencer par `/` mais pas `//` (évite open redirect).
5. Redirige vers Discord avec scopes `identify guilds`.

**Comportement attendu (contrat)** : Crée un état OAuth signé pour CSRF protection. Le user finit sur `/auth/callback` avec `?code=...&state=...`.

**Améliorations possibles** :
- Stocker `state` aussi dans un cookie HttpOnly côté navigateur (double-submit cookie pattern) plutôt que map mémoire (perdu au restart, et inutilement partagé entre IPs)
- Le purge "200 plus anciens" est O(n log n) — utiliser une LRU map plus efficace si la fréquence augmente
- Si `clientId` absent, retourner JSON vs HTML inconsistant (les autres erreurs sont HTML)

### `handleAuthCallback(req, res, ctx)` → `Promise<void>`

**Brève** : `GET /auth/callback` — échange code → session.

**Comportement actuel** :
1. Lit `code`, `state` ; consomme `oauthStates.get(state)` puis le supprime (one-shot).
2. Support des deux formats historiques : nombre simple ou objet `{ expiresAt, next }`.
3. Échange code → access_token (Discord `/oauth2/token`).
4. Récupère `/users/@me` puis `/users/@me/guilds` (fail silently sur les guilds).
5. Détermine le rôle via `getUserRole(discordId)` :
   - admin/client → crée session + cookie + redirect vers `nextUrl || '/'`
   - sinon → 403 HTML "Accès refusé"

**Comportement attendu (contrat)** : Toute erreur réseau/HTTP renvoie une page HTML avec lien retry. Sessions stockées via `createSession` (`services/authService`).

**Améliorations possibles** :
- Le double `if (!tokenRes.ok) ... if (!userRes.ok)` pourrait être factorisé avec un helper d'erreur HTML
- En cas d'erreur Discord (e.g. token révoqué), aucun retry/cleanup. Loguer l'erreur Discord retournée.
- Pas de fallback si `userGuildIds` partiel (rate limit Discord) → impacte la visibilité serveurs côté client

### `handleAuthLogout(req, res, ctx)` → `Promise<void>`

**Brève** : `GET /auth/logout` — supprime la session + cookie.

**Comportement actuel** : Lit le cookie `pngtuber_session`, vérifie la signature, supprime de `sessions` Map. Pose `Set-Cookie: ...; Max-Age=0`. Redirige vers `/auth/login`.

**Améliorations possibles** :
- Devrait être en `POST` (sinon vulnérable à CSRF logout via `<img>` ou lien malveillant)
- Cookie de purge devrait porter les mêmes attributs que le cookie de session (`Secure`, `SameSite`) sinon ne match pas selon les navigateurs

### `handleAuthMe(req, res, ctx)` → `Promise<void>`

**Brève** : `GET /auth/me` — infos session courante.

**Comportement actuel** : Si pas de session → 401. Sinon retourne `{ authenticated, username, discordId, role, effectiveRole, testMode, tier, tierLimits }`. `effectiveRole` = `testRole || role || 'viewer'`.

### `handleTestMode(req, res, ctx)` → `Promise<void>`

**Brève** : `POST /api/test-mode` — admin simule un rôle client.

**Comportement actuel** : Vérification redondante `ctx.session.role !== 'admin'` (le middleware en amont devrait déjà garantir). Toggle `session.testRole = 'client'` ou supprime.

**Améliorations possibles** :
- Vérification admin dupliquée
- `body.enabled` n'est jamais validé (truthy/falsy implicite) — accepterait `"yes"`, `1`, `[]`...

## Dépendances

- **Importe** : `node:crypto`, [`services/authService`](../services/authService.js), [`services/tierService`](../services/tierService.js), [`http/cors`](../http/cors.js), [`http/helpers`](../http/helpers.js)
- **Utilisé par** : `index.js` (registration et middleware d'auth)

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 Maj | `/auth/logout` accepte GET (CSRF logout possible) | Restreindre à POST + token CSRF |
| 🟠 Maj | `state` OAuth en mémoire seulement → perdu au restart, partagé cross-IP | Utiliser cookie HttpOnly signé en complément |
| 🟡 Min | `getClientIp` dupliqué (auth.js + device.js) | Extraire dans `http/helpers.js` |
| 🟡 Min | Erreurs OAuth retournées en HTML mêlées avec JSON dans `handleAuthLogin` | Cohérence HTML pour endpoints navigateur, JSON pour API |
| 🟡 Min | `handleTestMode` : double check admin redondant | Faire confiance au middleware |
| 🟡 Min | Cookie de purge sans `Secure`/`SameSite` matching | Aligner les attributs |
| 🟡 Min | Logging insuffisant des échecs OAuth Discord | Logger `e.message` du token endpoint |

## Notes alternatives

- Le pattern `oauthStates` Map + GC manuel pourrait être remplacé par une lib mature (`@fastify/csrf-protection` côté style, ou simple TTL Map factorisée).
- Les pages HTML d'erreur inline pourraient être centralisées dans `http/helpers.js` (`renderErrorPage(status, title, message, retryUrl)`).
- `handleAuthCallback` est gros (~70 lignes) — split possible : `exchangeCode`, `fetchUser`, `fetchGuilds`, `createUserSession`.
