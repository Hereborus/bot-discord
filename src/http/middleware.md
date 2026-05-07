# `middleware.js`

> **3 middlewares d'authentification : requireAuth, requireAdmin, requireClientOrAdmin.**
> `src/http/middleware.js`
> Module : [`http/`](./README.md)

## Résumé

Garde-fous standards pour la chaîne de routes. Convention : retourne `true` ⇒ continuer la chaîne ; retourne `false` ⇒ réponse déjà envoyée (401/403/redirect), arrêter. Tous les middlewares court-circuitent à `true` quand `AUTH_ENABLED === false` (mode dev local).

## Fonctions / Exports

### `requireAuth(req, res, ctx)` → `boolean`

**Brève** : exige une session valide (cookie ou Bearer).
**Comportement actuel** :
1. Si `AUTH_ENABLED=false` → injecte une **session anonyme admin** (`{ discordId: 'anonymous', role: 'admin' }`) et passe.
2. Sinon, `resolveAuth(req)` → si null, redirige `/auth/login` pour navigateurs, JSON 401 pour les API calls (heuristique sur `Accept` ou `Content-Type`).
3. Sinon, `ctx.session = session`.
**Contrat attendu** : chaîné en premier sur les routes protégées.
**Améliorations possibles** :
- L'heuristique navigateur vs API est fragile : `req.headers['content-type']` peut être présent sur un POST navigateur (form). Utiliser plutôt `req.headers.accept.includes('text/html')`.
- La session anonyme **a le rôle `admin`** — si un dev oublie `DISCORD_CLIENT_ID` en prod, **toute la surface est exposée**. Devrait au moins logger un WARN clignotant au boot.

### `requireAdmin(req, res, ctx)` → `boolean`

**Brève** : `ctx.session.role === 'admin'` requis.
**Comportement actuel** : 403 JSON sinon.
**Contrat attendu** : chaîné après `requireAuth`.

### `requireClientOrAdmin(req, res, ctx)` → `boolean`

**Brève** : admin → ok ; client → ok **uniquement** sur ses propres données.
**Comportement actuel** :
- Compare `ctx.params.token` (segment dynamique d'URL) à `tokenFor(session.discordId)`.
- Fallback sur `ctx._bodyToken` (injecté par le caller après parsing du body multipart, cf. `routes/upload.js`).
- 401 si pas de session, 403 sinon.
**Contrat attendu** : utilisé sur les routes `/upload`, `/reorder`, `/delete-frame`, `/user-config/:token POST`, etc.
**Améliorations possibles** :
- `ctx._bodyToken` est un contrat **implicite** entre le router et le handler ; si le handler oublie de l'injecter, la route est bloquée silencieusement. Documenter dans le README du dossier.
- `tokenFor` est appelé à chaque check — synchrone et cached, mais si le cache n'est pas chaud (premier appel après boot), c'est une opération HMAC.

## Dépendances
- **Importe** : [`services/authService.js`](../services/authService.md) (`AUTH_ENABLED`, `resolveAuth`), [`http/helpers.js`](./helpers.md) (`json`), [`services/tokenService.js`](../services/tokenService.md) (`tokenFor`).
- **Utilisé par** : `index.js` (toutes les routes auth-protégées), [`bot/calibration.js`](../bot/calibration.md), `routes/*.js`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🔴 | `AUTH_ENABLED=false` ⇒ **session anonyme avec rôle admin**. Un déploiement prod sans `DISCORD_CLIENT_ID` (oubli, mauvaise config) laisse l'admin panel ouvert au monde. | Refuser le boot avec un message clair si `NODE_ENV=production` et `AUTH_ENABLED=false`. Au minimum, logger un WARN très visible. |
| 🟠 | L'heuristique HTML vs JSON peut router une **redirect 302 au lieu d'une 401 JSON** sur un fetch sans `Accept` explicite. | `req.headers.accept?.includes('text/html')` est plus fiable. |
| 🟡 | `requireClientOrAdmin` ne distingue pas "client cherche les données d'un autre" (devrait être 403) vs "session invalide" (devrait être 401). | Préciser le code de retour. |
| 🟡 | Pas de check `client` sur `ctx.body.token` directement — repose sur le contrat `_bodyToken`. Un nouveau handler oubliant d'injecter ouvre une faille. | Helper `assertOwnsToken(ctx, token)` réutilisable. |

## Notes alternatives

Le pattern "middleware retournant `bool`" est pragmatique mais éloigné de Connect/Express (`next()`). Le coût d'apprentissage pour un nouveau dev est faible (10 lignes de router) mais à signaler dans le README du dossier `http/`.
