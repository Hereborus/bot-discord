# `src/` — Backend Hereborus Bot

> **Index racine du backend Node.js (ES Modules) — bot Discord PNGTuber + serveur HTTP natif.**

## Vue d'ensemble

Le backend est articulé autour d'un **`index.js` orchestrateur** (~3650 lignes) qui boot le serveur HTTP natif, le bot Discord, et wire les modules de `src/`. Cette passe documente **5 sous-dossiers du backend** ; les routes (`src/routes/`) ne sont pas couvertes ici (elles forment leur propre passe documentaire).

**Conventions** :
- ES Modules (`"type": "module"` dans `package.json`).
- Style fonctionnel, pas de classes ; async/await.
- Pas d'Express ni de framework — `node:http` natif + mini-router.
- Commentaires et identifiants en **français**.
- Sécurité : path-traversal regex, SVG rejection, body limit 10 MB, rate limiting, CORS whitelist.
- SQLite single-file (`pngtuber.db`) en mode WAL.

## Sous-dossiers

| Dossier | Rôle | Doc |
|---------|------|-----|
| [`bot/`](./bot/README.md) | Client Discord + pipeline audio DSP + (anomalie) routes calibration. | [bot/README.md](./bot/README.md) |
| [`db/`](./db/README.md) | Init SQLite + repositories préparés. | [db/README.md](./db/README.md) |
| [`http/`](./http/README.md) | Mini-router, helpers, middlewares auth, CORS. | [http/README.md](./http/README.md) |
| `routes/` | Handlers HTTP par domaine (admin, auth, config, device, emotion, frames, levels, notifications, permissions, sessions, subscriptions, upload, voice). *(non documenté ici)* | — |
| [`services/`](./services/README.md) | État partagé (audio, voice), auth, rate limit, tier, tokens. | [services/README.md](./services/README.md) |

## Flux principaux

### Pipeline audio (Discord → HTTP)

```
Discord voice ──opus──> bot/discord.js (initBot)
                              │
                              ├── connectToVoiceChannel (injected)
                              │            │
                              │            v
                              │      VoiceReceiver
                              │            │
                              ▼            ▼
                      services/voiceService     bot/audio.js (subscribeUser)
                      (state singleton)              │
                                                     │ 50ms tick
                                                     ▼
                                          services/audioService.userLevels.set
                                                     │
                                       ┌─────────────┴──────────────┐
                                       ▼                            ▼
                              routes/levels (HTTP poll)      WebSocket broadcast (index.js)
                                                                     │
                                                                     ▼
                                                              viewer.html (OBS)
```

### Authentification

```
HTTP request ──> http/middleware.requireAuth
                     │
                     ├── header Authorization: Bearer ...
                     │       │
                     │       ▼
                     │   services/authService.resolveAuth (Bearer)
                     │       │
                     │       ▼
                     │   db/repos/appTokens (SHA-256 lookup) ──> ctx.session
                     │
                     └── cookie pngtuber_session=...
                             │
                             ▼
                         services/authService.getSession
                             │
                             ▼
                         in-memory Map ──> ctx.session

ctx.session ──> http/middleware.requireAdmin / requireClientOrAdmin
            ──> services/tierService.loadTier (ctx.tier, ctx.tierLimits)
            ──> route handler
```

### Tokenisation

Tous les userId Discord sont convertis en **token HMAC-SHA256-16hex** via [`services/tokenService`](./services/tokenService.md). Aucun ID Discord ne sort en clair dans les URLs ou les réponses HTTP.

## Modules **stateful** (état mémoire qui survit entre requêtes)

| Module | État partagé | Persisté ? |
|--------|--------------|------------|
| `audioService` | `userLevels`, `userBaseline`, `voiceProfiles`, `voiceStatsCache`, `userFreqHistory` | Baseline + voiceProfile flush DB toutes les 60 s |
| `voiceService` | `botConnected`, `currentConnection`, `connectedGuildId`, `connectedChannelId`, `followTarget`, `followError` | `voice-state.json` (sous-ensemble) |
| `authService` | `sessions`, `oauthStates` | **Non persisté** — perdu au redémarrage |
| `tokenService` | `tokenToUid`, `uidToToken` | **Non persisté** — re-rempli au fil des connexions vocales + fallback DB |
| `rateLimiter` | `buckets` | Non persisté |
| `bot/audio` | `emotionState`, `fingerprintCache`, buffers LPC partagés | Non persisté |

## Couplage et duplications

- **`audioService.userLevels`** est lu/écrit depuis 4+ endroits sans encapsulation — risque d'invariant cassé.
- **`bot/calibration.js`** expose des routes HTTP : devrait vivre dans `src/routes/calibration.js`.
- **`registerCalibrationRoutes`** est exporté mais semble ne pas être appelé depuis `index.js` (à vérifier — peut-être routes mortes).
- Les **stmts préparées** sont passées en `deps` partout (pattern d'injection lourd) plutôt qu'importées via `db/repos`. À harmoniser.
- `index.js` toujours ~3650 lignes — la migration vers `src/` a réduit ~700 lignes mais reste l'orchestrateur monolithique.

## Audit transverse

| Sévérité | Issue | Fichier(s) | Recommandation |
|----------|-------|-----------|----------------|
| 🔴 | `AUTH_ENABLED=false` ⇒ session anonyme avec rôle admin | `http/middleware.js`, `services/authService.js` | Refuser le boot si `NODE_ENV=production` et auth disabled. |
| 🔴 | `SESSION_SECRET` auto-généré si non set ⇒ sessions invalidées à chaque redémarrage | `services/authService.js` | Persister sur disque comme fallback ou logger ERROR au boot. |
| 🟠 | Pas de système de migrations DB versionné | `db/database.js` | Table `schema_migrations` + script `applyMigrations()`. |
| 🟠 | Caches mémoire **non bornés** (`tokenToUid`, `voiceProfiles`, `userLevels`, `emotionState`) | `services/tokenService.js`, `services/audioService.js`, `bot/audio.js` | LRU cap + GC périodique scanning age. |
| 🟠 | `subscribeUser` ne retourne pas de `cleanup()` | `bot/audio.js` | Retourner `() => cleanup()` pour permettre annulation explicite. |
| 🟠 | `tierService.requirePremium` retourne false sans envoyer 403 | `services/tierService.js` | Harmoniser avec les autres middlewares. |
| 🟡 | `rateLimiter` single-instance ; pas de Redis | `services/rateLimiter.js` | Documenter ou ajouter backend Redis. |
| 🟡 | `serveFile` sans path-traversal protection (caller responsible) | `http/helpers.js` | Doc explicite. |
| 🟡 | `console.log/error` partout, pas de logger structuré | toutes | Pino + request-id. |

## Pour aller plus loin

- Code source `index.js` (~3650 lignes) : encore l'orchestrateur principal pour OAuth callbacks, WebSocket server, Device Auth Flow, et toutes les routes non extraites.
- `client/` : app React + Vite, hors scope de cette passe.
- `viewer.html`, `positioner.html` : pages OBS standalone, hors scope.
- `CLAUDE.md` racine : doc d'ensemble du projet (variables d'env, architecture, conventions).
