# `useWebSocket.js`

> **WebSocket auto-reconnectant** — délégation simple à un callback `onMessage`.
> 📂 `client/src/hooks/useWebSocket.js`
> 🔗 Module : [`hooks/`](./README.md)

## Résumé

Connecte à `ws(s)://{getApiBase().host}` (même origine que l'API), parse chaque message JSON et le passe à `onMessage`. En cas de fermeture (réseau, restart serveur), retente toutes les 5 secondes. Utilise un `useRef` pour stocker le callback : ainsi le `useEffect` n'a pas de deps `[onMessage]`, ce qui évite de fermer/réouvrir le WS à chaque render.

## Composants / Hooks exportés

### `useWebSocket(onMessage)` — hook

**Args** :
- `onMessage: (data: any) => void` — appelé pour chaque frame reçue (déjà parsée JSON).

**Retour** : rien — side-effect-only.

**Comportement actuel** :
- Stocke `onMessage` dans `onMsgRef` à chaque render (sync ref).
- `useEffect([])` (vide intentionnellement) : connecte une fois, schedule reconnect en cas de close.
- Cleanup : flag `destroyed = true` + `clearTimeout(retryTimer)` + `ws?.close()`.
- En cas d'erreur (`onerror`), force `ws.close()` → ce qui déclenche `onclose` → reconnect.

**Comportement attendu (contrat)** :
- Reconnexion infinie tant que le composant est monté.
- `onMessage` reçoit l'objet JSON parsé ; les frames non-JSON sont silencieusement ignorées (`try { JSON.parse } catch {}`).
- Pas de buffering : si pas connecté, les messages ne sont pas envoyés (de toute façon le hook n'expose pas de `send`).

**Améliorations possibles** :
- Exposer `{ status, lastMessage, send }` pour permettre des UI de connexion + envoi.
- Backoff exponentiel au lieu de 5s fixes.
- Authentification : passer un token / cookie dans l'upgrade (actuellement on s'appuie sur le cookie de session côté serveur).
- Heartbeat (ping/pong) pour détecter les zombie connections.

## State & Side effects

- **State local** : `onMsgRef`.
- **Context utilisé** : non (mais lit `getApiBase()`).
- **API appelée** : aucune (uniquement WS upgrade).
- **WebSocket** : oui — la raison d'être.
- **localStorage** : non.

## Dépendances

- **Importe** : `useEffect`, `useRef`, `getApiBase`.
- **Utilisé par** : `App.jsx` (`ControlApp`) avec callback qui filtre `msg.type === 'notification'`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **Pas d'indicateur de statut** exposé → impossible d'afficher "connexion perdue" dans l'UI. | Renvoyer `{ status, lastMessage }` ou exposer un context. |
| 🟠 | **Backoff fixe 5s** → si le serveur est en train de redémarrer (≈ 30s), on hammer. Inversement, après 1h offline, on ne tente toujours qu'à 5s. | Backoff exponentiel `min(5s * 2^n, 60s)`. |
| 🟠 | **Pas de heartbeat** — un proxy intermédiaire peut killer la connexion silencieusement sans `onclose`. | Ping toutes les 30s côté client. |
| 🟡 | `host = base.replace(/^https?:\/\//, '')` — fonctionne mais fragile si jamais `getApiBase()` renvoie autre chose. | `new URL(base).host`. |
| 🟡 | `ws.onerror = () => ws.close()` → close possiblement déjà en cours, double appel. | Idempotent en pratique. |
| 🟡 | Pas d'envoi possible (`send`) — utile si on veut un protocole bidirectionnel. | Exposer une ref. |
| 🟡 | Reconnexion **immédiate** au mount alors que le composant n'est peut-être pas prêt. | Délai `0` OK, mais documenter. |

## Notes alternatives

- `react-use-websocket` couvre tout ça out-of-the-box (status, reconnect, lastMessage, sendJsonMessage).
