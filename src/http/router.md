# `router.js`

> **Mini-routeur HTTP sans dépendance : exact / segments dynamiques / wildcard suffix.**
> `src/http/router.js`
> Module : [`http/`](./README.md)

## Résumé

~50 lignes. Un tableau `routes[]` registre toutes les routes via `route(method, pattern, ...handlers)`. `matchRoute(method, pathname)` retourne `{ route, params }` ou `null`. Pas de regex compilée, pas d'arbre — itération linéaire à chaque requête.

## Fonctions / Exports

### `route(method, pattern, ...handlers)`

**Brève** : enregistre une route. `method = '*'` matche tous les verbes.
**Contrat attendu** : appelée au boot uniquement (sinon ordre indéfini).

### `matchRoute(method, pathname)` → `{ route, params } | null`

**Brève** : 3 stratégies de matching successives :
1. **Exact** (court-circuit) — `r.pattern === pathname`.
2. **Segments dynamiques** : `/frames/:token` → `params.token = 'abc123'`.
3. **Wildcard suffix** : `/images/*` → `params['*'] = 'sub/path/file.png'`.
**Comportement actuel** :
- Itère **toutes** les routes pour chaque requête (O(n) avec n = nombre de routes — petit ici, mais croissant).
- `decodeURIComponent` sur les segments dynamiques.
- Wildcard ne matche **pas** la racine `/images` sans slash, sauf si pattern est exactement `/images` après slice.
**Contrat attendu** : la première route matchant gagne ; ordre d'enregistrement = priorité.
**Améliorations possibles** :
- Pas de support **regex** ni de **multi-segment params** (`/a/:b/:c` ok, mais pas `/a/*splat/b`).
- Pas de **HEAD = GET** automatique.
- Pas de **method override** ni distinction préflight `OPTIONS` (probablement géré dans `index.js`).
- `decodeURIComponent` peut throw sur URI mal formée (`%E0%A4%A`) → caller doit `try/catch` ou middleware global.

## Dépendances
- **Importe** : aucune.
- **Utilisé par** : `index.js` (registration de toutes les routes), [`bot/calibration.js`](../bot/calibration.md) (via `registerCalibrationRoutes`), tous les modules `routes/*.js`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | `decodeURIComponent` peut throw `URIError` non catché → 500 sur URL mal-formée. | Wrap try/catch ; retourner null si decode fail. |
| 🟡 | Performance O(n × m) où m = nb de segments. Trivial pour ~50 routes mais à surveiller. | Bucketer par 1er segment (`Map<firstSeg, route[]>`). |
| 🟡 | Pas de "not allowed method" 405 — une route GET interrogée en POST renvoie 404 silencieusement. | Distinguer "no path" vs "wrong method" dans le retour. |
| 🟡 | Pas de **conflit detection** au boot : `route('GET', '/a/:x')` et `route('GET', '/a/b')` enregistrés dans le mauvais ordre rendent `/a/b` injoignable. | Un `assertNoConflict` au boot. |

## Notes alternatives

L'absence d'Express est volontaire (CLAUDE.md mentionne "native HTTP server"). Le router est lisible et hackable. Pour une migration future à Hono ou Fastify, l'API `route()` est compatible avec une réécriture sans toucher aux call sites.
