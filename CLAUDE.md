# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Discord PNGTuber bot with a local web UI and OBS viewer. The bot joins a voice channel, analyzes audio per-user (RMS, dB, FFT frequency bands), and exposes data via HTTP so web frontends can animate PNG avatars based on speaking levels and detected emotion.

**Language:** JavaScript (ES Modules, no TypeScript). **Runtime:** Node.js 18+. **Deployment:** Docker (docker-compose).

## Commands

```bash
npm start                          # Run the bot locally (node index.js)
docker compose build               # Build Docker image
docker compose up -d               # Start in background
docker compose down                # Stop
docker compose logs -f             # Follow logs
node --check index.js              # Syntax check (no test suite exists)
```

There are no lint or test scripts configured. Validation is manual (`node --check`).

## Architecture

### Backend — `index.js` (single file)

All server logic lives in one file: Discord bot, HTTP server, audio pipeline, auth, file management, permissions.

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

### Frontend — Three standalone HTML pages with inline `<script>`

All pages embed their JavaScript inline. Legacy external `.js` files have been removed.

- **`index.html`** — Unified control panel (admin + client). Role-based visibility: admin sees all tabs, client sees only their own avatar. Frame upload/reorder/delete, audio config, voice channel control, fingerprint recording, viewer URL generator. New tabs: Sessions (create/invite/end), Subscriptions (tier info, admin management, streamer seats), App Tokens (list/revoke), Notification bell with real-time dropdown.
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

## Code Conventions

- Functional style, no classes. Promise-based async/await.
- Direct DOM manipulation on frontend (no framework).
- Comments and documentation are in **French**.
- Security: path traversal prevention via `SAFE_STATE_KEY`/`SAFE_FILENAME` regex + `path.resolve()` + `startsWith()`, magic byte validation on uploads, SVG rejection, one-way user ID hashing, body size limits (10 MB), config validation via `ALLOWED_CONFIG_KEYS` whitelist, rate limiting (upload 30/min, auth 10/min, device 5/min), security headers (X-Content-Type-Options, HSTS, Referrer-Policy), CORS origin validation, WebSocket origin check, `TRUST_PROXY` for safe IP extraction, app tokens limited to client role.

## Additional Reference

`README.md` contains bilingual (EN/FR) documentation covering architecture, API reference, OBS setup, and deployment.
