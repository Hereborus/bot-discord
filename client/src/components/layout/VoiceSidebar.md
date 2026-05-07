# `VoiceSidebar.jsx`

> **Sidebar gauche** — guilds, channels vocaux, join/disconnect, reconnexion auto.
> 📂 `client/src/components/layout/VoiceSidebar.jsx`
> 🔗 Module : [`layout/`](./README.md)

## Résumé

Permet (admin) de piloter les connexions vocales du bot Discord depuis l'UI. Liste les guilds Discord auxquelles le bot appartient (`/api/guilds`), expand au clic pour charger les channels (`/api/guilds/{id}/channels`, lazy + cache local), permet de **rejoindre** un channel (`POST /api/voice/join`) ou de **déconnecter** (`POST /api/voice/disconnect`). Pour les non-admin, seuls les channels `allowed: true` sont cliquables.

Toggle "Reconnexion auto au démarrage" → `POST /api/auto-reconnect`.

## Composants / Hooks exportés

### `VoiceSidebar()` (sans props)

**Brève** : sidebar autonome qui gère son propre état.

**Comportement actuel** :
- 5 states locaux : `guilds[]`, `channels{}` (cache par guildId), `expanded{}`, `autoReconnect`, `voiceStatus`.
- `loadGuilds` mémoïsé : `Promise.all([/api/guilds, /api/voice/status])`.
- `useEffect([loadGuilds])` au mount.
- Click sur un guild → toggle expanded ; charge les channels la première fois.
- Click sur un channel → `joinChannel` (si admin OU `ch.allowed`) puis re-fetch des guilds (mais pas des channels).
- `botStatus.inVoice` (du contexte) détermine si on affiche le bouton "Déconnecter" et le toggle.

**Comportement attendu (contrat)** :
- L'état "channel actif" se déduit de `voiceStatus.channelId`. Mais ce statut n'est rafraîchi qu'au mount et après chaque action — pas en temps réel. Le polling `/levels` met à jour `botStatus.inVoice` mais pas `voiceStatus.channelName`.
- Les permissions sur les channels (`ch.allowed`) sont calculées côté backend ; le frontend ne fait que filtrer le clic.

**Améliorations possibles** :
- Rafraîchir `voiceStatus` régulièrement ou via WS.
- Loader visuel pendant `joinChannel` (actuellement aucun feedback).
- Gestion d'erreur visible (actuellement silencieuse).
- A11y : icônes `🔊` non perceptibles par lecteur d'écran.

## State & Side effects

- **State local** : `guilds`, `channels`, `expanded`, `autoReconnect`, `voiceStatus`.
- **Context utilisé** : `botStatus`, `effectiveRole`.
- **API appelée** :
  - `GET /api/guilds`,
  - `GET /api/voice/status`,
  - `GET /api/guilds/{id}/channels`,
  - `POST /api/voice/join`,
  - `POST /api/voice/disconnect`,
  - `POST /api/auto-reconnect`.
- **WebSocket** : non.
- **localStorage** : non.

## Dépendances

- **Importe** : `useState`, `useEffect`, `useCallback`, `useApp`, `apiJson`, `apiPost`, `apiFetch` (importé mais inutilisé).
- **Utilisé par** : `App.jsx`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **Aucun feedback visuel** sur les actions (`join`, `disconnect`) — l'utilisateur ne sait pas si ça part. | Spinner + toast. |
| 🟠 | **`apiFetch` importé mais jamais utilisé** — code mort. | Supprimer. |
| 🟠 | **try/catch silencieux** sur 5 appels API — un 403 ne dit rien. | Toaster les erreurs. |
| 🟠 | **`voiceStatus` jamais rafraîchi** entre deux actions explicites — si quelqu'un déplace le bot via Discord directement, l'UI ment. | Refresh sur changement de `botStatus.inVoice` ou via WS. |
| 🟡 | **A11y** : icônes `🔊`, `▾`/`▸` sans `aria-label`. | Améliorer. |
| 🟡 | **Inline styles** envahissants. | Classes CSS. |
| 🟡 | **Pas de cache TTL** sur les channels — si un channel est ajouté côté Discord, on ne le verra pas tant qu'on n'aura pas refresh. | TTL ou bouton refresh. |
| 🟡 | `setExpanded(prev => ({ ...prev, [guildId]: !prev[guildId] }))` quand `channels[guildId]` existe — pourquoi pas dans une seule passe ? | Refacto mineur. |

## Notes alternatives

- Liste hiérarchique guild → channel justifierait un composant récursif `<ChannelTree>`.
