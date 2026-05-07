# `routes/`

> Handlers HTTP du serveur Node natif — un fichier par domaine fonctionnel.
> 🔗 Parent : [`src/`](../README.md)

## Vue d'ensemble

Ce dossier rassemble les handlers extraits d'`index.js` au fil de la migration progressive du monolithe vers une structure modulaire. Chaque fichier expose des fonctions `async (req, res, ctx, deps?) => void` qui sont enregistrées dans le mini-router (`src/http/router.js`) depuis `index.js`.

Deux conventions coexistent :
1. **Imports directs** (`auth.js`, `device.js`, `levels.js`, `notifications.js`, `sessions.js`, `subscriptions.js`, `emotion.js`, `calibration.js`) — les services/repos sont importés en haut du fichier.
2. **Deps-injection via 4ème argument** (`config.js`, `permissions.js`, `upload.js`, `voice.js`) — les statements et fonctions du contexte global sont passés explicitement par `index.js`.

Cette inconsistance est un legacy de la migration et un candidat à uniformiser (voir audit transversal).

## Fichiers

| Fichier | Brève | Doc complète |
|---------|-------|--------------|
| `auth.js` | OAuth2 Discord (login/callback/logout/me) + test-mode | [auth.md](./auth.md) |
| `calibration.js` | Empreintes vocales (save/delete fingerprint) | [calibration.md](./calibration.md) |
| `config.js` | Config audio user + bot token + known users | [config.md](./config.md) |
| `device.js` | Device Auth Flow RFC 8628 + app tokens CRUD | [device.md](./device.md) |
| `emotion.js` | Override émotion manuelle (priorité auto-detect) | [emotion.md](./emotion.md) |
| `levels.js` | `GET /levels` audio temps réel (cache 50ms) | [levels.md](./levels.md) |
| `notifications.js` | Lecture/marquage notifications in-app | [notifications.md](./notifications.md) |
| `permissions.js` | Rôles globaux + avatar perms par guilde + endpoints self | [permissions.md](./permissions.md) |
| `sessions.js` | Sessions PNGTuber + invitations | [sessions.md](./sessions.md) |
| `subscriptions.js` | CRUD abos + seats streamer | [subscriptions.md](./subscriptions.md) |
| `upload.js` | Frames CRUD complet (tier, magic bytes, rate limit) | [upload.md](./upload.md) |
| `voice.js` | Contrôle bot vocal (guildes, canaux, follow) | [voice.md](./voice.md) |

## Architecture interne

### Flux d'une requête

```
┌─────────────┐
│  index.js   │  ← serveur HTTP natif + WebSocket
│  (router)   │
└──────┬──────┘
       │
       ▼
┌──────────────────┐
│  Middlewares     │  requireAuth → requireAdmin / requireClientOrAdmin / loadTier
│  (services/auth) │
└──────┬───────────┘
       │
       ▼
┌──────────────────────┐
│  Handler de routes/  │  ← ce dossier
└──────┬───────────────┘
       │
       ▼
┌──────────────┐  ┌─────────────────┐
│  db/repos/   │  │  services/      │
└──────────────┘  └─────────────────┘
```

### Domaines couverts

- **Auth** : `auth.js` (OAuth navigateur), `device.js` (Bearer agent), `permissions.js` (rôles)
- **Config user** : `config.js`, `emotion.js`
- **Médias** : `frames.js`, `upload.js`
- **Collaboration** : `sessions.js`, `notifications.js`
- **Commerce** : `subscriptions.js`
- **Admin** : `admin.js`, `voice.js`, partiellement `permissions.js`
- **Hot path** : `levels.js`

### Sécurité transversale (rappel CLAUDE.md)

- HMAC tokens (`tokenFor`, `uidFor` — `services/tokenService.js`)
- Path traversal : `SAFE_STATE_KEY`, `SAFE_FILENAME` regex + `path.resolve` + `startsWith`
- Re-encode sharp → WebP (sanitisation primaire des uploads)
- Rate limit (auth, device, upload)
- Security headers + CORS validation
- App tokens limités au rôle `client`

## Audit du dossier

### Issues critiques transversales

