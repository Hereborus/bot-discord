# `layout/`

> **Structure persistante** — header haut, sidebar gauche (vocal), barre d'onglets.
> 🔗 Parent : [`components/`](../README.md)

## Vue d'ensemble

3 composants montés en permanence dans `ControlApp` (sauf si `IS_POSITIONER`). Tous lisent au moins partiellement `useApp()` :

- **`Header`** : logo, indicateur API, input host override, bloc utilisateur (avatar Discord, tier badge, cloche notif, déconnexion), boutons URL OBS / Viewer.
- **`VoiceSidebar`** : liste des guilds Discord, expansion des channels, join/disconnect, toggle reconnexion auto. **Réservé admin** pour join (clients voient seulement les channels `allowed`).
- **`TabBar`** : 9 onglets filtrés par `effectiveRole`, bouton "Inviter le bot" pour admin si `botInfo.inviteUrl`.

## Fichiers

| Fichier | Brève | Doc complète |
|---------|-------|--------------|
| `Header.jsx` | Top bar (logo, API status, user bloc, boutons OBS). | [Header.md](./Header.md) |
| `TabBar.jsx` | Barre d'onglets filtrée par rôle + bouton invite bot. | [TabBar.md](./TabBar.md) |
| `VoiceSidebar.jsx` | Sidebar guilds + channels Discord + voice controls. | [VoiceSidebar.md](./VoiceSidebar.md) |

## Architecture interne

```
ControlApp
├─ <Header>          (apiHost, apiConnected, authUser, tier, NotificationBell)
├─ <div.app-layout>
│   ├─ <VoiceSidebar>  (botStatus, guilds[], channels[], voiceStatus, autoReconnect)
│   └─ <div.app-main>
│        ├─ <TabBar>   (effectiveRole, botInfo)
│        └─ {activeTab && <Tab*>}
└─ <Modal> + <UserSettingsModal> + <ToastContainer>
```

## Audit du dossier

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **`VoiceSidebar` re-fetch séquentiel** : `loadGuilds` puis polling indirect via context, mais aucun rafraîchissement post-action (sauf manuel). | Trigger refetch sur `botStatus` change. |
| 🟠 | **Header gère mal le tri-état `apiConnected`** : `null | true | false` interprété par concat de classes — peu lisible. | Extraire en helper. |
| 🟡 | **TabBar** : bouton "Inviter le bot" présent uniquement pour admin → un client n'a aucun indice qu'il faudrait peut-être inviter. | Contextualiser le message d'absence. |
| 🟡 | Tous les composants sont **non mémoïsés** → re-render à chaque tick de polling. | `React.memo`. |
