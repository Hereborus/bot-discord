# `api.js`

> **Couche fetch centralisée** — toutes les requêtes HTTP passent par ces 5 helpers.
> 📂 `client/src/api.js`
> 🔗 Module : [`src/`](./README.md)

## Résumé

Module utilitaire critique : il décide **quelle base URL utiliser** (`getApiBase`) et offre 5 helpers de plus en plus opinionés (`apiFetch` < `apiJson` < `apiPost`/`apiDelete`). Toujours envoie `credentials: 'include'` pour propager le cookie de session OAuth Discord.

Variable de module privée `_customBase` permet à l'utilisateur d'override la base URL via le champ "BOT" du `Header` (utile pour pointer vers un backend remote en debug). Sinon, on retombe sur `window.location.origin` (production same-origin).

## Composants / Hooks exportés

### `setApiBase(url)` — fonction

**Args** :
- `url: string` — base URL custom (ou vide pour reset). Préfixe `http://` injecté si manquant.

**Brève** : mute la variable de module `_customBase`.

**Comportement** : appelée par `Header.jsx` lors du `onChange` de l'input "BOT". Pas de persistance (perdu au reload).

### `getApiBase()` → `string`

**Brève** : renvoie la base URL active (custom ou `window.location.origin`).

**Détail** : si `_customBase` est défini et ne commence pas par `http`, on préfixe `http://` (HTTPS jamais auto). Sinon `window.location.origin`.

### `apiFetch(path, options = {})` → `Promise<Response>`

**Args** :
- `path: string` — chemin relatif (ex: `/api/sessions`).
- `options: RequestInit` — fusionné avec `{ credentials: 'include' }`.

**Brève** : `fetch` avec credentials. Renvoie la `Response` brute (à l'appelant de `.json()`/`.ok`).

### `apiJson(path, options = {})` → `Promise<unknown>`

**Brève** : `apiFetch` + parse JSON + `throw` si `!res.ok`. L'erreur lancée porte `{ status, data }` annexes pour debug fin.

**Comportement** : si la réponse non-ok n'est pas du JSON, on retombe sur `{ error: res.statusText }`.

### `apiPost(path, body)` → `Promise<unknown>`

**Brève** : `apiJson` en POST avec `Content-Type: application/json` et `JSON.stringify(body)`.

### `apiDelete(path)` → `Promise<unknown>`

**Brève** : `apiJson` en DELETE.

## State & Side effects

- **State local** : `_customBase` (variable de module — singleton).
- **Context utilisé** : aucun (mais lu indirectement via Header → `apiHost`).
- **API appelée** : toutes (couche transport).
- **WebSocket** : non (mais `useWebSocket` utilise `getApiBase()`).
- **localStorage** : non.

## Dépendances

- **Importe** : rien (sauf `fetch` global et `window`).
- **Utilisé par** : quasi tous les composants/hooks (15+ fichiers).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **Mutable singleton** `_customBase` — pas testable, pas thread-safe pour plusieurs `<App>` (peu probable mais fragile). | Le placer dans `AppContext` (déjà partiellement fait avec `apiHost`) et supprimer le doublon. |
| 🟠 | **Pas de retry / timeout / abort** — un fetch peut traîner indéfiniment ; pas d'`AbortController` exposé. | Ajouter un `signal` optionnel + timeout par défaut. |
| 🟠 | **Préfixe `http://` toujours** quand l'utilisateur tape juste un host — devrait au moins essayer `https` en prod. | Heuristique : si `window.location.protocol === 'https:'`, préfixer `https`. |
| 🟡 | `apiJson` ne distingue pas les codes (401 vs 500) — l'appelant doit lire `err.status` pour discriminer. C'est OK mais peu utilisé en pratique (catch silencieux). | Documenter et créer des helpers `isAuthError(e)`. |
| 🟡 | Pas de gestion des `204 No Content` dans `apiJson` (`res.json()` throwerait). | `if (res.status === 204) return null;`. |
| 🟡 | Pas de header `Accept: application/json` — gentil pour le serveur. | Ajouter dans les options par défaut. |

## Notes alternatives

- Migration possible vers `ky`/`ofetch` si on veut retry/hooks/parsing automatique. Le code actuel est volontairement minimaliste, c'est défendable pour ce projet.
- Un wrapper `apiFetchTyped<T>` côté TS futur exposerait `T` typé via Zod ou similaire.
