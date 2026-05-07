# `rateLimiter.js`

> **Rate limiter "fixed window" en mémoire (Map<key, {count, resetAt}>).**
> `src/services/rateLimiter.js`
> Module : [`services/`](./README.md)

## Résumé

Implémentation minimale (~30 lignes) sans dépendance. Clé composite `<route>:<ip>` → seuils distincts par endpoint (upload 30/min, auth 10/min, device 5/min selon CLAUDE.md). GC toutes les 60 s. Pas de Redis — limite à un seul process.

## Fonctions / Exports

### `rateLimit(key, maxRequests, windowMs)` → `boolean`

**Brève** : `true` ⇒ requête à bloquer.
**Comportement actuel** : crée le bucket à la première requête, incrémente, retourne `count > max`.
**Contrat attendu** :
- Pré : `key` doit inclure l'IP réelle (cf. `TRUST_PROXY` env pour `X-Forwarded-For`).
- Post : pas de side effect en dehors de `buckets.set`.
**Améliorations possibles** :
- Algorithme **fixed window** : "burst at boundary" classique — un user peut faire 2× max en 1 ms à cheval sur deux fenêtres. Sliding window log ou token bucket plus équitables.
- Pas de retour `Retry-After` ni du temps restant.

## État interne

`buckets: Map<string, { count, resetAt }>` — non exporté, GC toutes les 60 s.

## Dépendances
- **Importe** : aucune.
- **Utilisé par** : `index.js` (handlers `/upload`, `/auth/login`, `/api/device/*`), potentiellement plus.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **Multi-instance** : un déploiement scale-out (HA, blue-green, K3s replicas) contournerait le rate limit en répartissant les hits. | Documenter "single-instance only" ou migrer Redis si pertinent. Pas d'alerte en interne (cf. claude.md "single container"). |
| 🟡 | Pas de **retour structurel** : impossible pour le caller de fournir `Retry-After` au client. | Retourner `{ blocked, retryAfterMs }` au lieu d'un bool. |
| 🟡 | Si `key` est mal formé (ex: IP non extraite via `TRUST_PROXY`), tous les users derrière le proxy partagent le même bucket → DoS amplifié. | Le caller (index.js) doit tester `req.socket.remoteAddress` vs `X-Forwarded-For` proprement — déjà mentionné dans CLAUDE.md. |
| 🟡 | Pas de cap sur la taille de `buckets` — DoS par flood d'IPs distinctes (une entrée/IP/route × 60 s). | Cap dur (`if buckets.size > 50_000 → ne pas créer`) + métrique. |

## Notes alternatives

Pour passer multi-instance sans Redis, une option simple : `pg`/SQLite avec un `INSERT ... ON CONFLICT (key) DO UPDATE SET count = count + 1`. Mais le projet est mono-container par design (CLAUDE.md), donc OSEF.
