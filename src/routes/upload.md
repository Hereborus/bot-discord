# `upload.js`

> Upload + cycle de vie complet des frames (version "production" avec tier + magic bytes + rate limit).
> 📂 `src/routes/upload.js`
> 🔗 Module : [`routes/`](./README.md)

## Résumé

Implémentation complète de l'upload d'image avec defense-in-depth :
1. **Rate limiting** par IP (30/min)
2. **Validation magic bytes** (PNG/JPG/GIF/WebP — pas de SVG)
3. **Cap taille** 10 Mo (et 50 Mo en lecture body)
4. **Tier enforcement** (max états ouverts/fermés, max frames par état)
5. **Sanitisation primaire** par re-encode `sharp` → WebP
6. **Path traversal protection** (`SAFE_STATE_KEY`, `SAFE_FILENAME`, `path.resolve` + `startsWith`)

Concurrence avec [`frames.js`](./frames.md) qui implémente partiellement les mêmes routes — voir audit transversal du dossier.

## Fonctions / Exports

### `validateMagicBytes(buffer, ext)` → `boolean`

**Brève** : Vérifie que les premiers octets du buffer correspondent à l'extension.

**Comportement actuel** :
- PNG : `89 50 4E 47 0D 0A 1A 0A`
- JPG/JPEG : `FF D8 FF`
- GIF : `GIF87a` ou `GIF89a`
- WebP : `RIFF` + `WEBP` à offset 8

Strict (returns false si extension non listée). Ne couvre pas BMP, TIFF, etc.

**Comportement attendu (contrat)** : Garde **secondaire** — la sanitisation principale est `sharp`. Cette fonction empêche un attaquant de passer une charge utile en .png renommé .gif.

**Améliorations possibles** :
- Pas de vérif `RIFF` chunk size pour WebP (un fichier RIFF non-WEBP avec WEBP à offset 8 par hasard passerait — exotique)

### `parseMultipart(body, boundary)` → `Part[]`

**Brève** : Parser multipart/form-data minimal sans dépendance externe.

