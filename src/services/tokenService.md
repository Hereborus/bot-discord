# `tokenService.js`

> **Tokenisation HMAC-SHA256 (16 hex) des IDs Discord — jamais d'ID brut sur HTTP.**
> `src/services/tokenService.js`
> Module : [`services/`](./README.md)

## Résumé

Convertit `userId` Discord ↔ `token` (16 chars hex) de manière déterministe via HMAC-SHA256 + `USER_HASH_SECRET`. Cache bidirectionnel en mémoire pour éviter le calcul HMAC répété. Fallback DB pour `isKnownToken` quand le token n'a jamais transité par le pipeline audio.

## Fonctions / Exports

### `hashUid(userId)` *(interne)*

**Brève** : `HMAC_SHA256(USER_HASH_SECRET, userId).hex.slice(0, 16)`.
**Comportement actuel** : `String(userId)` pour normaliser ; lecture **lazy** de `process.env.USER_HASH_SECRET` à chaque appel (mais cache via `tokenFor` ⇒ une seule lecture par user).
**Améliorations possibles** : si `USER_HASH_SECRET` n'est pas défini, `crypto.createHmac` lance — pas de fallback ; documenter en haut du fichier qu'il doit être set.

### `tokenFor(userId)` → `string`

**Brève** : token canonique pour un userId Discord.
**Comportement actuel** : memoïsation bidirectionnelle (`uidToToken`, `tokenToUid`).
**Contrat attendu** : pure et déterministe — même userId ⇒ même token entre redémarrages (à condition que `USER_HASH_SECRET` soit stable).
**Améliorations possibles** : aucune.

### `uidFor(token)` → `userId | null`

**Brève** : reverse lookup ; retourne `null` si le token n'a jamais été produit par `tokenFor` dans cette instance.
**Limitation importante** : **HMAC est non-réversible** ; si le bot redémarre, un token reçu d'un client (ex: dans une URL OBS) ne sera pas résolu tant que l'user n'a pas reparlé. C'est pourquoi `isKnownToken` existe.

### `isKnownToken(token)` → `boolean`

**Brève** : token connu en mémoire OU en DB `users`.
**Comportement actuel** : `tokenToUid.has(token) || users.get(token)` ; le second retourne la ligne user (truthy si existe).
**Contrat attendu** : safe à appeler avant la connexion vocale (utilisé dans `routes/calibration` et `routes/config`).

## État interne

`tokenToUid: Map`, `uidToToken: Map` — non exportés, croissance non bornée (mais bornée par le nombre d'users distincts qui ont parlé depuis le boot).

## Dépendances
- **Importe** : `node:crypto`, [`db/repos/users.js`](../db/repos/users.js) (fallback).
- **Utilisé par** : 13 fichiers (cf. grep) — quasiment tout le code, c'est le module le plus ubiquitaire.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | Si `USER_HASH_SECRET` n'est pas défini en env, `hashUid` lance `TypeError: secret must be a string`. Pas d'auto-génération comme pour `SESSION_SECRET`. | Lire en lazy une seule fois et générer + persister sur disque si absent (ou au moins refuser le boot avec un message clair). |
| 🟠 | **Truncation à 16 hex (64 bits)** : pour ~10⁶ users, p(collision) ≈ 2.7×10⁻⁸ — acceptable, mais une collision = un user voit l'avatar d'un autre. | Documenter le tradeoff. Passer à 24 hex (96 bits) éliminerait virtuellement le risque. |
| 🟡 | Caches **non bornés** — fuite mémoire théorique sur un bot avec churn massif (>10⁶ users uniques sur la durée de vie du process). | LRU cap 100k entrées suffit largement. |
| 🟡 | `users?.get?.get(token)` — défense optionnelle peut masquer une vraie erreur (DB absente). | `try/catch` explicite, log si problème. |

## Notes alternatives

L'export `MAX_BODY_SIZE` ou similaire pourrait être centralisé ; ici, le service est intentionnellement minimal.
