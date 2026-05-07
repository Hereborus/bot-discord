# `device.js`

> Device Auth Flow (RFC 8628) pour mini-applications + gestion des Bearer tokens.
> 📂 `src/routes/device.js`
> 🔗 Module : [`routes/`](./README.md)

## Résumé

Implémente le **OAuth2 Device Authorization Grant (RFC 8628)** : permet à une app locale (agent, plugin OBS) sans URL de callback d'obtenir un Bearer token. Flux : l'app demande un `deviceCode + userCode`, le user ouvre une URL et tape le `userCode` dans son navigateur (déjà connecté), il approuve, l'app récupère son `appToken` via polling. Les tokens sont persistés en SHA-256 (jamais en clair) et plafonnés au rôle `client` (jamais admin via Bearer).

Inclut aussi le CRUD des app tokens (`/api/app-tokens`).

## Fonctions / Exports

### `deviceAuthRequests` → `Map<string, DeviceRequest>`

Stockage en mémoire des demandes en cours. Cleanup périodique (60s) des entrées expirées.

### `generateUserCode()` → `string`

**Brève** : Génère un code lisible `XXXX-XXXX` (32 chars sans ambiguïté 0/O/1/I).

Utilise `crypto.randomBytes(8)` + alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. ~32^8 ≈ 1.1×10¹² combinaisons, suffisant pour des codes courte durée (5 min).

