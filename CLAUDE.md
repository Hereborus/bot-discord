# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Discord PNGTuber bot with a local web UI and OBS viewer. The bot joins a voice channel, analyzes audio per-user (RMS, dB, FFT frequency bands), and exposes data via HTTP so web frontends can animate PNG avatars based on speaking levels and detected emotion.

**Language:** JavaScript (ES Modules, no TypeScript). **Runtime:** Node.js 18+. **Deployment:** Docker (docker-compose).

## Commands

```bash
# Développement
npm run dev:api                    # Démarrer le backend (node index.js)
npm run dev:ui                     # Démarrer Vite dev server (port 5173)
cd client && npm install           # Installer les dépendances frontend

# Build production
npm run build:ui                   # Build React → dist/
npm start                          # Run the bot locally (node index.js)

# Docker
docker compose build               # Build Docker image (inclut npm run build)
docker compose up -d               # Start in background
docker compose down                # Stop
docker compose logs -f             # Follow logs
node --check index.js              # Syntax check backend
```

There are no lint or test scripts configured. Validation is manual (`node --check`).

## Frontend — React (Vite)

The control panel has been fully migrated to a React app in `client/`. The legacy `index.html` has been removed. Build React → `dist/` is functional and served by the backend.

**Structure `client/src/` :**
- `api.js` — fetch centralisé (`apiFetch`, `apiJson`, `apiPost`, `apiDelete`)
- `context/AppContext.jsx` — état global (auth, audioConfig, configData, levels)
- `hooks/` — `usePollLevels`, `useWebSocket`, `useToast`, `useNotifications`, `useAudioStates`
- `components/layout/` — `Header`, `VoiceSidebar`, `TabBar`
- `components/ui/` — `Toast`, `Modal`, `NotificationBell`
- `components/tabs/` — un fichier par onglet (`AvatarsTab`, `AudioTab`, `SessionsTab`…)
- `components/avatars/` — `UserCard`, `UserSettingsModal`

**En développement :** Vite (port 5173) proxie les requêtes API vers le backend (port 3350).
**En production :** `npm run build:ui` génère `dist/`. Le backend Node sert `dist/index.html` pour `/` et les assets Vite depuis `dist/assets/`.

`viewer.html` et `positioner.html` restent des fichiers HTML standalone (non migrés — usage OBS).

## Architecture

### Backend — `index.js` + modules `src/`

`index.js` (~3650 lignes, réduit depuis ~4374) importe désormais les modules de `src/` pour les sous-systèmes extraits. La logique restante dans `index.js` couvre : le bot Discord, le pipeline audio complet, le Device Auth Flow, le WebSocket, les routes auth OAuth2, et le serveur HTTP principal.

**Modules `src/` actifs (wired dans index.js) :**
- `src/services/` — rateLimiter, tokenService, tierService, authService, audioService (état partagé), voiceService
- `src/db/database.js` — initialisation SQLite + schéma
- `src/db/repos/` — users, permissions, subscriptions, sessions, appTokens
- `src/http/` — cors, helpers, router, middleware
- `src/routes/` — levels, frames, notifications, subscriptions, sessions, admin

**Key subsystems:**
- **Mini-router** with middleware pattern. Routes registered via `route(method, pattern, ...handlers)`. Handlers have signature `async function(req, res, ctx)` where `ctx = { url, params, session }`.
- **Native HTTP server** (no Express) on port `LEVELS_PORT` (default 3000). Dynamic CORS based on origin (configurable via `CORS_ORIGINS` env).
- **Discord OAuth2 authentication.** Protected routes use `requireAuth` middleware. Auth is optional — disabled when `DISCORD_CLIENT_ID` is not set. Sessions stored in memory with signed cookies.
- **Role-based permissions.** Two roles: `admin` (full access, set via `ADMIN_DISCORD_ID`) and `client` (can only edit own data). Permissions stored in `meta/permissions.json`. Middleware chain: `requireAuth` → `requireAdmin` or `requireClientOrAdmin`.
- **Subscription/tier system.** Three tiers: `free` (limited states/frames, no emotions), `premium` (all features), `streamer` (premium for N seats). `getUserTier()` checks subscriptions → seats → free. Middlewares: `loadTier`, `requirePremium`. Enforcement in upload (state/frame limits) and config (premium keys stripped for free).
- **Device Auth Flow.** Mini-app authentication via device code + user code → Bearer token. App tokens stored as SHA-256 hashes, limited to `client` role (no admin access via token). Endpoints: `/api/device/authorize`, `/api/device/poll`, `/api/device/verify`.
- **Sessions.** Collaborative PNGTuber sessions (`voice` or `standalone`). Auto-created on voice join, manual for mini-app. Participants tracked in DB. Owner can end, participants can leave.
- **Invitations.** Targeted (by discordId) or open (link-based with maxUses). Create → notification → accept/decline. Self-invite and double-participate prevented.
- **Notifications.** DB-stored + real-time WebSocket broadcast. Types: invitation, member_joined, session_started. Auto-cleanup > 30 days.
- **Discord bot** using discord.js v14 + @discordjs/voice. Text commands: `!join`, `!disconnect`, `!status`. Voice can also be controlled via the web API (`/api/voice/join`, `/api/voice/disconnect`).
- **Audio pipeline:** Opus → PCM (prism-media) → RMS/dB → FFT (fft-js, 1024-point at 48kHz) → three frequency bands (low/mid/high) → sliding window smoothing. Results stored in `userLevels` Map.
- **Token system:** Discord user IDs are never exposed over HTTP. Each userId is HMAC-SHA256 hashed into a 16-char hex token. Maps: `tokenToUid`, `uidToToken`.
- **Viewer sessions:** Temporary session IDs that resolve to a user token, allowing secure viewer URLs without exposing the token directly. Expire after 24h.

