# `index.js`

> **Une ligne** : Orchestrateur principal du backend — bootstrap du serveur HTTP/WebSocket, du bot Discord et de la pipeline audio, branchant les modules `src/` aux 90+ routes du PNGTuber Bot.
> 📂 `index.js`

## Résumé

Point d'entrée unique de l'application Node.js. **1936 lignes** (et NON 3650 comme indiqué par le commentaire en tête et CLAUDE.md — la migration vers `src/` a déjà bien réduit le fichier mais la documentation n'a pas suivi).

Responsabilités encore présentes dans `index.js` :
1. **Bootstrap & init** : chargement `.env` (auto-génération secrets), création des dossiers de données, migration JSON→SQLite.
2. **Aliases `stmts.*`** : couche de compatibilité entre l'ancien code statements-based et les repos modulaires (`src/db/repos/*`).
3. **Wiring de tous les handlers extraits** : injection des dépendances dans des wrappers `_handleXxx`.
4. **Handlers encore inline** : sessions PNGTuber, invitations, notifications, subscriptions, viewer-sessions, page invite HTML, debug-log, db-browser, delete-user, levels, status, bot-info, frames, images.
5. **Mini-router** : enregistrement de **89 routes** via `route()`.
6. **Serveur HTTP natif** : SPA fallback React (`dist/`), assets Vite, fichiers statiques (`viewer.html`, `styles.css`), auth gating sur les pages protégées.
7. **WebSocket server** : 20fps broadcast des niveaux audio + notifications + auth via app token.
8. **Connexion vocale Discord** : `connectToVoiceChannel()`, `disconnectVoice()`, `subscribeUser` wrapper.
9. **Shutdown propre** : SIGINT/SIGTERM, fermeture DB et serveur HTTP.

## Sections par numéro de ligne

### `L1-47` — En-tête de doc inline
**Brève** : commentaire explicatif des endpoints et du système de tokens opaques.
**Audit** : 🟡 Liste partielle/obsolète des endpoints (29 endpoints documentés sur ~89 routes réelles). Risque de désynchronisation avec le code.

### `L49-122` — Imports
**Brève** : imports Node natifs + tous les modules `src/`.
**Comportement actuel** : un import par module — tous les services, repos, routes, helpers du dossier `src/` sont chargés ici.
**Améliorations possibles** :
- Le fichier importe encore quelques helpers utilisés UNE SEULE fois ailleurs (ex: `parseCookies`, `setSessionCookie`, `oauthStates`) → potentielle élimination.
- `verifyCookie` est défini en local (L437) mais aurait dû migrer dans `authService.js`.

### `L124-167` — Constantes & init filesystem
**Brève** : `SOURCE_ROOT`, `STATIC_ROOT`, `DATA_ROOT`, regex `SAFE_STATE_KEY` / `SAFE_FILENAME`, `TRUST_PROXY`, création des dossiers.
**Audit** : 🟢 Bonne hygiène sécurité (regex stricts + `path.resolve`).

### `L168-246` — Aliases `stmts` (compat layer)
**Brève** : Map d'objets statements compilés (better-sqlite3) vers les méthodes des repos modulaires.
**Comportement actuel** : duplication massive — 60+ aliases qui pointent vers des `repos.xxx.method` ou des `db.prepare(...)` inline.
**Audit** : 🟠 **Forte dette technique** — chaque handler appelle `stmts.foo.run()` mais les repos exposent déjà `usersRepo.foo()`. Cette couche d'indirection devrait disparaître après migration complète des handlers vers les repos directs.
**Améliorations possibles** :
- Faire migrer chaque handler restant à utiliser directement le repo.
- Supprimer `stmts` une fois tous les usages éliminés.

### `L248-298` — Gestion `.env`
**Brève** : `readEnvFile`, `writeEnvFile`, `ensureEnvKey`, `setEnvKey`, auto-création du `.env` avec secrets random.
**Comportement attendu** : auto-bootstrapping pour les secrets HMAC + session.
**Audit** : 🟢 Idempotent. 🟡 `setEnvKey` non utilisé hors `_handleBotToken`.

### `L300-330` — Tokens & viewer-sessions
**Brève** : `isKnownToken`, `stateDirByToken`, persistance des viewer-sessions sur disque.
**Audit** : 🟡 Les viewer-sessions devraient être en DB ou Redis pour multi-instance — actuellement Map en mémoire + JSON sur disque.

### `L331-400` — État global & helpers
**Brève** : `botConnected`, `currentConnection`, `connectedGuildId`, `tokenRejected`, `httpServer`, `getClientIp`, `openDefaultBrowser`, `stateDir`, `readCfg`, `writeCfg`, `getFramesByToken`.
**Audit** : 🟠 État global mutable étalé sur tout le fichier — `connectedGuildId`, `currentConnection`, `followTarget`, `botConnected` sont accédés par les handlers via `getVoiceDeps()` mais aussi en lecture/écriture directe → risque d'incohérence.

### `L408-460` — Validation & body parsing helpers
**Brève** : `verifyCookie` (réimpl locale), `parseBodyToken` (middleware extracteur de `token` du body JSON).
**Audit** : 🟠 `verifyCookie` duplique la logique d'`authService.js` — devrait être exporté depuis le service.

### `L462-600` — Migration JSON → SQLite + WebP
**Brève** : `migrateExistingData()` (permissions, configs users, frames), `convertExistingImagesToWebP()`.
**Comportement actuel** : exécuté une seule fois au démarrage, renomme `.json` → `.json.migrated`.
**Audit** : 🟡 Code de migration "one-shot" qui pollue le bootstrap — devrait être déplacé dans un script `scripts/migrate.js` à exécuter manuellement et idempotent.

### `L602-650` — Shutdown & disconnect
**Brève** : `disconnectVoice`, `shutdownApp` (graceful avec timeout 2s).
**Audit** : 🟢 Correct.

### `L652-826` — Handlers route inline
**Brève** : `handleLevels` (cache 50ms), `handleStatus`, `handleBotInfo`, `handleFrames`, `handleImages`, `handleDbStats`, `handleDbFrames`, `handleDeleteUser`, `smoothAndClassifyState`.
**Comportement actuel** : ces handlers manipulent directement `userLevels`, `userBaseline`, `manualEmotion`, `getVoiceStats` → forte intrication avec l'état global.
**Améliorations possibles** :
- Migrer `handleLevels` + `handleStatus` + `handleBotInfo` dans `src/routes/levels.js` (déjà existant).
- Migrer `handleDeleteUser` dans `src/routes/admin.js` ou `src/routes/upload.js`.
- Migrer `handleImages` dans un `src/routes/static.js`.

### `L828-947` — Wrappers d'injection de deps
**Brève** : Définition de `_handleXxx` qui injectent l'objet de dépendances dans les handlers extraits + `getVoiceDeps`, `broadcastFollowStatus/Error`, `setFollowTarget`.
**Audit** : 🟠 50+ wrappers boilerplate — symptôme d'une DI manuelle. **Améliorations possibles** :
- Définir un `Container` global (objet partagé) que les modules importent directement.
- Ou utiliser un mini DI (awilix, tsyringe simulé en JS).

### `L949-985` — Viewer sessions handlers
**Brève** : `handleCreateViewerSession`, `handleResolveViewerSession`.
**Audit** : 🟡 Code aussi dupliqué dans le handler resolveViewerSession qui ne valide pas le format de `sessionId` (path traversal mitigé seulement par la Map lookup).

### `L987-1063` — Sessions PNGTuber inline
**Brève** : `handleCreateSession`, `handleListSessions`, `handleGetPSession`, `handleEndSession`, `handleLeaveSession`, `handleSessionParticipants`.
**Audit** : 🟠 **Devrait migrer dans `src/routes/sessions.js`** (le module existe mais ces handlers n'y sont pas encore).

### `L1064-1176` — Invitations inline
**Brève** : 6 handlers d'invitation (create, get, accept, decline, revoke, list).
**Audit** : 🟠 Devrait migrer dans `src/routes/sessions.js` ou nouveau `src/routes/invitations.js`.

### `L1178-1215` — Notifications inline
**Brève** : `wsNotifClients` Map + `broadcastNotification` + 3 handlers HTTP.
**Audit** : 🟠 Devrait migrer dans `src/routes/notifications.js` (le module existe).

### `L1217-1276` — Subscriptions inline
**Brève** : 6 handlers subscription (get, set, cancel, addSeat, removeSeat, listSeats).
**Audit** : 🟠 Devrait migrer dans `src/routes/subscriptions.js` (le module existe).

### `L1278-1344` — Page Invite HTML inline
**Brève** : `handleInvitePage` retourne une page HTML statique avec JS inline (~50 lignes).
**Audit** : 🟠 HTML/CSS/JS inline dans une string template — devrait être un fichier statique servi depuis `views/` ou un composant React. La gestion CSP est cassée car le `<script>` inline ne pourrait pas passer une CSP stricte.

### `L1346-1387` — Wrappers config/permissions/upload/emotion
**Brève** : Wrappers d'injection pour les handlers extraits dans `src/routes/`.
**Audit** : 🟡 Structure répétitive — voir audit des wrappers ci-dessus.

### `L1389-1513` — Enregistrement des routes
**Brève** : 89 appels à `route(method, path, ...handlers)` qui composent middlewares + handler.
**Comportement actuel** : Toutes les routes sont déclarées ici (et non dans leurs modules respectifs). C'est l'unique source de vérité pour l'API.
**Audit** : 🟢 Ordre logique (auth → publiques → protégées → admin). 🟡 La route `/api/debug-log` (ligne 1409) a un handler inline anonyme qui pollue le registre.

### `L1515-1601` — HTTP Server
**Brève** : `httpServer = http.createServer(...)` avec routing manuel + servir static + SPA fallback React.
**Comportement actuel** : Utilise `matchRoute()` puis cascade :
1. Routes enregistrées
2. CORS preflight
3. Auth gating sur `AUTH_PAGES` (`/`, `/index.html`)
4. Assets Vite (`/assets/*`)
5. Fichiers physiques depuis `STATIC_ROOT`
6. SPA fallback (`dist/index.html`)
**Audit** :
- 🟠 **PIÈGE LEGACY** : si `dist/` n'existe pas (dev hors Vite) ET que `index.html` racine existe encore, le serveur servirait le LEGACY `index.html` (4804 lignes). En Docker ce risque est éliminé (le Dockerfile ne copie pas `index.html`), mais en dev local hors Docker → risque réel.
- 🟡 `AUTH_PAGES = ['/index.html', '/']` autorise toujours le legacy si présent (c'est même la cible de la redirection après login).

### `L1603-1684` — WebSocket server
**Brève** : `WebSocketServer` sur le même httpServer (path `/ws`), gère messages `subscribe`, `auth`, `set-emotion`, `debug-log`.
**Audit** :
- 🟠 Auth WS via app token : duplique partiellement la logique de `parseCookies`/`getSession` qui est utilisée seulement pour l'origin check WS — incohérent.
- 🟢 Origin check sur connexion (WS hijacking mitigé).

### `L1686-1773` — Broadcast loop & helpers
**Brève** : `setInterval(50ms, ...)` qui broadcast tous les niveaux audio. `broadcastConfigUpdate`, `broadcastFrameUpdate`.
**Audit** :
- 🔴 **Duplication massive avec handleLevels (L661-711)** : les 30 lignes de transformation `userLevels → JSON` sont copiées-collées entre `handleLevels` et le broadcast WS. Tout changement de format DOIT être fait deux fois.

### `L1775-1788` — Compat tokenToUid/uidToToken
**Brève** : Faux Map qui délègue à `tokenFor`/`uidFor` du tokenService.
**Audit** : 🟡 Compat layer — les usages devraient appeler directement `tokenFor`/`uidFor`.

### `L1790-1929` — Discord client + bot init
**Brève** : `_subscribeUser` wrapper + `connectToVoiceChannel` (logique join principale, ~80 lignes) + `initBot()` (depuis `src/bot/discord.js`).
**Audit** :
- 🟠 `connectToVoiceChannel` (L1817) devrait migrer dans `src/bot/discord.js` ou `src/bot/voice.js`.

### `L1931-1936` — SIGINT/SIGTERM
**Brève** : Hooks shutdown.

## Routes encore inline vs déjà extraites

**Routes définies AVEC handlers inline dans index.js (28) :**
- `/levels`, `/status`, `/bot-info`, `/frames/:token`, `/images/*`
- `/api/debug-log`, `/api/db/stats`, `/api/db/frames`
- `/api/viewer-session`, `/api/viewer-session/:sessionId`
- `/delete-user/:token`
- `/api/sessions` x6 (CRUD sessions)
- `/api/invitations` x6 (CRUD invitations)
- `/api/notifications` x3
- `/api/subscription` x6
- `/invite/:invitationId`

**Routes déléguées à `src/routes/*.js` (61) :**
- `auth.js`, `voice.js`, `device.js`, `config.js`, `permissions.js`, `upload.js`, `emotion.js`, `calibration.js`

## Dépendances
- **Importe** : 24 modules de `src/`, plus `discord.js`, `@discordjs/voice`, `dotenv`, `ws`, `sharp`, `http`, `fs`, `path`, `crypto`, `child_process`.
- **Utilisé par** : point d'entrée — invoqué par `npm start` et le `CMD` du Dockerfile.

## Audit global

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🔴 | **Documentation périmée** : commentaire ligne 47 et CLAUDE.md affirment "~3650 lignes" alors que le fichier fait 1936 lignes | Mettre à jour CLAUDE.md ET supprimer le commentaire trompeur |
| 🔴 | **Duplication** broadcast loop (L1690-1747) ↔ handleLevels (L661-711) — 30 lignes de transformation `userLevels` copiées | Extraire `serializeLevels(userLevels)` dans `src/services/audioService.js` ou `src/routes/levels.js` |
| 🟠 | **6 sous-systèmes encore inline** dans index.js (sessions, invitations, notifications, subscriptions, viewer-sessions, delete-user) alors que les modules `src/routes/sessions.js`, `subscriptions.js`, `notifications.js`, `admin.js` existent | Finaliser la migration |
| 🟠 | **Compat layer `stmts`** (L175-246) — 60+ aliases vers les repos | Migrer chaque handler vers les repos directs puis supprimer `stmts` |
| 🟠 | **`connectToVoiceChannel`** (L1817-1896) reste dans index.js | Migrer dans `src/bot/discord.js` |
| 🟠 | **HTML inline** dans `handleInvitePage` (L1281) | Extraire en fichier `views/invite.html` ou composant React |
| 🟠 | **State global mutable** (`botConnected`, `currentConnection`, `followTarget`, `connectedGuildId`) accédé via getters et muté en interne | Extraire dans un `src/state/runtime.js` central |
| 🟠 | **Risque legacy** : si `dist/` absent ET `index.html` racine présent → le serveur sert le legacy en dev local hors Docker | Supprimer `index.html`, `script.js` à la racine |
| 🟡 | `verifyCookie` réimplémenté localement (L437) | Exporter depuis `authService.js` |
| 🟡 | Migration JSON→SQLite (L462-600) au bootstrap → ralentit le démarrage à chaque restart | Déplacer dans `scripts/migrate.js` idempotent à exécuter manuellement |
| 🟡 | Handler anonyme inline pour `/api/debug-log` (L1409) | Définir comme `handleDebugLog` |
| 🟡 | Le commentaire d'en-tête (L1-47) liste 29 endpoints sur 89 — désynchronisé | Régénérer ou supprimer (la doc OpenAPI/README est mieux placée) |

## État de la migration backend

- **Migration vers `src/`** : ~70% extrait (61 routes / 89), 28 routes encore inline.
- **Modules vides** : `src/routes/sessions.js`, `src/routes/subscriptions.js`, `src/routes/notifications.js`, `src/routes/admin.js`, `src/routes/levels.js`, `src/routes/frames.js` existent dans le dossier MAIS les handlers correspondants restent dans index.js → contradiction structurelle.

## Notes alternatives

Splitting recommandé :
1. **Extraire les 6 sous-systèmes restants** (sessions/invitations/notifications/subscriptions/viewer-sessions/levels) → cibler `index.js` < 800 lignes.
2. **Centraliser l'état runtime** dans `src/state/runtime.js` — éliminer les `getXxxDeps()` boilerplate.
3. **Bootstrap dans `src/bootstrap.js`** : init `.env`, migration, init bot, init httpServer → `index.js` devient un simple `import './src/bootstrap.js'`.
