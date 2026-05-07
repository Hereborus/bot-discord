# `services/`

> **Couche métier transverse — état partagé, auth, rate limit, tiers, tokens, voice state.**
> Parent : [`src/`](../README.md)

## Vue d'ensemble

Ce dossier regroupe tout ce qui n'est **ni HTTP, ni Bot Discord, ni DB pure**. Chaque service expose un sous-ensemble d'état + des fonctions pures (ou presque) qui le manipulent. Plusieurs services sont **stateful** par nature (caches mémoire, sessions, baseline EMA) — c'est explicité dans leur doc. La granularité est volontairement fine pour permettre l'extraction future d'un service en module npm.

## Fichiers

| Fichier | Brève | Doc complète |
|---------|-------|--------------|
| `audioService.js` | État du pipeline audio (Maps mutables + constantes `AUDIO`). Pas de logique. | [audioService.md](./audioService.md) |
| `authService.js` | Sessions OAuth2 cookie HMAC + Bearer tokens (Device Auth Flow). | [authService.md](./authService.md) |
| `rateLimiter.js` | Fixed window in-memory. Single-instance only. | [rateLimiter.md](./rateLimiter.md) |
| `tierService.js` | Résolution free/premium/streamer + middlewares. | [tierService.md](./tierService.md) |
| `tokenService.js` | Tokenisation HMAC des userId Discord (16 hex). | [tokenService.md](./tokenService.md) |
| `voiceService.js` | État connexion vocale + persistance auto-reconnect. | [voiceService.md](./voiceService.md) |

## Architecture interne

```
                                  +------------------+
                                  |  authService     |
                                  |  (sessions, JWT  |
                                  |   bearers)       |
                                  +---^----------+---+
                                      |          |
                                      | session  | role lookup
                                      |          v
+------------------+    +------+   +--+-------+ |  +-------------+
|  http/middleware |--->| AUTH |-->| ctx.session| | permissions   |
+------------------+    +------+   +-----------+ | (db/repos)    |
       |                                          +-------------+
       v
+------------------+
| tierService      |---> ctx.tier, ctx.tierLimits
+------------------+
       |
       v db.repos.subscriptions

  pipeline:  bot/discord (joinVoice) ----+
                                          |
                                          v
                                 +-----------------+
                                 | bot/audio       |---reads/writes--->  audioService.userLevels
                                 |  subscribeUser  |                     audioService.userBaseline
                                 +-----------------+                     audioService.voiceProfiles
                                          |
                                          v
                                 services/tokenService.tokenFor
                                          |
                                          v
                                 routes/levels (lit userLevels)
```

`tokenService` est l'**hub central** : appelé par 13 fichiers. Toute API publique parlant d'un user passe par son token (jamais l'ID Discord en clair).

`voiceService` est le **single source of truth** pour la connexion vocale ; les exports `let` sont des live-bindings ES Modules — ne jamais déstructurer côté importeur.

## Audit du dossier

- 🔴 **`SESSION_SECRET` auto-généré** : sessions invalidées à chaque redémarrage si l'env n'est pas set (cf. authService).
- 🟠 **Mode "anonymous admin"** quand `AUTH_ENABLED=false` est dangereux en prod — devrait refuser le boot en `NODE_ENV=production`.
- 🟠 **Aucun cache de tier** : `getUserTier()` exécute 1-2 lookups SQLite par requête authentifiée + parfois un `subscriptions.expire.run()` (write).
- 🟠 **`audioService` expose des Maps mutables** sans encapsulation — facile à corrompre, difficile à tracer.
- 🟡 **Pas de cap mémoire** sur les caches `tokenService` ni `audioService` (cleanup différé seulement).
- 🟡 **`rateLimiter` single-instance** uniquement — incompatible avec un futur scale-out.

## Notes alternatives

Le dossier mélange "données pures" (`audioService`, `voiceService` data) et "logique" (`authService`, `tierService`, `rateLimiter`). Une réorganisation `state/` vs `services/` clarifierait la séparation, mais la taille actuelle ne le justifie pas.
