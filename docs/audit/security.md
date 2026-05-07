# Audit security

> Date : 2026-05-07
> Branche : `feat/full-migration`
> Périmètre : backend Node.js (`index.js` + `src/**`), couche HTTP, OAuth2, Device Auth Flow, WebSocket, persistance SQLite et fichiers.

## Synthèse

Le projet expose un bot Discord PNGTuber + une UI React + un viewer OBS via un serveur HTTP natif (sans Express). La sécurité a été pensée en profondeur sur les axes que les attaquants visent en premier (path traversal, IDOR via tokens HMAC, image sanitisation par re-encodage sharp, double signature des cookies, hash SHA-256 des Bearer tokens, anti-CSRF OAuth2, rate limiting par IP+route). Quelques fragilités systémiques tirent le score vers le bas : sessions et rate-limit in-memory (single-instance only), secrets auto-générés persistés dans un `.env` dans `DATA_ROOT` (donc dans le volume Docker — OK, mais à surveiller), absence de CSP/COOP/COEP/Permissions-Policy, et fallback CORS `*` quand `Origin` est absent. Aucun écart critique exploitable à distance dans le chemin d'auth standard.

**Score global : 7/10** — base solide, défense en profondeur correcte, mais une dizaine de durcissements faciles restent à appliquer avant exposition publique large.

## Findings

### Critique

Aucun finding critique exploitable à distance dans le code applicatif. Les findings critiques concernent les CVE (voir [cve.md](cve.md)) — `lodash <=4.17.23` (CVE code injection via `_.template`, transitive via discord.js), `tar <=7.5.10` (path traversal, transitive via `@discordjs/opus`), `undici <6.24.0` (request smuggling + WebSocket parser overflow). Aucune n'est sur un chemin trivialement atteignable depuis l'extérieur, mais `undici` est utilisé par `discord.js` pour parler à l'API Discord et `discord.js` n'est pas isolé.

### Majeur

