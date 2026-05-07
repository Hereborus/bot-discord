# `frames.js`

> Cycle de vie des frames d'avatar — upload, listing, réordo, suppression, déplacement.
> 📂 `src/routes/frames.js`
> 🔗 Module : [`routes/`](./README.md)

## Résumé

Variante "lite" des handlers de frames qui s'appuie directement sur le repo (`db/repos/users.js`) et n'utilise pas le système d'enforcement de tier. Coexiste avec [`upload.js`](./upload.js) qui fait la même chose avec deps-injection, validation magic bytes et tier limits. Soupçon de duplication : voir audit transversal du dossier.

Sécurité : `SAFE_STATE_KEY` + `SAFE_FILENAME` regex, `path.resolve` + `startsWith` comme garde, sanitisation par re-encodage `sharp` → WebP.

## Fonctions / Exports

### `handleGetFrames(req, res, ctx)` → `Promise<void>`

**Brève** : `GET /frames/:token` — liste des frames groupées par état audio.

Lit `frameRepo.byToken.all(token)`, regroupe par `state_key` → `{ silent: [{ file, url }], low: [...], ... }`. URL = `/images/<token>/<state>/<file>`.

**Améliorations possibles** :
- Pas de check token connu — un attaquant peut énumérer mais n'apprend rien (réponse `{}` uniforme)
- Pas de pagination — un user avec 1000 frames retourne tout

### `handleUpload(req, res, ctx)` → `Promise<void>`

**Brève** : `POST /upload` — upload multipart (parsing délégué à `index.js`).

**Comportement actuel** :
1. `parts = ctx._parts` injecté en amont.
2. Trouve `token`, `stateKey`, `image` dans les parts.
3. Vérifications structure (400) + regex stateKey (400).
4. `mkdirSync` du dest dir.
5. Calcule `maxOrder + 1`.
6. Nom de fichier `${Date.now()}_${basename_clean}.webp`.
7. `sharp(data).webp({ quality: 90 }).toFile(outPath)`.
8. INSERT frame + UPSERT user (`'???'` displayName si absent).
9. Retourne `{ ok, file, url }`.

**Comportement attendu (contrat)** : Sanitisation principale = re-encodage sharp (strippe EXIF/ICC, neutralise payloads). Idempotent grâce au timestamp dans le nom.

**Améliorations possibles** :
- **AUCUNE validation des magic bytes ici** (contrairement à `upload.js`). Sharp décodera correctement la plupart des images, mais une image corrompue peut throw — non catché → 500.
- **AUCUN tier enforcement** ici. Les limites max frames/states ne sont vérifiées que dans `upload.js`. Risque de bypass si cette route est exposée par erreur.
- **AUCUNE rate-limit** ici (`upload.js` a 30/min/IP).
- **AUCUNE validation taille** (le `readBody` global doit limiter mais c'est implicite).
- Pas de validation que `tokenField` est connu (pas de `isKnownToken`/`uidFor`)
- `ctx._parts` non documenté en signature TypeScript-like
- `try/catch` absent autour de `sharp(...)` → 500 mal géré sur image corrompue
- Path traversal : `tokenField` n'est PAS validé contre `SAFE_FILENAME` avant `path.join(IMAGES_DIR, tokenField, stateKey)` — risque théorique si `tokenField === '../etc/passwd'`. Mitigé en pratique par les tokens HMAC mais pas garanti.

### `handleReorder(req, res, ctx)` → `Promise<void>`

**Brève** : `POST /reorder` — réordonner les frames d'un état.

**Comportement actuel** : Tente d'utiliser une transaction via `frameRepo.updateOrder._db?.transaction` (pattern fragile — pas garanti d'exposer `_db`). Fallback sur boucle non-atomique.

**Améliorations possibles** :
- Le pattern `_db?.transaction` repose sur un détail interne de better-sqlite3 → fragile. Importer `db` directement et utiliser `db.transaction(() => { ... })`.
- Si la liste `order` contient des fichiers inexistants, le `UPDATE` ne fait rien (silencieux). Vérifier `result.changes === order.length`.
- Pas de validation que le user est propriétaire du token

