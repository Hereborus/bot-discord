# `helpers.js`

> **Utilitaires HTTP partagés : json/serveFile/readBody/parseJsonBody/escapeHtml.**
> `src/http/helpers.js`
> Module : [`http/`](./README.md)

## Résumé

Couche fine au-dessus de `http.IncomingMessage` / `ServerResponse`. Garantit que toutes les réponses JSON et fichiers passent par les mêmes headers CORS + sécurité, et qu'aucun corps de requête ne dépasse `MAX_BODY_SIZE` (10 MB).

## Fonctions / Exports

### `MIME` — `Record<extension, contentType>`

**Brève** : table extension → MIME. Couvre 10 formats courants.

### `MAX_BODY_SIZE` — `10 * 1024 * 1024`

**Brève** : limite par défaut de `readBody` ; surchargeable par appel.

### `json(res, data, status = 200, req = null)`

**Brève** : `res.writeHead(status, ...corsHeaders(req), ...securityHeaders())` + `JSON.stringify(data)`.
**Contrat attendu** : appelé après que tous les middlewares ont validé la requête. **Ne pas appeler deux fois** — `writeHead` lance.
**Améliorations possibles** : pas de gestion `JSON.stringify` qui throw (ex: cycles dans `data`) — un cycle plante silencieusement la requête.

### `serveFile(res, filePath, req = null)` → `boolean`

**Brève** : sert un fichier statique avec MIME + cache appropriés. Retourne `false` si fichier absent (le caller doit envoyer 404).
**Comportement actuel** :
- HTML/CSS → `Cache-Control: no-cache, no-store, must-revalidate` (rafraîchissement immédiat).
- SVG → `Content-Security-Policy` restrictive + `Content-Disposition: inline` pour atténuer le risque d'XSS via SVG.
- Autres → pas de header de cache (laissé à la couche reverse proxy).
**Améliorations possibles** :
- Pas de **path traversal protection** ici — le caller doit `path.resolve()` + `startsWith()` avant. Documenter explicitement.
- Pas de support `Range` (pas critique pour des PNG WebP).
- Pas de `ETag`/`Last-Modified` → re-fetch complet à chaque requête.
- `fs.existsSync` + `statSync` + `createReadStream` = **3 syscalls** sur le hot-path de `/levels` ou `/images/*`. Acceptable mais pas optimal.

### `readBody(req, maxSize = MAX_BODY_SIZE)` → `Promise<Buffer>`

**Brève** : accumule les chunks ; **détruit la connexion** dès que la limite est dépassée.
**Comportement actuel** : `req.destroy()` + reject avec `Error('Corps trop volumineux')`.
**Contrat attendu** : caller doit `try/catch` et retourner 413 ou similaire.
**Améliorations possibles** :
- Le caller ne sait pas si l'erreur vient du dépassement de taille ou d'une autre I/O. Discriminer via `err.code = 'BODY_TOO_LARGE'`.

### `parseJsonBody(req)` → `Promise<any>`

**Brève** : `readBody` puis `JSON.parse`.
**Comportement actuel** : pas de `try/catch` — `JSON.parse` throw, le caller doit `try/catch`.
**Améliorations possibles** :
- Réponse `400 Invalid JSON` pourrait être faite ici via une variante `parseJsonBodyOr400(req, res)`.

### `escapeHtml(str)` → `string`

**Brève** : remplace `& < > "` par leurs entités HTML.
**Contrat attendu** : utilisé dans les **templates HTML inline** (probablement la page de Device Auth Flow).
**Améliorations possibles** : ne couvre pas `'` ni les contextes attribut sans guillemets — OK tant qu'on reste dans des contextes texte/attribut quoté.

## Dépendances
- **Importe** : `node:fs`, `node:path`, [`http/cors.js`](./cors.md).
- **Utilisé par** : tout le code HTTP (middlewares, routes, index.js).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | `serveFile` ne fait **aucune vérification** de path traversal — `filePath` est consommé tel quel. Si un caller passe `req.url` sans sanitization, **lecture arbitraire** du FS. | Documenter en JSDoc ; vérifier que tous les call sites ont `path.resolve()` + check. |
| 🟠 | `JSON.stringify` peut throw sur des cycles → exception non catch dans `json()` ⇒ requête hang. | `try/catch` autour de `JSON.stringify`, fallback `'{"error":"serialization"}'`. |
| 🟡 | Pas de `Content-Security-Policy` sur HTML servi — couvert dans `cors.js` mais ce serait plus naturel ici. | À discuter au niveau du dossier. |
| 🟡 | `readBody` n'enregistre pas la taille reçue dans `req` — log d'analytique impossible sans monkey-patching. | Optionnel. |
| 🟡 | Pas de support multipart/form-data — l'upload doit utiliser `formidable` ou similaire ailleurs (à vérifier dans `routes/upload.js`). | Note pour le maintainer. |

## Notes alternatives

L'écriture **stream** via `pipe(res)` est correcte pour les fichiers ; aucune mise en buffer mémoire complète. Bien.