- **A05 — CORS fallback `*` sans Origin** — `src/http/cors.js:51-55` — Si la requête n'a pas d'en-tête `Origin` (curl, OBS source, requête mobile), le serveur répond `Access-Control-Allow-Origin: *`. Le commentaire indique « OK car credentials supprimés », ce qui est techniquement vrai pour les cookies, mais un attaquant en MITM ou un OBS browser source compromis peut profiter de cet allow-all pour exfiltrer des données via le polling `/levels`. **Reco** : retourner aucun en-tête CORS et laisser le navigateur trancher, ou exiger un header custom `X-PNGTuber-Client` côté OBS. Sévérité limitée car la majorité des routes sensibles sont derrière `requireAuth`.
- **A02 — Génération à chaud de `SESSION_SECRET` / `USER_HASH_SECRET`** — `src/services/authService.js:19`, `index.js:289-291` — Le code persiste les secrets dans `.env` au premier boot avec `crypto.randomBytes(32)`, c'est correct pour l'entropie. **Risque** : si le fichier `.env` est perdu (volume Docker recréé sans persistance), tous les tokens HMAC changent → tous les viewers/agents existants cassent silencieusement, et toutes les sessions cookies deviennent invalides. **Reco** : warn explicite au boot quand un secret est généré ; documenter le besoin de backup du fichier `.env` (déjà couvert partiellement par le volume `./data:/app/data` mais le fichier `.env` réel n'est pas garanti d'être dans `DATA_ROOT` lors d'un déploiement K8s).
- **A05 — Cookies Secure conditionnels** — `src/services/authService.js:84-85` — Le flag `Secure` n'est posé que si `BASE_URL.startsWith('https://')`. Correct en théorie mais derrière un reverse proxy qui termine TLS, `BASE_URL` doit être bien réglé sinon les cookies sont émis sans Secure et peuvent être interceptés en cas de fuite vers HTTP. **Reco** : forcer `Secure` quand `NODE_ENV=production`, indépendamment de `BASE_URL`. Ajouter `__Host-` prefix sur le cookie.
- **A07 — Sessions stockées en mémoire** — `src/services/authService.js:20` — `sessions = new Map()` : un redémarrage déconnecte tout le monde. Pas de bug de sécurité direct, mais empêche la multi-instance et favorise les contournements de revoke (on perd l'historique). **Reco** : table SQLite `sessions(id, payload_json, expires_at)`.
- **A01 — `requireClientOrAdmin` sans token dans body/URL** — `src/http/middleware.js:53-66` — Le middleware accorde l'accès aux admins systématiquement et au client uniquement s'il fournit un token correspondant à son `discordId`. **Risque résiduel** : sur les routes `POST /upload`, `POST /reorder`, etc., si `parseBodyToken` échoue à parser le body (gros multipart) ou si la route ne pose pas `_bodyToken`, le client tombe en 403 — comportement souhaité. À auditer : la chaîne `requireAuth → parseBodyToken → requireClientOrAdmin` sur `/upload` lit déjà le body multipart partiellement avant validation. **Reco** : valider l'identité avant de lire le body (auth d'abord, taille ensuite, parse multipart en dernier).
- **A09 — Logs d'erreur non structurés** — `src/routes/auth.js:145`, `src/routes/upload.js:182`, etc. — `console.error('OAuth callback error:', err)` peut afficher la stack de fetch contenant l'URL Discord (sans secret, mais avec le `code` éphémère). **Reco** : logger structuré (pino), ne jamais inclure `err` brut sans filtrer ; logger via Seq comme le reste de l'infra.

### Mineur

- **A03 — `validateUserConfig` whitelist mais pas de profondeur** — `src/routes/config.js:34-71` — La validation de `cfg.thresholds` accepte n'importe quel array sans valider chaque élément (pourrait stocker du JSON arbitraire ≤10 Mo dans `config_json`). Pas d'injection (SQLite prepared statements), mais pollution de la DB possible. **Reco** : valider chaque entrée de `thresholds` (`{ key:string, db:number }`).
- **A05 — Pas de Content-Security-Policy** — `src/http/cors.js:60-71` — `securityHeaders()` pose `X-Content-Type-Options`, `X-XSS-Protection` (deprecated), `Referrer-Policy`, optionnel `HSTS`. **Reco** : ajouter `Content-Security-Policy: default-src 'self'; img-src 'self' data: https://cdn.discordapp.com; connect-src 'self' wss:; style-src 'self' 'unsafe-inline'` (l'inline est requis par les pages standalone). Retirer `X-XSS-Protection` (obsolète, peut introduire des XSS).
- **A05 — `X-Frame-Options` absent** — Risque de clickjacking sur les pages `/api/device/verify` (qui contient des boutons « Autoriser/Refuser »). **Reco** : `X-Frame-Options: DENY` et `frame-ancestors 'none'` dans la CSP.
- **A07 — Pas de CSRF token sur les POST JSON** — Ce sont des same-site (cookie SameSite=Lax) ou Bearer, donc faible risque, mais aucune des routes n'exige de header `X-Requested-With` ou de double-submit cookie. `SameSite=Lax` sur les cookies est OK pour la plupart des cas, sauf que l'invitation publique `GET /invite/:id` peut servir de pivot. **Reco** : `SameSite=Strict` quand possible, ou Origin check sur les POST mutateurs.
- **A04 — Device Auth Flow : pas d'expiration de l'écran de verify** — `src/routes/device.js:122-197` — La page HTML inline ne vérifie pas que l'utilisateur n'a pas laissé un onglet ouvert plusieurs heures. Le `userCode` expire (5 min), mais un attaquant qui obtient l'URL `?user_code=` peut tenter de se connecter sur la session de la victime. **Reco** : afficher un timer côté client + invalider après inactivité.
- **A09 — Stack traces fuitent dans `/auth/callback`** — `src/routes/auth.js:147` — `escapeHtml(err.message)` est correct côté HTML, mais en cas d'erreur réseau Discord, le message peut contenir des détails internes (URL, timeout). **Reco** : message générique en prod, log côté serveur uniquement.
- **A08 — `sharp` reprocessing sans limites de dimensions** — `src/routes/upload.js:151` — `sharp(imgPart.data, isGif ? { animated: true } : {}).webp({ quality: 85 })` ne pose pas de `failOnError(true)` ni de limites sur `width/height`. Une « image bombe » (GIF animé 50 000 frames, ou PNG 100k×100k) peut OOM le process. **Reco** : `.resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true }).withMetadata(false)` + `sharp.cache(false)` + `sharp.concurrency(1)`.
- **A09 — `console.log` sur `Token mis à jour → redémarrage`** — `src/routes/config.js:162` — Pas de fuite directe du token, mais le contexte exact du restart est loggé. OK.
- **A10 — Pas de SSRF côté code applicatif** — Toutes les `fetch()` ciblent `discord.com` codé en dur. Pas de proxy ouvert. ✓.

## Détail OWASP

### A01 — Broken Access Control

- Middleware en chaîne : `requireAuth → loadTier → requirePremium → requireAdmin/requireClientOrAdmin`, propre.
- IDOR : userId Discord → token HMAC 16 hex via `tokenFor()`. Le mapping est calculé déterministiquement, donc deux utilisateurs avec le même `USER_HASH_SECRET` produisent toujours le même token. Le risque IDOR principal serait une collision sur les 16 hex (= 64 bits) → ~4G d'utilisateurs avant collision avec proba 50% — acceptable.
- Le token est propagé dans les URL `/images/{token}/...`, ce qui est OK car les images ne sont pas confidentielles (avatar PNGTuber public par design).
- `requireClientOrAdmin` (`src/http/middleware.js:53`) compare le token paramètre/body au `tokenFor(session.discordId)` — résiste à la falsification.
- App tokens (Bearer) plafonnés au rôle `client` même si l'utilisateur est admin — bon principe de moindre privilège.

### A02 — Cryptographic Failures

- HMAC-SHA256 partout (cookies signés, tokens user). ✓.
- `crypto.timingSafeEqual` utilisé pour la vérification de signature (`src/services/authService.js:41`). ✓.
- Bearer tokens persistés en SHA-256 dans `app_tokens.token_hash` — jamais le clair. ✓.
- `crypto.randomBytes(32)` pour secrets et tokens — entropie suffisante. ✓.
- ⚠ `SESSION_SECRET` auto-généré → persisté dans `.env` à côté du `DATA_ROOT` ; en cas de perte du fichier, déconnexion massive (incident UX, pas sécu directe).

### A03 — Injection

- SQL : `better-sqlite3` + prepared statements partout (`src/db/repos/*.js`). Aucun `db.prepare(\`... ${var}\`)` détecté. ✓.
- Command injection : `spawn(cmd, args, ...)` utilisé une seule fois pour ouvrir le navigateur (`index.js:344-360`) avec un tableau d'arguments — pas de shell. ✓.
- Prototype pollution : `JSON.parse` sur le body, `validateUserConfig` whitelist les clés — pas de `Object.assign` dangereux observé.
- HTML injection : `escapeHtml` utilisé dans les pages inline (`src/routes/device.js:145`, `src/routes/auth.js:147`). ✓.

### A04 — Insecure Design

- OAuth2 `state` 16 octets aléatoires + TTL 5 min + map cap 1000. ✓.
- Device Auth Flow conforme à RFC 8628 (deviceCode, userCode, polling, expiration). ✓.
- Rate limiter fixed window — vulnérable au burst exactement à la frontière de la fenêtre. Acceptable pour 30/min. Pour 5/min sur device authorize, un attaquant peut forcer 10 reqs en 1 seconde tous les 60s → encore acceptable (UX plus que sécu).

### A05 — Security Misconfiguration

- `AUTH_ENABLED = false` quand `DISCORD_CLIENT_ID` absent (`src/services/authService.js:23`) — toutes les routes deviennent publiques avec rôle admin (`src/http/middleware.js:25`). **Documenté** dans `index.js:1590` avec un warning console, mais facile à oublier. **Reco** : au boot, refuser `NODE_ENV=production` sans `DISCORD_CLIENT_ID`.
- `TRUST_PROXY` correctement utilisé (`index.js:148-158`) avec lecture de `X-Forwarded-For[0]`, pas de logique « si pas trust proxy alors lire direct » — le bon pattern.
- Pas de CSP, pas de COOP/COEP, `X-XSS-Protection` deprecated présent.

### A06 — Vulnerable & Outdated Components

Voir [cve.md](cve.md). 7 high (transitives), 3 moderate, 0 critical sur le backend. 3 moderate sur le client (vite/esbuild dev-only).

### A07 — Identification & Authentication Failures

- Sessions HttpOnly + signed cookie + SameSite=Lax + 7 jours d'expiration. ✓.
- Pas de mécanisme de logout multi-device (déco un seul cookie à la fois).
- Pas de rotation de session après login (acceptable, cookie réémis à chaque login car nouveau session id).
- Brute force : rate limit 30/min sur `/auth/login`, 10/min sur `/api/device/verify`. ✓.

### A08 — Software & Data Integrity

- Path traversal : double protection — regex (`SAFE_STATE_KEY`, `SAFE_FILENAME`) + `path.resolve().startsWith(IMAGES_DIR)`. ✓ (cf. `src/routes/upload.js:218-222`, `index.js:757-767`).
- Image sanitization : re-encodage sharp WebP strippe métadonnées et payloads exotiques (Polyglot PNG/SVG, EXIF). ✓.
- SVG explicitement rejeté de la whitelist — bon.
- Magic bytes vérifiés en plus du content-type. ✓.

### A09 — Security Logging & Monitoring

- `console.log/error/warn` (28 occurrences dans `src/`) — logs non structurés, pas envoyés vers Seq.
- Pas de log d'événement de sécurité (login OAuth réussi/échoué, role changes, token revoke, rate-limit triggered).
- `app_tokens.last_used_at` mis à jour à chaque requête API → bonne traçabilité, mais I/O DB sur le hot path.

### A10 — SSRF

- Aucun endpoint qui fait des requêtes HTTP à partir d'une URL utilisateur. Toutes les `fetch()` ciblent `discord.com` codé en dur. ✓.

## Vérifications spécifiques demandées

| Item | État |
|---|---|
| `.env.example` complet | ✓ — toutes les variables documentées en français |
| Variables sensibles bien notées | ✓ — `# (auto-généré)` pour secrets |
| TRUST_PROXY pour rate limiting | ✓ — `getClientIp()` dans `index.js`, `auth.js`, `device.js` (3 implémentations dupliquées 🟡 — refactor à faire) |
| Auto-gen `USER_HASH_SECRET`/`SESSION_SECRET` | ✓ 32 bytes random hex, persisté `.env` |
| Cookies Secure/HttpOnly/SameSite | ⚠ HttpOnly+SameSite=Lax ✓ ; Secure conditionnel à BASE_URL https |
| WebSocket origin check | ✓ `index.js:1614-1624` (mais court-circuité si `!AUTH_ENABLED`) |
| CORS dynamic whitelist | ✓ + fallback `*` quand pas d'Origin (🟠) |

## Plan d'action priorisé

| Priorité | Action | Effort | Impact |
|----------|--------|--------|--------|
| P0 | `npm install` pour propager les fix `undici@>=6.24.0`, `discord.js@latest`, `brace-expansion@>=1.1.13` | 30 min | -7 high CVE |
| P0 | Forcer `Secure` cookie en prod (`NODE_ENV=production`) | 10 min | XSS/MITM cookie |
| P0 | Refus de boot si `NODE_ENV=production && !DISCORD_CLIENT_ID` | 10 min | bloque déploiement non sécurisé |
| P1 | CSP + `X-Frame-Options: DENY` + retirer `X-XSS-Protection` | 30 min | clickjacking + XSS |
| P1 | `sharp.resize({ width: 4096, height: 4096, fit:'inside' })` + cap dimensions | 20 min | DoS image bomb |
| P1 | Sessions en SQLite (table `sessions`) | 2 h | multi-instance + persistance |
| P2 | Logger structuré (pino) + envoi vers Seq | 1 h | observabilité |
| P2 | Centraliser `getClientIp()` (3 copies) | 15 min | dette technique |
| P2 | Coalescer `appTokens.touch.run(hash)` (Map en mémoire, flush 60s) | 30 min | perf I/O |
| P2 | `validateUserConfig` plus strict sur `thresholds`/`emotions` | 30 min | qualité données |
| P3 | Retirer le fallback CORS `*` quand pas d'Origin | 15 min | défense en profondeur |
| P3 | CSRF double-submit sur POST JSON | 1 h | défense en profondeur |
