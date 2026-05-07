# `http/`

> **Couche HTTP : routeur minimal, helpers réponse, middlewares auth, CORS + sécurité.**
> Parent : [`src/`](../README.md)

## Vue d'ensemble

Le projet utilise le **module `node:http` natif** (pas d'Express). Ce dossier fournit tous les utilitaires que des frameworks comme Hono/Fastify offrent normalement out-of-the-box : un router (`router.js`), des helpers `json`/`serveFile`/`readBody` (`helpers.js`), une couche CORS dynamique (`cors.js`), et trois middlewares d'auth (`middleware.js`). Tous les **handlers de routes** suivent la signature `async (req, res, ctx) => bool|void`.

## Fichiers

| Fichier | Brève | Doc complète |
|---------|-------|--------------|
| `cors.js` | CORS dynamique (whitelist d'origines, credentials-friendly) + headers de sécurité. | [cors.md](./cors.md) |
| `helpers.js` | `json()`, `serveFile()`, `readBody()`, `parseJsonBody()`, `escapeHtml()`. | [helpers.md](./helpers.md) |
| `middleware.js` | `requireAuth`, `requireAdmin`, `requireClientOrAdmin`. | [middleware.md](./middleware.md) |
| `router.js` | Mini-routeur (exact / `:param` / `*` wildcard). | [router.md](./router.md) |

## Architecture interne

```
   incoming HTTP request
            |
            v
   index.js (server.on('request'))
            |
            v
   router.matchRoute(method, pathname)
            |
            v  ctx = { url, params, session: undefined }
   chain of handlers:
     middleware.requireAuth        (ctx.session ← authService.resolveAuth)
     middleware.requireAdmin       (or requireClientOrAdmin)
     tierService.loadTier          (ctx.tier ← getUserTier)
     route-specific handler        (handler logic, calls helpers.json/serveFile)
            |
            v  every response goes through:
     helpers.json/serveFile  →  res.writeHead(...,
                                  cors.corsHeaders(req),
                                  cors.securityHeaders())
```

**Convention middleware** : retour `true` ⇒ continuer ; `false` ⇒ réponse déjà envoyée, abort. Cas exceptionnel : `tierService.requirePremium` retourne `false` **sans** envoyer de réponse — le caller doit le faire (incohérence à corriger).

## Audit du dossier

- 🔴 **`AUTH_ENABLED=false` en prod** = session anonyme avec rôle admin (cf. `middleware.requireAuth`). Garde-fou indispensable.
- 🟠 **Pas de path-traversal protection** dans `helpers.serveFile` — caller responsable. À doc explicitement.
- 🟠 **`Content-Security-Policy` absente** sur les pages servies (React app, viewer.html). `X-XSS-Protection` est déprécié.
- 🟡 **`router.matchRoute`** ne fait pas de `try/catch` autour de `decodeURIComponent` ⇒ 500 sur URI mal-formée.
- 🟡 **Pas de logger structuré** : tout sort sur `console.log/error`. Absence de corrélation request-id.
- 🟡 **Pas de timeout/keep-alive tuning** dans le module — laissé aux defaults Node.

## Notes alternatives

Une migration vers **Hono** (compatible `node:http` via `@hono/node-server`) éliminerait `router.js`, `helpers.js`, et la moitié des middlewares avec une compatibilité quasi-1:1. À garder en tête si le projet grandit.
