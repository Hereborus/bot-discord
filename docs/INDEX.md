# Documentation hereborus-bot

> Index maitre de toute la documentation du projet.
> Convention : chaque fichier source a une fiche MD co-localisee. Chaque dossier a un README.md.

---

## Vue d'ensemble

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — Vue d'ensemble haut niveau, stack, flux de donnees, deploiement
- **[ROADMAP.md](ROADMAP.md)** — Plan priorise des ameliorations (issues P0/P1/P2 issues)

---

## Audits

| Audit | Description |
|-------|-------------|
| [security.md](audit/security.md) | OWASP top 10 sur le backend |
| [cve.md](audit/cve.md) | CVE des dependances + analyse manuelle |
| [docker.md](audit/docker.md) | Audit Dockerfile + docker-compose + readiness prod |
| [kubernetes.md](audit/kubernetes.md) | Plan deploiement K8s + manifests recommandes |
| [frameworks.md](audit/frameworks.md) | Choix tech actuels + alternatives 2026 |
| [tests.md](audit/tests.md) | Etat tests (zero) + plan complet |

---

## Backend — `src/`

[**`src/README.md`**](../src/README.md) — Vue d'ensemble du backend modulaire.

| Sous-dossier | Role | Index |
|--------------|------|-------|
| `src/bot/` | Pipeline audio, calibration, client Discord | [README.md](../src/bot/README.md) |
| `src/db/` | SQLite database + repos | [README.md](../src/db/README.md) |
| `src/db/repos/` | Repositories (users, sessions, etc.) | [README.md](../src/db/repos/README.md) |
| `src/http/` | Mini-router, middleware, helpers, CORS | [README.md](../src/http/README.md) |
| `src/routes/` | Handlers de routes HTTP | [README.md](../src/routes/README.md) |
| `src/services/` | Services applicatifs (auth, tier, token, audio, voice, rateLimiter) | [README.md](../src/services/README.md) |

### Index par fichier backend

**`src/bot/`** : [audio.md](../src/bot/audio.md) · [calibration.md](../src/bot/calibration.md) · [discord.md](../src/bot/discord.md)

**`src/db/`** : [database.md](../src/db/database.md) · repos : [appTokens.md](../src/db/repos/appTokens.md) · [permissions.md](../src/db/repos/permissions.md) · [sessions.md](../src/db/repos/sessions.md) · [subscriptions.md](../src/db/repos/subscriptions.md) · [users.md](../src/db/repos/users.md)

**`src/http/`** : [cors.md](../src/http/cors.md) · [helpers.md](../src/http/helpers.md) · [middleware.md](../src/http/middleware.md) · [router.md](../src/http/router.md)

**`src/routes/`** : [admin.md](../src/routes/admin.md) · [auth.md](../src/routes/auth.md) · [config.md](../src/routes/config.md) · [device.md](../src/routes/device.md) · [emotion.md](../src/routes/emotion.md) · [frames.md](../src/routes/frames.md) · [levels.md](../src/routes/levels.md) · [notifications.md](../src/routes/notifications.md) · [permissions.md](../src/routes/permissions.md) · [sessions.md](../src/routes/sessions.md) · [subscriptions.md](../src/routes/subscriptions.md) · [upload.md](../src/routes/upload.md) · [voice.md](../src/routes/voice.md)

**`src/services/`** : [audioService.md](../src/services/audioService.md) · [authService.md](../src/services/authService.md) · [rateLimiter.md](../src/services/rateLimiter.md) · [tierService.md](../src/services/tierService.md) · [tokenService.md](../src/services/tokenService.md) · [voiceService.md](../src/services/voiceService.md)

---

## Racine du projet

| Fichier | Doc |
|---------|-----|
| `index.js` (orchestrateur backend) | [index.js.md](../index.js.md) |
| `viewer.html` / `viewer.js` (overlay OBS) | [viewer.html.md](../viewer.html.md) · [viewer.js.md](../viewer.js.md) |
| `script.js` *(legacy, a supprimer)* | [script.js.md](../script.js.md) |
| `index.html` *(legacy, a supprimer)* | [index.html.md](../index.html.md) |
| `styles.css` (styles partages legacy) | [styles.css.md](../styles.css.md) |
| `Dockerfile` | [Dockerfile.md](../Dockerfile.md) |
| `docker-compose.yml` | [docker-compose.yml.md](../docker-compose.yml.md) |
| `package.json` (scripts npm + deps) | [package.json.md](../package.json.md) |

**`scripts/deploy/`** : [README.md](../scripts/deploy/README.md) · [build-deploy.md](../scripts/deploy/build-deploy.md) · [config.md](../scripts/deploy/config.md)

---

## Frontend — `client/`

[**`client/README.md`**](../client/README.md) — Vue d'ensemble du frontend React + Vite.

| Sous-dossier | Role | Index |
|--------------|------|-------|
| `client/src/` | Code source React | [README.md](../client/src/README.md) |
| `client/src/context/` | Context API (etat global) | [README.md](../client/src/context/README.md) |
| `client/src/hooks/` | 5 hooks custom | [README.md](../client/src/hooks/README.md) |
| `client/src/components/` | Composants UI | [README.md](../client/src/components/README.md) |
| `client/src/components/avatars/` | UserCard + UserSettingsModal | [README.md](../client/src/components/avatars/README.md) |
| `client/src/components/layout/` | Header, TabBar, VoiceSidebar | [README.md](../client/src/components/layout/README.md) |
| `client/src/components/positioner/` | Editeur de position de frames | [README.md](../client/src/components/positioner/README.md) |
| `client/src/components/tabs/` | 9 onglets de l'app | [README.md](../client/src/components/tabs/README.md) |
| `client/src/components/ui/` | Modal, Toast, NotificationBell | [README.md](../client/src/components/ui/README.md) |

### Fichiers cles frontend

- [App.md](../client/src/App.md) — composant racine
- [main.md](../client/src/main.md) — entry point Vite
- [api.md](../client/src/api.md) — helpers fetch (apiFetch, apiJson, apiPost, apiDelete)
- [AppContext.md](../client/src/context/AppContext.md) — etat global

### Hooks

[useAudioStates.md](../client/src/hooks/useAudioStates.md) · [useNotifications.md](../client/src/hooks/useNotifications.md) · [usePollLevels.md](../client/src/hooks/usePollLevels.md) · [useToast.md](../client/src/hooks/useToast.md) · [useWebSocket.md](../client/src/hooks/useWebSocket.md)

---

## Comment naviguer

1. **Vue d'ensemble** : [ARCHITECTURE.md](ARCHITECTURE.md)
2. **Quoi faire ensuite** : [ROADMAP.md](ROADMAP.md)
3. **Comprendre une fonctionnalite** : trouver le fichier concerne (cf tableaux ci-dessus), lire son `.md`
4. **Comprendre un dossier** : lire son `README.md`
5. **Audit transversal** : [audit/](audit/)

---

*Index genere lors du gros pass d'audit de 2026-05-07.*