Fait du `Buffer.indexOf` manuel pour éviter un cast `toString()` (préserver les bytes binaires de l'image). Suffisant pour `token + stateKey + image`.

**Comportement attendu (contrat)** : Tolère un boundary final (`--boundary--`) et break correctement. **N'enforce pas de limite par part** — un attaquant peut envoyer un body de 50 Mo avec une part `name=token` de 49 Mo.

**Améliorations possibles** :
- Pas de limite par part individuelle — un champ `token` énorme passerait
- `headers.match(/name="([^"]+)"/)` ne supporte pas les noms de champ avec `"` (rare)
- Lib mature (`busboy`) gérerait streaming → utile si les uploads grandissent

### `indexOf(buf, search, start)` → `number`

Helper interne — réimplémentation de `Buffer.indexOf`. Native version existe et est plus rapide.

**Améliorations possibles** :
- Remplacer par `body.indexOf(search, start)` (Buffer natif, beaucoup plus rapide en O optimisé V8)

### `handleUpload(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `POST /upload` — pipeline complet.

**Comportement actuel** :
1. Rate limit 30/min/IP, 429 sur dépassement.
2. `readBody(req, 50 * 1024 * 1024)` — lit jusqu'à 50 Mo.
3. Parse multipart, extrait `token`, `stateKey`, image.
4. Valide token connu (mémoire ou DB).
5. Valide `SAFE_STATE_KEY`.
6. Cap 10 Mo sur l'image elle-même.
7. Whitelist extensions `[.png, .jpg, .jpeg, .gif, .webp]`.
8. Magic bytes validation.
9. **Tier enforcement** :
   - Si état nouveau : check `maxStates` (open) ou `maxClosedStates` (`_closed` suffix).
   - Toujours : check `maxFramesPerState`.
10. `sharp(buffer, { animated: ext === '.gif' }).webp({ quality: 85 }).toBuffer()` — try/catch sur image corrompue → 400.
11. Path traversal check : `resolvedDir.startsWith(IMAGES_DIR)`.
12. Écrit fichier + INSERT frame + UPSERT user (si absent).
13. `broadcastFrameUpdate(token)`.

**Comportement attendu (contrat)** : Idempotent grâce au `Date.now()` dans le nom. Atomicité partielle — l'INSERT DB peut échouer après l'écriture disque → orphelin.

**Améliorations possibles** :
- **Atomicité** : écrire dans un fichier temp, INSERT DB, puis renommer (rollback fichier en cas d'erreur DB)
- `existingStates = db.prepare(...).all(token)` à chaque upload — préparable une fois (mais pris dans deps)
- Le `quality: 85` pourrait être configurable (`UPLOAD_QUALITY` env)
- GIF → WebP animé est large avec `quality: 85` — pour bandes-passantes faibles, considérer `effort` ou `nearLossless`
- L'option `animated: true` ne strip pas le metadata des GIFs animés correctement dans certaines versions de sharp — à tester
- Path traversal sur `token` : pas de regex check sur le token avant `path.join`. Atténué par le hash HMAC mais pas garanti si `isKnownToken` accepte des tokens externes.
- `try { ... } catch (sharpErr)` engloutit les détails — logger sharpErr pour debug

### `handleReorder(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `POST /reorder` — réordo dans une transaction SQLite.

**Comportement actuel** : Utilise `db.transaction(files => { ... })` correctement (vs `frames.js` qui passe par `_db?` interne fragile). Atomique.

**Améliorations possibles** :
- Pas de validation `order` length raisonnable (un array de 100k éléments saturerait)
- Pas de check ownership

### `handleDeleteFrame(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `POST /delete-frame` — fichier + DB.

Path traversal check ✓. `fs.unlinkSync` non try-catché → 500 sur erreur Windows lock.

### `handleMoveFrame(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `POST /move-frame` — single-frame mode (écrase la cible).

**Comportement actuel** :
1. Path traversal check.
2. **Single-frame mode** : supprime toutes les frames existantes de `toState` (fichier + DB) avant de mover.
3. `mkdir` dest, `renameSync` src → dest.
4. `moveFrame.run(toState, token, fromState, file)` UPDATE state_key.

**Comportement attendu (contrat)** : Sémantique single-frame = "remplacer le contenu de toState par la frame déplacée". Diffère de `frames.js#handleMoveFrame` qui n'écrase pas (incohérence).

**Améliorations possibles** :
- Si l'écrasement est volontaire, pas d'opt-out (paramètre `replace: false` pour append au lieu d'écraser)
- Atomicité absente : si le rename fail après le delete, l'état cible est vide → perte de données. Backup avant.
- Pas de check ownership

## Dépendances

- **Importe** : `path`, `fs`, `sharp`, [`http/helpers`](../http/helpers.js), [`services/tokenService`](../services/tokenService.js), [`services/tierService`](../services/tierService.js)
- **deps injectées** : `stmts`, `db`, `IMAGES_DIR`, `rateLimit`, `getClientIp`, `isKnownToken`, `broadcastFrameUpdate`
- **Utilisé par** : `index.js`. **Concurrence avec `frames.js`**.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🔴 Crit | **Doublon avec `frames.js`** : implémentations divergentes | Décider lequel garder. Recommandation : `upload.js` (plus complet). |
| 🟠 Maj | Atomicité : `writeFileSync` puis INSERT — orphelin si INSERT throw | Tmp file + rename pattern, ou INSERT d'abord avec rollback fichier |
| 🟠 Maj | Path traversal sur `token` non validé par regex | Valider `SAFE_FILENAME.test(token)` |
| 🟠 Maj | `handleMoveFrame` : pas d'atomicité (delete puis rename) | Wrapper en try/finally avec restore |
| 🟡 Min | `parseMultipart` ne limite pas la taille par part | Cap `name` à 64 chars, image à 10 Mo |
| 🟡 Min | `indexOf` custom au lieu de Buffer.indexOf natif | Remplacer |
| 🟡 Min | `quality: 85` hardcodé | Configurable via env |
| 🟡 Min | Pas de logging de la taille avant/après sharp (debug perf) | Logger ratio compression |
| 🟡 Min | `sharpErr` engluti, pas loggé | `console.error('Sharp error:', sharpErr)` |
| 🟡 Min | Pas de check ownership explicite (route handler-level) | Faire confiance au middleware ou doubler |

## Notes alternatives

**Action recommandée** : merger `frames.js` et `upload.js` en un seul fichier `frames.js` qui contient :
- Toutes les routes de mutation depuis `upload.js`
- `handleGetFrames` depuis `frames.js`

Le pattern deps-injection peut être conservé ou supprimé selon le choix global du projet (cohérence avec `auth.js`, `device.js` qui utilisent imports directs).

Pour la sécurité, considérer aussi :
- Scan antivirus (clamav) sur les uploads en background (non-bloquant) — overkill pour un projet perso, justifié si exposition publique
- Rate limit par token (pas seulement par IP) pour éviter qu'un user authentifié spam derrière un NAT
