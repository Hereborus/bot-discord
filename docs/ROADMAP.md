# Roadmap hereborus-bot

> Plan priorise des ameliorations issu de l'audit complet du 2026-05-07.
> Mise a jour au fil de la PR `release/v2-with-fixes`.
>
> **📋 Pour le plan detaille et actionnable des items ⏳ ci-dessous (avec localisation exacte, plan etape par etape, code snippets et estimations), voir [REMAINING-WORK.md](REMAINING-WORK.md).**

Legende : ✅ fait dans cette PR · 🚧 partiel · ⏳ a faire · ⏭️ defere

---

## P0 — Critique securite (cette PR)

| Issue | Localisation | Statut |
|-------|--------------|--------|
| Auth bypass : `DISCORD_CLIENT_ID` absent → role admin par defaut | `src/http/middleware.js:requireAuth`, `src/services/authService.js` | ✅ |
| `SESSION_SECRET` auto-genere a chaque restart → toutes sessions invalidees | `src/services/authService.js` | ✅ |
| Invitation hijack : pas de verif `invited_discord_id === session.discordId` | `src/routes/sessions.js#handleAcceptInvitation` | ✅ |
| Doublon `frames.js` ↔ `upload.js` (frames.js sans tier/magic/rate limit) | `src/routes/frames.js` vs `src/routes/upload.js` | ✅ |
| Doublon `admin.js` ↔ `permissions.js` (bug + duplicate) | `src/routes/admin.js` vs `src/routes/permissions.js` | ✅ |
| `viewer.js` `effectiveKey` ReferenceError → viewer cassé en prod | `viewer.js:652-657` | ✅ |
| CORS fallback `*` quand pas de header Origin | `src/http/cors.js:51-55` | ✅ |
| Cookies `Secure` conditionnels au scheme `BASE_URL` (pas TLS reel) | `src/services/authService.js:84` | ✅ |
| Path traversal sur `token` (manque validation `SAFE_FILENAME`) | `src/routes/frames.js`, `upload.js`, `admin.js#handleDeleteUser` | ✅ |
| Legacy `index.html` servi en priorite sur React si present | `index.js:1573-1577` + presence du fichier | ✅ |
| Legacy `script.js` orphelin | racine | ✅ |

---

## P1 — Hardening + qualite (cette PR)