1. **🔴 DOUBLON `frames.js` ↔ `upload.js`** — Deux implémentations divergentes pour `handleUpload`, `handleReorder`, `handleDeleteFrame`, `handleMoveFrame`. La version `upload.js` est plus complète (tier enforcement, magic bytes, rate limit). Recommandation : merger, garder `upload.js`, ne conserver de `frames.js` que `handleGetFrames`.

2. **🔴 DOUBLON `admin.js` ↔ `permissions.js`** — `handleGetPermissions`, `handleSetPermission`, `handleDeletePermission` existent dans les deux. La version `permissions.js` corrige le bug de paramètres et gère aussi avatar perms et endpoints self.

3. **🔴 `sessions.js#handleAcceptInvitation`** — Manque le check `invited_discord_id === session.discordId` pour les invitations ciblées → un user peut hijacker l'invitation d'un autre s'il en connaît l'UUID.

### Issues majeures fréquentes

- **Path traversal sur `token`** : pas de regex `SAFE_FILENAME` avant `path.join(IMAGES_DIR, token)` dans `frames.js`, `upload.js`, `admin.js`. Atténué par les tokens HMAC mais pas garanti.
- **Manque de checks ownership explicites** : `sessions.js` (création/lecture/decline d'invitations), `permissions.js` (lecture avatar perms), `frames.js` (toutes mutations) reposent uniquement sur les middlewares en amont. Risque si la chaîne change.
- **`getClientIp` dupliqué** : présent dans `auth.js` et `device.js` (et probablement ailleurs). Factoriser dans `http/helpers.js`.
- **`process.exit(0)` aveugle** dans `config.js#handleBotToken` sans drain des connexions.
- **Atomicité absente** dans `upload.js#handleUpload` (write fichier puis INSERT DB) et `handleMoveFrame` (delete puis rename).

### Patterns de validation manquants

- `discordId` jamais validé contre regex snowflake `/^\d{17,19}$/`
- `tier` non whitelisté (`subscriptions.js#handleSetSubscription`)
- `?limit` query non capé (`notifications.js`)
- `parseInt` sans check `Number.isFinite` (NaN injecté en SQL)
- `JSON.parse` direct sans try-catch sur `config_json` (corruption DB → 500)
- `displayName`, `name` (sessions), `deviceName` non longueur-bornés

### Conventions divergentes

- **Style imports** : direct vs deps-injection (cf. ci-dessus)
- **Style erreurs** : 200 + `{ found: false }` (`device.js`) vs 404 (`admin.js`)
- **Validation body** : `ctx._parsedBody || JSON.parse((await readBody(req)).toString())` répété — extraire `getJsonBody(ctx, req)` helper
- **Try-catch** : très inégal — certains handlers wrap tout, d'autres rien

### Refactos suggérés

1. **Merger `frames.js` + `upload.js`** dans un seul fichier
2. **Supprimer les handlers dupliqués** dans `admin.js`, garder uniquement les routes vraiment "DB browser admin" (`stats`, `allForAdmin`, `deleteUser`)
3. **Extraire `getClientIp`** dans `http/helpers.js`
4. **Factoriser middleware** : `requireSessionMember`, `requireSessionOwner`, `requireTokenOwner` (vérifie `tokenFor(session.discordId) === ctx.params.token`)
5. **Factoriser body parsing** : `await ctx.body()` qui gère JSON / multipart en un seul endroit
6. **Migrer la validation** vers `zod` ou `ajv` (validateUserConfig est ad-hoc, sessions et subscriptions n'ont quasi rien)
7. **Logger structuré** : remplacer `console.log` / `console.error` par un logger (pino) avec correlation ID

### Ce qui fonctionne bien

- **Tokenisation HMAC** systématique (`tokenFor` / `uidFor`)
- **Whitelist `ALLOWED_CONFIG_KEYS`** dans `config.js`
- **Re-encode sharp** comme defense-in-depth
- **Soft delete** systématique (`status='ended'`, `left_at`, `revoked_at`)
- **Rate limits** sur les endpoints sensibles (auth, device, upload)
- **Cache 50ms** dans `levels.js` (hot path)
- **Cap mémoire** sur `oauthStates` et `deviceAuthRequests` (purge périodique)
