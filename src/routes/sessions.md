# `sessions.js`

> Sessions PNGTuber collaboratives + invitations ciblées/ouvertes.
> 📂 `src/routes/sessions.js`
> 🔗 Module : [`routes/`](./README.md)

## Résumé

CRUD des **sessions PNGTuber** (groupes collaboratifs `voice` ou `standalone`) et des **invitations** vers ces sessions. Une notification persistée est créée à chaque invitation ciblée (broadcast WebSocket assuré par `index.js`). Soft delete partout (`left_at`, `status='ended'`).

## Fonctions / Exports

### `handleCreateSession(req, res, ctx)` → `Promise<void>`

**Brève** : `POST /api/sessions` — crée une session, ajoute le créateur comme owner.

**Comportement actuel** : Génère UUID v4. Defaults : type='standalone', maxParticipants=10. UPSERT participant avec rôle 'owner'.

**Améliorations possibles** :
- Pas de validation : `name` peut être `null`, ultra-long, contenir des chars de contrôle
- `maxParticipants` non plafonné (DoS via `maxParticipants: 1000000` — pas exploitable côté DB mais affichage UI)
- `type` non whitelisté (devrait être `voice` ou `standalone`)

### `handleGetSessions(req, res, ctx)` → `Promise<void>`

**Brève** : `GET /api/sessions` — mes sessions actives (owner ou participant).

**Comportement actuel** : `byUser` reçoit `discordId` deux fois (clause owner + clause participant). Retourne uniquement `status='active'`.

### `handleGetSession(req, res, ctx)` → `Promise<void>`

**Brève** : `GET /api/sessions/:sessionId` — détails + participants.

**Comportement actuel** : 404 si introuvable. Retourne session + liste participants actifs.

**Comportement attendu (contrat)** : Devrait être restreint aux participants ou à l'owner (sinon n'importe qui avec un UUID peut lire).

**Améliorations possibles** :
- **Pas de check d'appartenance** : un user authentifié peut lire les détails de n'importe quelle session s'il devine l'UUID. UUIDs sont infaisables à brute-force, mais une fuite (logs, URL share) expose toute la session.

### `handleEndSession(req, res, ctx)` → `Promise<void>`

**Brève** : `POST /api/sessions/:sessionId/end` — terminer (owner ou admin).

**Comportement actuel** : 404 si absent, 403 si pas owner/admin, sinon `psessions.end.run(id)` (set `status='ended'`).

### `handleLeaveSession(req, res, ctx)` → `Promise<void>`

**Brève** : `POST /api/sessions/:sessionId/leave` — soft delete (left_at).

Idempotent. Si le user n'est pas dans la session, `UPDATE` ne fait rien.

**Améliorations possibles** :
- L'owner qui leave reste owner techniquement. Devrait soit transférer ownership soit terminer la session.

### `handleGetParticipants(req, res, ctx)` → `Promise<void>`

**Brève** : `GET /api/sessions/:sessionId/participants` — liste actifs.

Pas de check d'appartenance (cf. `handleGetSession`).

### `handleCreateInvitation(req, res, ctx)` → `Promise<void>`

**Brève** : `POST /api/invitations` — invitation ciblée ou ouverte.

**Comportement actuel** :
1. 400 si `sessionId` manquant.
2. 404 si session introuvable.
3. UUID v4 + INSERT.
4. Si `invitedDiscordId` : crée notification persistée (uniquement pour invitations ciblées).

**Comportement attendu (contrat)** : Documentation CLAUDE.md mentionne "self-invite et double-participate prevented" — **non vérifié dans ce code**. Ce sont les middlewares ou le repo qui doivent les bloquer.

**Améliorations possibles** :
- **Pas de check ownership** : n'importe qui authentifié peut créer une invitation pour n'importe quelle session. Devrait vérifier que `ctx.session.discordId === s.owner_discord_id || isParticipant`.
- **Self-invite non bloqué** : `invitedDiscordId === ctx.session.discordId` accepté (devrait 400).
- **Double-invite non bloqué** : pas de check si une invitation pending existe déjà pour ce discordId/session.
- `streamName`, `maxUses`, `expiresAt` non validés (types, ranges).
- `expiresAt` accepté en string libre — devrait être validé ISO 8601.