**Route categories:**
- Public (no auth): `/levels`, `/status`, `/bot-info`, `/images/*`, `/frames/:token`, `/user-config/:token` (GET), `/known-users`, `/api/viewer-session/:sessionId` (GET), `/api/device/authorize` (POST), `/api/device/poll` (POST), `/api/invitations/:id` (GET), `/invite/:id` (GET)
- Protected (client-or-admin): `/upload`, `/reorder`, `/delete-frame`, `/user-config/:token` (POST), `/api/viewer-session` (POST)
- Admin only: `/bot-token`, `/delete-user/:token`, `/api/permissions` (GET/POST), `/api/permissions/:discordId` (DELETE), `/api/guilds/:guildId/members`, `/api/voice/join`, `/api/voice/disconnect`, `/api/voice/follow`, `/api/voice/unfollow`, `/api/auto-reconnect`, `/api/subscription` (POST/DELETE)
- Auth (any logged in): `/api/permissions/me`, `/api/my-token`, `/api/voice/status`, `/api/device/verify`, `/api/app-tokens`, `/api/sessions`, `/api/invitations` (POST/accept/decline/DELETE), `/api/my-invitations`, `/api/notifications`, `/api/subscription` (GET), `/api/subscription/seats`
- Auth flow: `/auth/login`, `/auth/callback`, `/auth/logout`, `/auth/me`

**Data storage:** Controlled by `DATA_ROOT` env var (default: project root, Docker: `/app/data`).
- `images/<hash>/<state>/` — uploaded PNG frames per audio state
- `meta/<hash>.json` — frame ordering
- `meta/<hash>_config.json` — user audio config (thresholds, display name, timing)
- `meta/permissions.json` — role assignments (discordId → role)
- SQLite DB (`data/pngtuber.db`): users, frames, subscriptions, subscription_seats, pngtuber_sessions, session_participants, invitations, app_tokens, notifications

### Frontend — React app + standalone HTML pages

**React app (panneau de contrôle) :** `client/` → buildé en `dist/`. Le backend sert `dist/index.html` pour `/` et les assets depuis `dist/assets/`. Les fichiers legacy (`index.html`, `script.js`, `viewer.js`, `positioner.js`) ont été supprimés lors de la migration.

**Pages HTML standalone (non migrées — usage OBS) :**
- **`viewer.html`** — OBS browser source. Uses WebSocket (fallback: HTTP poll), renders flipbook animation with auto-blink. Emotion detection handled server-side with hysteresis. Query params: `?t=token&poll=100&size=200px&debug=0`.
- **`positioner.html`** — Frame position editor. Canvas-based drag + sliders, persists to localStorage, notifies viewer via BroadcastChannel.

## Environment Variables

See `.env.example` for full reference. Key variables:
- `DISCORD_TOKEN` — Bot token (required)
- `ADMIN_DISCORD_ID` — Discord ID of the admin user
- `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` — OAuth2 credentials (optional, enables auth)
- `DISCORD_REDIRECT_URI` — OAuth2 callback URL (default: `{BASE_URL}/auth/callback`)
- `BASE_URL` — Public URL behind reverse proxy (e.g. `https://bot.example.com`). Auto-detected from `DISCORD_REDIRECT_URI` if not set, falls back to `http://localhost:PORT`
- `USER_HASH_SECRET` — HMAC secret (auto-generated)
- `SESSION_SECRET` — Cookie signing secret (auto-generated)
- `LEVELS_PORT` — HTTP port (default 3000)
- `DATA_ROOT` — Data directory (default: project root, Docker: `/app/data`)
- `CORS_ORIGINS` — Additional allowed CORS origins (comma-separated)
- `PNGTUBER_NO_BROWSER` — Set to `1` to disable auto-opening browser on startup
- `TRUST_PROXY` — Set to `true` behind a reverse proxy to trust `X-Forwarded-For` for rate limiting

## Docker

Single container runs both the Discord bot and HTTP server. Data persisted via volume mount at `./data`.

```bash
cp .env.example .env   # Edit with your tokens
docker compose up -d
```

## Windows Standalone Build

A standalone Windows executable (`dist/pngtuber-bot.exe`) and self-contained installer (`dist/PNGTuberBot-Setup.exe`) can be built via PowerShell scripts in `scripts/`. The installer bundles the exe, Node runtime, and a setup script so users don't need Docker or Node installed. Build scripts: `build-installer.ps1`, `build-installer-simple.ps1`, `build-installer-standalone.ps1`.

## Code Conventions

- Functional style, no classes. Promise-based async/await.
- Frontend: React 18 + Vite (no direct DOM manipulation). Legacy standalone pages (viewer, positioner) still use inline JS.
- Comments and documentation are in **French**.
- Security: path traversal prevention via `SAFE_STATE_KEY`/`SAFE_FILENAME` regex + `path.resolve()` + `startsWith()`, SVG rejection, one-way user ID hashing, body size limits (10 MB), config validation via `ALLOWED_CONFIG_KEYS` whitelist, rate limiting (upload 30/min, auth 10/min, device 5/min), security headers (X-Content-Type-Options, HSTS, Referrer-Policy), CORS origin validation, WebSocket origin check, `TRUST_PROXY` for safe IP extraction, app tokens limited to client role.
- **Image sanitisation:** All uploads are re-encoded through `sharp` to WebP (stripping metadata and neutralising malicious payloads). This reprocessing *is* the primary sanitisation step — magic byte checks are a secondary guard.

## Additional Reference

`README.md` contains bilingual (EN/FR) documentation covering architecture, API reference, OBS setup, and deployment.
