# `useNotifications.js`

> **CRUD notifications** — chargement, mark-read, push temps réel.
> 📂 `client/src/hooks/useNotifications.js`
> 🔗 Module : [`hooks/`](./README.md)

## Résumé

Hook auto-suffisant pour gérer la liste des notifications utilisateur. State local (pas dans `AppContext`), API : `GET /api/notifications?unread=true&limit=20`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`. Le helper `push()` permet à `App.jsx` (via `useWebSocket`) d'ajouter une notif reçue en temps réel sans refetch.

## Composants / Hooks exportés

### `useNotifications()` → `{ notifications, load, markRead, markAllRead, push }`

**Retour** :
- `notifications: Notif[]` — état local (initialement vide).
- `load()` — fetch les non-lues (limite 20). Silencieux si erreur.
- `markRead(id)` — POST puis update optimiste local (pas de retry si échec).
- `markAllRead()` — POST puis update optimiste sur toutes.
- `push(notif)` — prepend dans le state (utilisé par WS).

**Comportement actuel** :
- 4 callbacks tous mémoïsés via `useCallback([])` (pas de deps).
- Erreurs silencieuses (`try { … } catch {}`).
- Update optimiste : on marque `read: 1` localement avant que le serveur confirme.

**Comportement attendu (contrat)** :
- `load()` est appelé une fois au bootstrap par `App.jsx`. Si on veut rafraîchir, l'appelant doit relancer.
- `push(notif)` ne déduplique pas — si une notif est reçue par WS *et* fetchée par `load()`, doublon possible.

**Améliorations possibles** :
- Polling secondaire toutes les 5min en cas de WS down.
- Déduplication par `notif.id` dans `push`.
- Rollback de l'update optimiste sur échec serveur.

## State & Side effects

- **State local** : `notifications: Notif[]`.
- **Context utilisé** : non.
- **API appelée** : `GET /api/notifications?unread=true&limit=20`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`.
- **WebSocket** : non directement, mais alimenté par `App.jsx` qui écoute le WS et appelle `push`.
- **localStorage** : non.

## Dépendances

- **Importe** : `useState`, `useCallback`, `apiFetch`.
- **Utilisé par** : `App.jsx` (`ControlApp`).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **`apiFetch` directement** au lieu de `apiJson` + gestion d'erreur silencieuse → un 500 backend passe inaperçu. | Toaster ou logger. |
| 🟠 | **Pas de déduplication** entre `load()` et `push(notif)` → doublons si WS et fetch concourrent. | Filtrer par `id` dans `push`. |
| 🟠 | **Update optimiste sans rollback** — si POST `/read` échoue, l'UI ment. | Try/catch + rollback. |
| 🟡 | Pas de pagination — `?limit=20` est en dur. | Exposer en option. |
| 🟡 | Pas d'accusé de réception côté `push` (pas d'écriture serveur "received"). | Ack via WS si critique. |

## Notes alternatives

- Migrer vers React Query pour cache + invalidation automatique.