**Améliorations possibles** :
- Le `bytes[i] % 32` introduit un biais légèrement non-uniforme (256 % 32 = 0, donc OK ici par chance — le code marche si l'alphabet a une longueur puissance de 2)
- Re-générer si collision avec un userCode actif (théorique — rare)

### `getClientIp(req)` → `string`

Helper interne dupliqué avec `auth.js`. Voir [auth.md](./auth.md).

### `handleDeviceAuthorize(req, res, ctx, rateLimit)` → `Promise<void>`

**Brève** : `POST /api/device/authorize` — l'app demande un couple (deviceCode, userCode).

**Comportement actuel** :
1. Rate limit 5/min/IP.
2. Si > 500 entrées en attente, purge les expirées (cap mémoire).
3. `deviceCode` = 32 octets hex (256 bits), `userCode` = 8 chars XXXX-XXXX.
4. `deviceName` = `body.deviceName.slice(0, 64)` (truncation, fallback 'Agent').
5. Stocke avec `expiresAt = +5 min`.
6. Retourne `{ deviceCode, userCode, verifyUrl, expiresIn: 300, interval: 5 }`.

**Comportement attendu (contrat)** : Endpoint public, pas d'auth requise. Aucun lien avec un user à ce stade. Le user est lié uniquement après `handleDeviceVerifySubmit(action='approve')`.

**Améliorations possibles** :
- Pas de validation de `deviceName` (peut contenir n'importe quoi — XSS si affiché brut côté navigateur dans `handleDeviceVerifyPage`). Voir audit.
- Le purge "if size > 500" ne purge que les expirés — si 500 demandes valides en parallèle, le map gonfle. Cap dur recommandé.

### `handleDevicePoll(req, res, ctx, rateLimit)` → `Promise<void>`

**Brève** : `POST /api/device/poll` — l'app interroge le statut.

**Comportement actuel** : Rate limit 30/min/IP. Lit `entry = deviceAuthRequests.get(deviceCode)`. Renvoie `expired` / `denied` / `authorized` / `pending`. Si `authorized`, supprime l'entrée (one-shot) et retourne `{ status, appToken, userToken, tier }`.

**Comportement attendu (contrat)** : Devrait respecter `interval` retourné (RFC 8628 — slow_down si polling trop fréquent). Actuellement, juste 429 sur dépassement.

**Améliorations possibles** :
- Conformité RFC : retourner `slow_down` dans le body au lieu de 429
- Pas de lien entre `deviceCode` et IP de l'app — un attaquant qui devine un `deviceCode` (32 octets, infaisable) pourrait poll. OK en pratique.

### `handleDeviceVerifyPage(req, res, ctx)` → `Promise<void>`

**Brève** : `GET /api/device/verify?user_code=XXXX` — page HTML de validation.

**Comportement actuel** : Sert une page HTML inline avec input + boutons Vérifier/Autoriser/Refuser. JS embarqué appelle `/api/device/verify` (POST). Le `userCode` du query est rendu via `escapeHtml` ✓.

**Comportement attendu (contrat)** : Le user doit déjà être connecté (sinon le POST `/api/device/verify` n'aura pas de session — résulte en erreur silencieuse côté UI).

**Améliorations possibles** :
- Si non authentifié, rediriger vers `/auth/login?next=/api/device/verify?user_code=...` automatiquement (UX)
- HTML inline volumineux (~70 lignes) — extraire dans un fichier template `meta/device-verify.html`
- Le `deviceName` retourné par `/api/device/verify` est inséré via `textContent` côté JS ✓ (pas d'XSS)

### `handleDeviceVerifySubmit(req, res, ctx, rateLimit)` → `Promise<void>`

**Brève** : `POST /api/device/verify` — le user approuve/refuse via UI.

**Comportement actuel** :
1. Rate limit 10/min/IP.
2. Recherche **linéaire** dans `deviceAuthRequests` par `userCode` (statut pending, non expiré).
3. Action `check` → `{ found, deviceName }`.
4. Action `deny` → status='denied'.
5. Action `approve` :
   - Vérifie tier ≠ 'free' (fonctionnalité premium requise).
   - Génère `rawToken = 32 octets hex` (256 bits).
   - Stocke uniquement `SHA-256(rawToken)` en DB via `appTokensRepo.create.run(hash, discordId, deviceName)`.
   - Marque l'entry `authorized`, lie `discordId` et `appToken` (rawToken).
   - Le rawToken est récupéré une seule fois par `handleDevicePoll`.

**Comportement attendu (contrat)** : Auth requise (middleware en amont). Le `userCode` doit matcher exactement (insensitive case via `.toUpperCase()`). Comparaison directe `===` (pas timing-safe — viable car le code change à chaque requête).

**Améliorations possibles** :
- Recherche linéaire O(n) sur la map — dans la pratique n est petit (max 500), mais ajouter une map inversée `userCodeToDeviceCode` serait O(1)
- L'erreur "Code invalide ou expiré" retourne 200 — devrait être 400 ou 404 (sémantique HTTP)
- Pas de log d'audit des approbations (qui a autorisé quel device, quand, depuis quelle IP)

### `handleListAppTokens(req, res, ctx)` → `Promise<void>`

**Brève** : `GET /api/app-tokens` — liste des tokens de l'utilisateur.

Renvoie `{ tokens: [{ id, device_name, last_used_at, created_at }] }`. N'expose pas `token_hash` (✓).

### `handleRevokeAppToken(req, res, ctx)` → `Promise<void>`

**Brève** : `DELETE /api/app-tokens/:id` — révoque un token.

**Comportement actuel** : Parse `id` en int (400 si NaN). `appTokensRepo.revoke.run(id, ctx.session.discordId)` — la clause WHERE `discord_id = ?` empêche un user de révoquer le token d'un autre. Soft delete (revoked_at = NOW).

**Améliorations possibles** :
- Pas de feedback si l'ID n'existait pas / n'appartient pas au user (200 OK silencieux). Vérifier `changes > 0` du run et 404 si rien modifié.

## Dépendances

- **Importe** : `node:crypto`, [`db/repos/appTokens`](../db/repos/appTokens.js), [`services/tierService`](../services/tierService.js), [`services/tokenService`](../services/tokenService.js), [`http/helpers`](../http/helpers.js), [`http/cors`](../http/cors.js)
- **Utilisé par** : `index.js` (registration + `services/authService` consume `appTokensRepo` pour valider les Bearer tokens)

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 Maj | `deviceName` accepté sans sanitisation, risque d'affichage XSS si rendu non échappé ailleurs | Valider regex `[\w\s\-.]{1,64}` |
| 🟡 Min | Recherche linéaire O(n) sur `userCode` | Map inversée `userCodeToDeviceCode` |
| 🟡 Min | `handleDevicePoll` retourne 429 au lieu de `slow_down` (RFC 8628) | Conformité RFC |
| 🟡 Min | Pas de logging d'audit (approbation, révocation) | Logger les actions de gestion de token |
| 🟡 Min | `handleRevokeAppToken` : pas de 404 sur ID inexistant | Vérifier `result.changes` |
| 🟡 Min | HTML inline 70 lignes dans `handleDeviceVerifyPage` | Extraire en template |
| 🟡 Min | Pas de redirection auto vers `/auth/login` si non connecté sur `/api/device/verify` | Améliorer UX |
| 🟢 Info | `getClientIp` dupliqué (3 fichiers) | Factoriser |

## Notes alternatives

- Le polling RFC 8628 pourrait être remplacé par une attente long-poll (le serveur garde la connexion ouverte jusqu'à approbation/timeout) — réduit la charge réseau pour les clients lents.
- `appTokensRepo` n'expose pas l'IP de l'autorisation initiale — utile pour audit ("appToken créé depuis 192.168.1.10"). Schéma à étendre.
