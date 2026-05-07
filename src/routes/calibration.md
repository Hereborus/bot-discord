# `calibration.js`

> **Routes pour CRUD des empreintes d'émotions (POST save-fingerprint, DELETE fingerprint).**
> `src/bot/calibration.js`
> Module : [`bot/`](./README.md)

## Résumé

Anomalie de placement : ce fichier est dans `src/bot/` mais expose des **routes HTTP** (devrait être dans `src/routes/` à côté de `emotion.js`, `frames.js`, etc.). Aucune action utilisateur "calibration en temps réel" ici — le frontend calcule le fingerprint depuis `/levels` puis POST le résultat. Pas de boucle d'enregistrement timer côté backend.

## Fonctions / Exports

### `handleSaveFingerprint(req, res, ctx, deps)` *(non default-exporté mais nommé)*

**Brève** : `POST /calibration/:token/save-fingerprint` — sauvegarde une empreinte sous `cfg.emotionFingerprints[emotionKey]`.
**Comportement actuel** :
1. Valide token via `uidFor(token) || isKnownToken(token)`.
2. Parse JSON body, exige `emotionKey: string` + `fingerprint: object`.
3. Lit `getUserConfig(token)` → JSON.parse.
4. Merge le fingerprint dans `cfg.emotionFingerprints`.
5. `upsertUser(token, displayName, JSON.stringify(cfg))`.
6. Invalide le cache des empreintes (`invalidateAudioFpCache`).
**Contrat attendu** : appelée après `requireAuth` + `requireClientOrAdmin`.
**Améliorations possibles** :
- Pas de validation de la **forme** du fingerprint (ex: features attendues `db, zcr, freq_low, ...` avec `mean`/`std`). Un client malicieux peut stocker un objet arbitraire qui plante ensuite la détection.
- Pas de **limite sur le nombre de fingerprints** par user — un user peut stocker 1000 émotions.
- `cfg.displayName || row?.display_name || '???'` — chaîne de fallback fragile, devrait passer par un helper.

### `handleDeleteFingerprint(req, res, ctx, deps)`

**Brève** : `DELETE /calibration/:token/fingerprint/:emotionKey`.
**Comportement actuel** : supprime l'entrée ; si plus aucune empreinte, supprime la clé entière `cfg.emotionFingerprints`.

### `registerCalibrationRoutes({ route, requireAuth, requireClientOrAdmin, stmts, isKnownToken, invalidateAudioFpCache })`

**Brève** : enregistre les 2 routes via `route()` injecté.
**Comportement actuel** : le handler est wrappé dans une closure pour injecter `deps`.
**Note importante** : selon mon grep, `registerCalibrationRoutes` n'est **importé que par index.js** (mais pas appelé d'après le grep — à vérifier ; peut-être inlined dans `index.js`). Si elle n'est pas wired, ces routes sont **mortes**.

## Dépendances
- **Importe** : [`services/tokenService.js`](../services/tokenService.md) (`uidFor`), [`http/helpers.js`](../http/helpers.md) (`json`, `parseJsonBody`).
- **Utilisé par** : `index.js` (à vérifier — l'export est importé mais pas trouvé dans le grep `registerCalibrationRoutes`).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **Mauvais dossier** : ce fichier expose des routes HTTP, il devrait être dans `src/routes/calibration.js` à la place. Cohérence avec le reste de l'architecture. | Déplacer. |
| 🟠 | **Pas de validation du fingerprint** : un payload `{ db: 'pwned' }` est sauvegardé tel quel et risque de planter la détection en boucle. | Whitelist features + check `typeof === 'number'` + finite. |
| 🟠 | Pas de cap sur le nombre d'émotions stockées (DoS storage trivial). | Limite de 50 par user. |
| 🟡 | `JSON.parse(row.config_json || '{}')` sans `try/catch` ⇒ 500 si JSON corrompu en DB. | Wrap try/catch, fallback `{}`. |
| 🟡 | `registerCalibrationRoutes` est-il **réellement appelé** ? Le grep ne trouve que la définition + import — vérifier dans `index.js` qu'il est wired. | Si mort, supprimer ; sinon ajouter test fumée. |

## Notes alternatives

Le pattern d'injection de `route, requireAuth, requireClientOrAdmin, stmts` est lourd mais évite les imports circulaires entre `index.js` et ce fichier. À terme, `index.js` devrait exporter ces dépendances proprement et ce fichier n'aurait qu'à les importer.
