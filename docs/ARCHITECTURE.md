# Architecture hereborus-bot

> Vue d'ensemble haut niveau. Pour les details, voir les fiches MD par fichier (cf [INDEX.md](INDEX.md)).

---

## Stack

| Couche | Tech | Version |
|--------|------|---------|
| Runtime | Node.js | 22+ (Alpine en prod) |
| Backend | ES Modules natifs | — |
| HTTP | Serveur natif (pas Express) | — |
| Base de donnees | better-sqlite3 (SQLite synchrone) | 11.x |
| Bot Discord | discord.js + @discordjs/voice + @discordjs/opus + prism-media + sodium-native + @snazzah/davey | 14.25 / 0.19 / 0.10 / 1.3 / 4.3 / 0.1 |
| Audio FFT | fft-js *(abandonware, a remplacer)* | 0.0.12 |
| Image processing | sharp | 0.33 |
| WebSocket | ws | 8.x |
| Frontend | React + Vite | 18.3 / 5.4 |
| Deploiement | Docker (multi-stage Alpine) | — |

---

## Decoupage du projet

```
hereborus-bot/
├── index.js                  # Orchestrateur backend (~1936 lignes, en cours d'allegement)
├── viewer.html / viewer.js   # Overlay OBS standalone (HTML inline, pas migre React)
├── client/                   # App React (panneau de controle)
│   └── src/
│       ├── App.jsx           # Composant racine
│       ├── api.js            # Helpers fetch
│       ├── context/          # AppContext (etat global)
│       ├── hooks/            # 5 hooks custom
│       └── components/
│           ├── avatars/      # UserCard, UserSettingsModal
│           ├── layout/       # Header, TabBar, VoiceSidebar
│           ├── positioner/   # Editeur position frames
│           ├── tabs/         # 9 onglets de l'app
│           └── ui/           # Modal, Toast, NotificationBell
├── src/                      # Backend modulaire (migration ~70%)
│   ├── bot/                  # Pipeline audio + client Discord + calibration
│   ├── db/                   # SQLite + repos
│   ├── http/                 # Mini-router + middleware + helpers + CORS
│   ├── routes/               # Handlers de routes (61 / 89 routes migrees)
│   └── services/             # Auth, tier, token, audio, voice, rateLimiter
├── scripts/deploy/           # build-deploy.sh + config.sh
├── docs/                     # Documentation (cet index)
├── data/                     # Runtime (SQLite + voice state) — gitignored
├── images/                   # Frames PNG uploadees — gitignored
├── meta/                     # JSON par utilisateur — gitignored
└── dist/                     # Build React — gitignored
```

---

## Flux de donnees principal

```
                    ┌───────────────────────┐
                    │   Discord voice       │
                    │   channel             │
                    └──────────┬────────────┘
                               │ Opus stream per user
                               ▼
                    ┌───────────────────────┐
                    │ src/bot/audio.js      │
                    │ - Decode Opus → PCM   │
                    │ - FFT 1024 pts        │
                    │ - 3 bandes freq       │
                    │ - Profil vocal passif │
                    │ - Empreintes match    │
                    └──────────┬────────────┘
                               │
                               ▼
                    ┌───────────────────────┐
                    │ src/services/         │
                    │ audioService.js       │
                    │ Maps : userLevels,    │
                    │ emotionState,         │
                    │ voiceProfiles         │
                    └──────────┬────────────┘
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
       ┌────────────────┐          ┌────────────────────┐
       │ HTTP /levels   │          │ WebSocket /ws      │
       │ (polling)      │          │ (broadcast 20fps)  │
       └────────┬───────┘          └─────────┬──────────┘
                │                            │
                ▼                            ▼
       ┌────────────────┐          ┌────────────────────┐
       │ React panel    │          │ viewer.html (OBS)  │
       │ AvatarsTab     │          │ flipbook avatars   │
       │ (client/)      │          │                    │
       └────────────────┘          └────────────────────┘
```

---

## Authentification

Trois schemas coexistent :

1. **OAuth2 Discord** (panneau web)
   - Routes `/auth/login`, `/auth/callback`, `/auth/logout`, `/auth/me`
   - Sessions in-memory avec cookies signes (HMAC-SHA256)
   - Roles : `admin` (via `ADMIN_DISCORD_ID`) et `client`
   - **⚠️ Bug critique** : si `DISCORD_CLIENT_ID` absent, tout user est admin par defaut → fixe en P0 dans cette PR

2. **Device Auth Flow** (mini-app)
   - `/api/device/authorize` → device_code + user_code
   - User valide via panneau web (`/api/device/verify`)
   - Polling de l'app : `/api/device/poll` → Bearer token
   - Tokens stockes en SHA-256 hash dans la DB
   - Limite au role `client` (jamais admin)

3. **Tokens utilisateur HMAC** (anti-leak Discord ID)
   - Chaque `discord_id` → token hex 16 chars (HMAC-SHA256)
   - Jamais expose : tous les endpoints utilisent `:token` (jamais `:discordId`)
   - Maps : `tokenToUid`, `uidToToken`

---

## Modele de donnees

SQLite dans `data/pngtuber.db`. Tables :

