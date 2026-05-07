# `cors.js`

> **CORS dynamique avec validation d'origine + headers de sécurité (HSTS, X-Content-Type-Options, etc.).**
> `src/http/cors.js`
> Module : [`http/`](./README.md)

## Résumé

Calcule `BASE_URL` (déduit dans l'ordre : `BASE_URL` env → origine de `DISCORD_REDIRECT_URI` → `localhost`). Maintient une **whitelist d'origines** et retourne le bon header `Access-Control-Allow-Origin` selon la requête. Compatible avec `credentials=true` (cookie de session) qui interdit le wildcard `*` quand un cookie est présent.

## Fonctions / Exports

### `BASE_URL` — `string`

**Brève** : URL publique du backend, calculée une fois au chargement du module.
**Contrat attendu** : sans slash final ; utilisé pour construire les URLs viewer dans `bot/discord.js`, `auth/callback`, etc.

### `getAllowedOrigins()` → `string[]`

**Brève** : Set des origines autorisées : localhost (port API), 127.0.0.1, localhost:5173 (Vite dev), `BASE_URL`, et `CORS_ORIGINS` (CSV env).
**Comportement actuel** : recalcul à chaque appel — pas de cache.
**Améliorations possibles** : memoïzer (le set ne change pas après boot).

### `corsHeaders(req)` → `Record<string,string>`

**Brève** : génère les headers CORS pour une requête donnée.
**Comportement actuel** :
- Origin présente + autorisée → `Allow-Origin: <origin>` + `Allow-Credentials: true`.
- Pas d'origin → `Allow-Origin: *` (et **suppression** de `Allow-Credentials`).
- Origin présente mais **non autorisée** → aucun header `Allow-Origin` ⇒ navigateur bloque.
**Contrat attendu** : appelé sur chaque réponse JSON / fichier statique via `helpers.json` / `serveFile`.
**Améliorations possibles** :
- Logger les origines rejetées en `debug` pour faciliter le diagnostic ("ça marche pas en prod alors qu'en dev oui").
- `Allow-Methods` est statique — `PUT`, `PATCH` non listés (le projet n'en utilise pas, mais à documenter).

### `securityHeaders(extra = {})` → `Record<string,string>`

**Brève** : `X-Content-Type-Options: nosniff`, `X-XSS-Protection`, `Referrer-Policy`, et HSTS si HTTPS.
**Comportement actuel** : merge `extra` dans la sortie ; HSTS conditionnel à `BASE_URL.startsWith('https://')`.
**Contrat attendu** : appelé partout via `helpers.json` / `serveFile`.
**Améliorations possibles** :
- Pas de **Content-Security-Policy** générale (juste sur SVG dans `helpers.serveFile`). Pour `index.html` React une CSP est utile (script-src 'self', etc.).
- `X-XSS-Protection` est **déprécié** (Chrome a supprimé la feature). À retirer.
- Pas de `X-Frame-Options` ni `frame-ancestors` — viewer.html en OBS browser source charge sans frame, mais l'embed externe est techniquement possible.

## Dépendances
- **Importe** : aucune (lecture env uniquement).
- **Utilisé par** : [`http/helpers.js`](./helpers.md), [`http/middleware.js`](./middleware.md) indirectement, `index.js` (handlers OPTIONS, websocket).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | `Allow-Origin: *` quand pas d'origin (curl, OBS) → ouvert au monde, **sans cookies**. C'est le comportement attendu pour OBS, mais à confirmer pour tous les endpoints. | Documenter explicitement la liste des endpoints "anonymes ok" et garder le wildcard ; pour les endpoints sensibles (`/auth/*`, `/api/admin/*`), refuser sans origin valide. |
| 🟡 | `X-XSS-Protection: 1; mode=block` — header **déprécié**, certains navigateurs ignorent, d'autres ouvrent des XS-Leaks. | Remplacer par CSP. |
| 🟡 | Pas de **CSP** sur les pages servies (React app, viewer.html). | Ajouter `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; ...`. |
| 🟡 | `getAllowedOrigins()` recalculé à chaque requête. | Memoïzer. |

## Notes alternatives

`Allow-Methods: 'GET, POST, DELETE, OPTIONS'` — pas de `PUT`/`PATCH`. Si une route PATCH est ajoutée plus tard, le préflight CORS bloquera silencieusement — penser à mettre à jour ici.
