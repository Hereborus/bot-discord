# `emotion.js`

> Override manuel d'émotion par utilisateur (priorité sur la détection auto).
> 📂 `src/routes/emotion.js`
> 🔗 Module : [`routes/`](./README.md)

## Résumé

Petit module qui maintient une `Map<token, { emotion, setAt }>` pour les émotions définies manuellement (par raccourci clavier de l'agent local ou par bouton UI). Cet override prime sur la détection automatique d'émotion (basée sur empreintes vocales dans `audio.js`/`bot/`). Auto-expire après 30 minutes.

La Map `manualEmotion` est exportée pour être consommée côté broadcast WebSocket et dans `handleLevels` (index.js).

## Fonctions / Exports

### `manualEmotion` → `Map<token, { emotion, setAt }>`

État global. Cleanup périodique toutes les 5 minutes (entrées > 30 min). Aucune persistence DB — perdu au restart (acceptable pour un override transient).

### `setManualEmotion(token, emotion)` → `string | null`

**Brève** : Helper public — set ou clear l'émotion manuelle d'un token.

**Comportement actuel** : Si `emotion` falsy → delete. Sinon set + `setAt = Date.now()`. Retourne l'émotion active après modification.

**Comportement attendu (contrat)** : Idempotent. Pas de validation du nom d'émotion ici (c'est l'appelant qui doit valider).

### `handleGetEmotion(req, res, ctx)` → `Promise<void>`

**Brève** : `GET /api/emotion/:token` — émotion manuelle active.

Public (lecture seule), pas de check token connu. Retourne `{ active: emotion | null }`.

**Améliorations possibles** :
- Pas de check `isKnownToken` — un attaquant peut tester n'importe quel token. Pas vraiment exploitable (réponse uniforme), mais cohérence avec les autres routes utiliserait le check.

### `handleSetEmotion(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `POST /api/emotion/:token` — set/clear (auth + ownership requis).

**Comportement actuel** : 
1. 404 si token inconnu.
2. Parse JSON, 400 sur erreur.
3. `emotion = typeof body.emotion === 'string' ? body.emotion : null`.
4. Appelle `setManualEmotion`.

**Comportement attendu (contrat)** : Protégé par `requireAuth + requireClientOrAdmin` côté `index.js`. Le user ne peut écrire que sur son propre token.

**Améliorations possibles** :
- Pas de validation du nom d'émotion (devrait être dans la liste d'émotions configurées par le user)
- Pas de broadcast WebSocket explicite (le broadcast se fait via le tick de levels qui lit la Map)
- Pas de check ownership explicite (repose sur middleware)

## Dépendances

- **Importe** : [`http/helpers`](../http/helpers.js) (`json`, `parseJsonBody`), [`services/tokenService`](../services/tokenService.js) (`uidFor`)
- **Utilisé par** : `index.js` (registration + lecture de `manualEmotion` pour broadcast)

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟡 Min | Pas de validation du nom d'émotion | Whitelist depuis la config user |
| 🟡 Min | Pas de check ownership explicite | Ajouter `if (tokenFor(session.discordId) !== ctx.params.token && !admin) 403` |
| 🟢 Info | Setinterval cleanup non `unref()` | Empêche un éventuel exit gracieux du process |

## Notes alternatives

Le timeout 30 min est arbitraire — pourrait être configurable par user via `cfg.emotionHoldMs` (déjà présent dans la config). Cohérence avec les empreintes vocales.

Le broadcast WebSocket de l'émotion change est implicite (le tick de levels poll la Map). Un broadcast direct sur set/clear réduirait la latence de propagation aux viewers.
