# `hooks/`

> **Hooks React custom** — 5 hooks réutilisables (polling, WS, notifications, toast, dérivation états audio).
> 🔗 Parent : [`src/`](../README.md)

## Vue d'ensemble

Ces hooks encapsulent la logique transversale réutilisable :

- **`usePollLevels`** : polling permanent de `/levels` toutes les `interval` ms ; auto-charge les frames des nouveaux utilisateurs détectés. Nourrit le contexte global (`levels`, `botStatus`, `apiConnected`, `configData`).
- **`useWebSocket`** : connexion WS auto-reconnectante (5s après close), parse JSON et délègue à un callback.
- **`useNotifications`** : CRUD léger sur les notifications (`/api/notifications`) + helper `push()` pour les notifs WS temps réel.
- **`useToast`** : file FIFO de toasts auto-dismiss (3s par défaut).
- **`useAudioStates`** : *pas un hook React* (pas de hooks internes) — simple fonction de dérivation à partir de `audioConfig`. Calcule `audioStates`, `allStates`, helpers `isClosedState`, `isEmotion`, `stateColor`, etc.

## Fichiers

| Fichier | Brève | Doc complète |
|---------|-------|--------------|
| `useAudioStates.js` | Dérive listes d'états et helpers depuis `audioConfig`. Pas un vrai hook. | [useAudioStates.md](./useAudioStates.md) |
| `useNotifications.js` | Charge / mark-read / push notifications. | [useNotifications.md](./useNotifications.md) |
| `usePollLevels.js` | Polling `/levels` + auto-load des frames. | [usePollLevels.md](./usePollLevels.md) |
| `useToast.js` | Toasts auto-dismiss. | [useToast.md](./useToast.md) |
| `useWebSocket.js` | WS auto-reconnect, callback `onMessage`. | [useWebSocket.md](./useWebSocket.md) |

## Architecture interne

```
ControlApp (App.jsx)
  ├─ usePollLevels(100)        → mute context (levels, configData…)
  ├─ useWebSocket(onMsg)       → callback push notifications
  ├─ useToast()                → { toasts, toast(msg) }
  └─ useNotifications()        → { notifications, load, markRead, markAllRead, push }

UserCard / AudioTab / ExperimentTab / UserSettingsModal
  └─ useAudioStates(audioConfig)  → { audioStates, allStates, stateColor, isClosedState… }
```

## Audit du dossier

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🔴 | `usePollLevels` poll toutes les 100 ms en permanence, **même tab cachée**. Énorme charge réseau + CPU inutile. | Stopper sur `document.visibilitychange = hidden`. |
| 🟠 | `usePollLevels` charge `/frames/{token}` pour chaque nouveau token sans annulation : si l'utilisateur disparaît avant la fin du fetch, on stocke quand même → fuite mémoire mineure. | `AbortController`. |
| 🟠 | `useWebSocket` n'expose pas l'état de connexion → impossible d'afficher un indicateur "WS down" dans l'UI. | Renvoyer `{ status, lastMessage }`. |
| 🟡 | `useAudioStates` recalcule tout à chaque render (sort + flatMap). Pourrait être `useMemo`-isé. | `useMemo`. |
| 🟡 | `useToast` repose sur `setTimeout` non-tracké → ne nettoie pas si l'unmount intervient avant l'expiration (peu impactant). | Stocker les ids et clear sur unmount. |
