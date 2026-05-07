# `notifications.js`

> Lecture et marquage des notifications in-app (cloche frontend).
> 📂 `src/routes/notifications.js`
> 🔗 Module : [`routes/`](./README.md)

## Résumé

Trois endpoints REST minimalistes pour la consommation des notifications stockées en DB. Les **notifications sont créées** par d'autres routes (typiquement `sessions.js#handleCreateInvitation` pour les invitations ciblées), puis broadcastées en temps réel via WebSocket depuis `index.js`. Ce fichier ne crée jamais de notification — il ne fait que lire et marquer.

## Fonctions / Exports

### `handleGetNotifications(req, res, ctx)` → `Promise<void>`

**Brève** : `GET /api/notifications?unread=true&limit=20` — liste paginée.

**Comportement actuel** : `parseInt(limit || '20', 10)` (sans cap max). Branchement sur `?unread=true` pour appeler `notifRepo.unread` ou `notifRepo.list`. Filtré côté SQL par `discord_id = ctx.session.discordId`.

**Améliorations possibles** :
- `parseInt` sans cap → `?limit=999999` charge tout en mémoire. Cap à 100 max.
- `parseInt('NaN' || '20')` retourne `NaN` → SQLite reçoit `NaN` (peut throw selon le driver). Sécuriser avec `Number.isFinite(limit) ? limit : 20`.
- Pas de pagination par cursor (offset only via limit) — OK pour une cloche, pas pour un historique long.

### `handleMarkRead(req, res, ctx)` → `Promise<void>`

**Brève** : `POST /api/notifications/:id/read` — marque une notif comme lue.

**Comportement actuel** : `notifRepo.markRead.run(Number(ctx.params.id), ctx.session.discordId)`. Le filtre `WHERE id = ? AND discord_id = ?` empêche un user de marquer la notif d'un autre comme lue. ✓

**Améliorations possibles** :
- `Number('foo') === NaN` → SQLite reçoit `NaN`. Devrait valider/400 si non-int.
- Pas de feedback si l'ID n'existe pas (200 OK silencieux). Vérifier `result.changes` et 404 si rien matché.

### `handleMarkAllRead(req, res, ctx)` → `Promise<void>`

**Brève** : `POST /api/notifications/read-all` — tout marquer comme lu.

**Comportement actuel** : Filtré côté SQL par `discord_id` ✓. Idempotent.

## Dépendances

- **Importe** : [`http/helpers`](../http/helpers.js), [`db/repos/appTokens`](../db/repos/appTokens.js) (`notifications`)
- **Utilisé par** : `index.js`. Notifications créées par `sessions.js` (invitations), potentiellement par d'autres routes futures.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟡 Min | `?limit` sans cap max → DoS mémoire | `Math.min(parseInt(...), 100)` |
| 🟡 Min | Validation int absente sur `:id` et `?limit` | `if (!Number.isFinite(...)) return 400` |
| 🟡 Min | Pas de 404 sur ID inexistant | Check `result.changes` |
| 🟢 Info | Cleanup automatique des notifs > 30 jours est mentionné dans CLAUDE.md mais pas visible ici | Soit dans `db/database.js` au boot, soit setInterval — vérifier où c'est fait |

## Notes alternatives

Les notifications gagneraient une route `DELETE /api/notifications/:id` pour permettre au user de supprimer définitivement (vs juste marquer lue). Selon UX, peut être désactivé pour conserver l'historique d'audit.

Cette route est candidate à une intégration WebSocket native (push only, pas de poll) — actuellement le frontend doit poller en plus du WebSocket pour le count initial.