| Issue | Localisation | Statut |
|-------|--------------|--------|
| Docker tourne en root, pas de HEALTHCHECK, pas de tini, `npm install` au lieu de `npm ci` | `Dockerfile` | ✅ |
| `bot/calibration.js` mal place : expose des routes HTTP | `src/bot/calibration.js` | ✅ |
| Pas de migrations DB versionnees (`CREATE IF NOT EXISTS` ne gere pas l'evolution) | `src/db/database.js` | ✅ |
| `build-deploy.sh` `git add -A` peut commiter `.env` | `scripts/deploy/build-deploy.sh:125` | ✅ |
| 7 CVE high transitives : undici, lodash, tar | deps via discord.js + chains | ✅ (overrides) |
| `audioService` Maps mutables exportees → couplage fort | `src/services/audioService.js` | ⏳ |
| `bot/audio.js:subscribeUser` pas de cleanup retourne | `src/bot/audio.js` | ⏳ |
| `tierService.getUserTier` pas de cache + ecriture DB par requete | `src/services/tierService.js` | ⏳ |
| `requirePremium` ne retourne pas 403 (handler hang) | `src/services/tierService.js` | ⏳ |
| Aucun logger structure (console.log/error) | partout | ⏳ |
| Migration `index.js` → `src/` incomplete (28 routes inline) | `index.js` | ⏳ |
| Compat layer `stmts` (60+ aliases dans `index.js`) | `index.js:175-246` | ⏳ |
| Duplication userLevels → JSON entre `handleLevels` et WS broadcast | `index.js:1690-1747` ↔ `661-711` | ⏳ |

---

## P1 — Frontend perf (cette PR)

| Issue | Localisation | Statut |
|-------|--------------|--------|
| `AppContext` value non memoizee → tous consommateurs re-render 10x/s | `client/src/context/AppContext.jsx` | ✅ |
| `usePollLevels` polling 10x/s sans pause sur tab cache, sans backoff | `client/src/hooks/usePollLevels.js` | ✅ |
| `UserCard` canvas re-init a chaque tick (pas de React.memo) | `client/src/components/avatars/UserCard.jsx` | ✅ |
| `PositionerApp` melange mutations DOM directes et React renders | `client/src/components/positioner/PositionerApp.jsx` | ⏳ |
| `AvatarsTab` `dangerouslySetInnerHTML` (piege futur si dynamique) | `client/src/components/tabs/AvatarsTab.jsx` | ⏳ |
| Inline styles partout (~80% du visuel) | tous composants | ⏳ |
| `try { ... } catch {}` silencieux partout (errors swallow) | partout | ⏳ |
| Aucun `React.memo`, aucun `ErrorBoundary`, code mort dans 6+ fichiers | partout | ⏳ |
| `TIER_COLORS` duplique entre `Header.jsx` et `SubscriptionsTab.jsx` | client/src/components/ | ⏳ |

---

## P2 — Tooling + tests (cette PR)

| Item | Statut |
|------|--------|
| Setup ESLint + Prettier (config + scripts npm) | ✅ |
| Setup Vitest + premiers tests P0 (tokenService) | ✅ |
| Smoke test bash script (verif demarrage + endpoints critiques) | ✅ |
| Tests routes upload (path traversal, MIME, tier enforcement) | ⏳ |
| Tests middleware (`requireAuth`, `requireAdmin`, `loadTier`) | ⏳ |
| Tests repos DB (queries, transactions) | ⏳ |
| Tests pipeline audio (FFT, smoothing, formants) | ⏳ |
| Tests frontend (Testing Library) | ⏳ |
| Tests E2E (Playwright) | ⏳ |
| Coverage cible 70% backend, 90% crypto/auth | ⏳ |

---

## P2 — Frameworks & deps (defere)

| Item | Statut | Pourquoi defere |
|------|--------|-----------------|
| `fft-js@0.0.12` → `webfft@1.0.3` | ⏭️ | Audio hot path, besoin de tests reels avant swap |
| Routeur frontend `wouter@3.9` (remplace `IS_POSITIONER`) | ⏭️ | Bonus, fragile mais marche |
| Migration React 19 (concurrent features) | ⏭️ | Nice-to-have, attendre stabilisation API |
| Vite 6 | ⏭️ | Mineur, pas urgent |
| ESLint v10 / Prettier v3.8 | ✅ | inclus |
| TypeScript via JSDoc (sans TS) | ⏭️ | Effort important, contre-courant convention projet |
| `uWebSockets.js` (vs `ws`) | ⏭️ | Gain perf 10x mais necessaire seulement a forte charge |

---

## P3 — Scaling future (post-PR)

Pour passer de mono-instance a multi-replica :

| Item | Effort estime |
|------|---------------|
| SQLite → Postgres (migration schema + driver) | 1-2 jours wall-clock |
| Sessions in-memory → Redis | ~4h |
| RateLimiter in-memory → Redis | ~2h |
| Image storage : filesystem → S3/MinIO | ~6h |
| Pipeline audio : worker thread vs main thread | ~6h |
| Logger structure : pino + pretty pour dev | ~3h |
| Metrics Prometheus (request count, audio drops) | ~3h |
| Helm chart + manifests K8s mono-replica StatefulSet | ~3h (cf [kubernetes.md](audit/kubernetes.md)) |

---

## Notes par audit

- **Securite** : score 7/10. Top risques resolus dans cette PR. Cf [audit/security.md](audit/security.md).
- **CVE** : 7 high (transitives), tous fixables via `overrides`. Cf [audit/cve.md](audit/cve.md).
- **Docker** : prod-ready apres cette PR (USER + HEALTHCHECK + tini + npm ci). Cf [audit/docker.md](audit/docker.md).
- **K8s** : non ready. Plan complet dans [audit/kubernetes.md](audit/kubernetes.md).
- **Frameworks** : score 7/10. Stack saine, swaps proposes. Cf [audit/frameworks.md](audit/frameworks.md).
- **Tests** : score initial 0/10 → ~3/10 apres cette PR (setup + premiers tests). Cf [audit/tests.md](audit/tests.md).

---

## Etat de la migration `index.js` → `src/`

Apres cette PR :
- 70% des routes extraites (61 / 89)
- 28 routes encore inline dans `index.js` (~1900 lignes restantes)
- Compat layer `stmts` (60+ aliases) toujours present
- A finir : sessions, invitations, notifications, subscriptions, viewer-sessions, levels/status/bot-info → migration P1 future

---

*Roadmap maintenue au fil des PRs. Date de generation : 2026-05-07.*