### `handleDeleteFrame(req, res, ctx)` → `Promise<void>`

**Brève** : `POST /delete-frame` — supprime fichier + ligne DB.

**Comportement actuel** : Validation regex stateKey + filename, path.resolve + startsWith, `unlinkSync` try/catch silencieux, DELETE DB.

**Améliorations possibles** :
- Si `unlinkSync` fail (perm, lock Windows), DB nettoyée mais fichier orphelin → bouton "rebuild" admin nécessaire
- Idem path traversal sur `token` (cf. handleUpload)

### `handleMoveFrame(req, res, ctx)` → `Promise<void>`

**Brève** : `POST /move-frame` — déplace une frame d'un état vers un autre.

**Comportement actuel** :
1. Path resolve src + check startsWith.
2. mkdir dest.
3. `renameSync` (silent fail).
4. UPDATE state_key DB.

**Comportement attendu (contrat)** : Devrait soit mover N frames soit s'aligner sur le mode `single-frame` de `upload.js` qui supprime les frames cibles existantes.

**Améliorations possibles** :
- **Incohérence avec `upload.js#handleMoveFrame`** qui supprime les frames cibles avant de mover (single-frame mode). Ici, la frame est juste ajoutée → collision possible (le UPDATE peut violer la contrainte UNIQUE si le filename existe dans toState)
- `renameSync` silent fail → DB modifiée mais fichier resté à l'ancien emplacement → 404 sur affichage
- Pas de regex check sur `fromState` ni `toState`
- Pas de check ownership

## Dépendances

- **Importe** : `node:path`, `node:fs`, `sharp`, [`http/helpers`](../http/helpers.js), [`db/repos/users`](../db/repos/users.js) (`frames`, `users`), [`services/tokenService`](../services/tokenService.js), [`services/tierService`](../services/tierService.js)
- **Utilisé par** : ⚠️ Concurrence avec `upload.js`. Vérifier dans `index.js` lequel est wired (`router.js` ou `index.js`).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🔴 Crit | **Doublon avec `upload.js`** : deux implémentations divergentes pour les mêmes routes | Décider lequel garder, supprimer l'autre. La version `upload.js` est plus complète (tier, magic bytes, rate limit). |
| 🟠 Maj | `handleMoveFrame` peut violer UNIQUE et laisser fichier orphelin | Aligner sur la sémantique de `upload.js` ou wrapper en transaction |
| 🟠 Maj | Pas de tier enforcement → bypass possible si cette route est exposée | Ajouter `loadTier` middleware + checks limites |
| 🟠 Maj | Pas de validation magic bytes — sharp peut être trompé par une image qui décode mais contient du contenu malveillant exploitant un futur CVE de libwebp/libpng | Magic bytes en garde + sharp en re-encode |
| 🟠 Maj | Path traversal via `token` non validé (regex absente avant `path.join`) | Valider `SAFE_FILENAME` sur `tokenField` |
| 🟡 Min | `handleReorder` : transaction pattern fragile (`_db` interne) | Importer `db` et utiliser `db.transaction` |
| 🟡 Min | Pas de rate limit | Ajouter `rateLimit('upload:ip', 30, 60_000)` |
| 🟡 Min | Pas d'ownership check explicite | Vérifier `tokenFor(session.discordId) === token` |

## Notes alternatives

**Action recommandée** : ce fichier semble être une **version intermédiaire** de la migration `index.js → src/`. Si `upload.js` est la version finale wired dans `index.js`, supprimer `frames.js` (sauf `handleGetFrames` qui n'a pas d'équivalent dans `upload.js`).

Si on garde les deux, scinder les responsabilités :
- `frames.js` → uniquement `handleGetFrames` (lecture)
- `upload.js` → toutes les mutations (POST)

Cela élimine la duplication et clarifie l'intention.