| Table | Role |
|-------|------|
| `users` | discord_id, hash, display_name, last_seen |
| `frames` | hash, state, filename, order |
| `permissions` | discord_id, role (admin/client) |
| `avatar_permissions` | guild_id, allowed |
| `subscriptions` | discord_id, tier (free/premium/streamer), expires_at, seats |
| `subscription_seats` | subscription_id, seat_discord_id |
| `pngtuber_sessions` | id, owner, type (voice/standalone), started_at, ended_at |
| `session_participants` | session_id, discord_id, joined_at, left_at |
| `invitations` | id (UUID), session_id, owner, invited_id (nullable), max_uses, used_count |
| `app_tokens` | hash, discord_id, last_used_at |
| `notifications` | discord_id, type, payload, read_at |

Persistance complementaire :
- `images/<hash>/<state>/<frame>.webp` — frames re-encodees par sharp
- `meta/<hash>.json` — ordering frames
- `meta/<hash>_config.json` — config audio (thresholds, display name, timing)
- `meta/permissions.json` — backup roles (legacy, migre en DB)

---

## Securite (etat post-PR)

✅ **Garanties** :
- HMAC-SHA256 tokens : Discord IDs jamais exposes via HTTP
- Sharp re-encode : strip metadata + neutralise payloads
- Path traversal : `SAFE_FILENAME` regex + `path.resolve()` + `startsWith()`
- Prepared statements partout (SQL injection impossible)
- CSRF : OAuth state + cookies SameSite=Lax
- Rate limiting : 30/min upload, 10/min auth, 5/min device
- Cookies signes (HMAC-SHA256), constant-time compare
- Image MIME validation (PNG/WebP only)
- Body size limit 10 MB
- CORS dynamique (whitelist d'origines)

🔒 **Fixes appliques dans cette PR** :
- ✅ Auth bypass : require `AUTH_ENABLED` pour tout endpoint admin
- ✅ SESSION_SECRET : persiste sur disque, plus de resets de sessions au restart
- ✅ Invitation hijack : verif `invited_discord_id === ctx.session.discordId`
- ✅ CORS no-origin : retourne pas de header (au lieu de `*`)
- ✅ Cookies Secure : detection TLS via reverse proxy headers
- ✅ Token validation : `SAFE_FILENAME` check avant operations fichier
- ✅ Doublons routes resolus

---

## Deploiement

**Docker** (mode actuel) : multi-stage Alpine, image finale ~550 MB.

**Etapes** :
1. Stage 1 : build React (Vite) → `/app/dist/`
2. Stage 2 : install backend (modules C++ : better-sqlite3, sharp, opus, sodium)
3. Stage 3 : runtime minimal (libstdc++, vips, tini)

**Volumes persistants** : `./data` (SQLite) + `./images/` (frames) + `./meta/` (configs)

**Variables d'environnement** (cf [`.env.example`](../.env.example)) :
- `DISCORD_TOKEN` (requis)
- `ADMIN_DISCORD_ID`
- `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_REDIRECT_URI`
- `BASE_URL`, `LEVELS_PORT`, `DATA_ROOT`
- `USER_HASH_SECRET`, `SESSION_SECRET` (auto-generes/persiste)
- `CORS_ORIGINS`, `TRUST_PROXY`

**Reverse proxy** : Pangolin + Traefik (ou Cloudflare Tunnel). Necessite `TRUST_PROXY=true` pour rate limiting correct.

**Kubernetes** : pas ready en l'etat. Cf [audit kubernetes.md](audit/kubernetes.md) pour le plan.

---

## Modules stateful (in-memory)

Le projet a plusieurs etats partages en memoire qui ne survivent pas au restart :

| Module | Etat | Survie restart |
|--------|------|----------------|
| `audioService` | userLevels, emotionState, voiceProfiles | ❌ recalcule au tick suivant |
| `tokenService` | tokenToUid, uidToToken | ✅ fallback DB |
| `rateLimiter` | buckets | ❌ reset les compteurs |
| `authService` | sessions, oauthStates | ❌ users deconnectes |
| `index.js` | viewerSessions, deviceAuthRequests | ❌ |

Pour scaling horizontal : externaliser sessions vers Redis. Cf [kubernetes.md](audit/kubernetes.md).

---

## Composants externes

- **Discord API** (Gateway + REST) — bot login, voice, guilds, members
- **DAVE protocol E2EE** (`@snazzah/davey`) — Discord Audio/Video End-to-end
- **OAuth2 Discord** — login web

---

## Resume des observations transversales

🟢 **Forces** :
- Architecture modulaire bien decoupee (services / repos / routes / http)
- Securite bien pensee (HMAC, sharp, prepared, rate limit)
- Migration React + Vite + ES Modules en cours, structure saine

🟡 **A consolider** :
- Migration backend incomplete (~70%, 28 routes encore inline dans `index.js`)
- Doublons resolus dans cette PR (frames/upload, admin/permissions)
- Aucun logger structure (console.log/error partout)
- Aucun test, aucun lint (introduits dans cette PR)
- Frontend : pas de memoization, polling 10x/s sans backoff, inline styles

🔴 **A traiter** :
- `fft-js` abandonware (audio hot path) — remplacement vers `webfft` propose mais non fait dans cette PR (besoin tests audio reels)
- 7 CVE high transitives (undici/lodash/tar) — fix via `overrides` dans cette PR
- Etats stateful in-memory : pas de persistance restart (resilience faible)
- Pas de migrations DB versionnees (CREATE IF NOT EXISTS uniquement) — runner introduit dans cette PR

---

*Architecture documentee 2026-05-07.*