### `handleAcceptInvitation(req, res, ctx)` → `Promise<void>`

**Brève** : `POST /api/invitations/:id/accept` — accepter + rejoindre.

**Comportement actuel** :
1. 400 si pas trouvée ou status ≠ 'pending'.
2. UPDATE status='accepted'.
3. Increment use_count.
4. Add participant.

**Comportement attendu (contrat)** : Pour les invitations ciblées, vérifier que `inv.invited_discord_id === ctx.session.discordId`. Pour les ouvertes (link-based), vérifier `use_count < max_uses` et `expires_at`.

**Améliorations possibles** :
- **Manque le check `invited_discord_id`** : un user peut accepter l'invitation d'un autre s'il connaît l'ID UUID.
- **Manque le check `expires_at`** : invitations expirées toujours acceptables.
- **Manque le check `use_count < max_uses`** : pour les invitations ouvertes, peut être consommée infiniment (le `incrementUse` n'a pas de garde).
- Le `updateStatus.run('accepted', id)` clôt l'invitation — incohérent avec `max_uses > 1` qui suggère plusieurs accept possibles. Soit accepter une seule fois (cohérent avec le code), soit ne pas changer le status pour les ouvertes.
- Pas de check si déjà participant.

### `handleDeclineInvitation(req, res, ctx)` → `Promise<void>`

**Brève** : `POST /api/invitations/:id/decline`.

Pas de vérification destinataire — un user peut décliner pour un autre.

### `handleMyInvitations(req, res, ctx)` → `Promise<void>`

**Brève** : `GET /api/my-invitations` — pending pour moi.

Filtré par `invited_discord_id` ✓.

## Dépendances

- **Importe** : `node:crypto`, [`http/helpers`](../http/helpers.js), [`db/repos/sessions`](../db/repos/sessions.js) (`psessions`, `participants`, `invitations`), [`db/repos/appTokens`](../db/repos/appTokens.js) (`notifications`), [`services/tokenService`](../services/tokenService.js)
- **Utilisé par** : `index.js`. `psessions.activeVoice` consommé par le pipeline de connexion vocale (auto-création de session voice).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🔴 Crit | `handleAcceptInvitation` : pas de check `invited_discord_id === session.discordId` | **Critique** : tout user peut hijacker une invitation ciblée à autrui. Ajouter le check. |
| 🟠 Maj | `handleAcceptInvitation` : pas de check `expires_at`, `use_count < max_uses` | Bloquer les expirées et les épuisées |
| 🟠 Maj | `handleCreateInvitation` : pas de check ownership/participant | Vérifier que le créateur est owner ou participant de la session |
| 🟠 Maj | `handleGetSession`/`handleGetParticipants` : pas de check d'appartenance | Restreindre aux participants/owner |
| 🟠 Maj | `handleDeclineInvitation` : pas de check destinataire | Ajouter le check |
| 🟡 Min | Self-invite non bloqué | 400 si `invitedDiscordId === session.discordId` |
| 🟡 Min | Double-invite pending non bloqué | 409 Conflict si déjà pending |
| 🟡 Min | `name`/`type`/`maxParticipants` non validés | Whitelist + cap |
| 🟡 Min | `expiresAt` non validé ISO 8601 | Validation format |
| 🟡 Min | Owner qui leave reste owner | Transférer ou ender |

## Notes alternatives

Ce fichier accumule trois domaines (sessions, participants, invitations) — split possible :
- `sessions.js` → routes session pures
- `invitations.js` → routes invitation
- `participants.js` → routes participant

Les checks d'autorisation manquants suggèrent qu'un middleware factory `requireSessionMember(sessionId)` / `requireSessionOwner(sessionId)` serait utile pour réutiliser la logique entre handlers.
