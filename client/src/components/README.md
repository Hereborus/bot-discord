# `components/`

> **Tous les composants visuels** — organisés par rôle (layout, UI primitifs, onglets, avatars, positioner).
> 🔗 Parent : [`src/`](../README.md)

## Vue d'ensemble

5 sous-dossiers, chacun avec un rôle distinct :

- **`layout/`** — structure générale persistante (header haut, sidebar gauche, barre d'onglets).
- **`ui/`** — primitives réutilisables (modal, toast, cloche notif).
- **`avatars/`** — composants spécifiques aux cartes utilisateurs et au modal de configuration de frames.
- **`tabs/`** — un fichier par onglet du panneau de contrôle (9 onglets).
- **`positioner/`** — l'app `/positioner` (éditeur de positions de frames) + son CSS dédié.

## Sous-dossiers

| Dossier | Rôle | Doc |
|---------|------|-----|
| `layout/` | Header, TabBar, VoiceSidebar. | [layout/README.md](./layout/README.md) |
| `ui/` | Modal, Toast, NotificationBell. | [ui/README.md](./ui/README.md) |
| `avatars/` | UserCard, UserSettingsModal. | [avatars/README.md](./avatars/README.md) |
| `tabs/` | 9 onglets du panneau. | [tabs/README.md](./tabs/README.md) |
| `positioner/` | PositionerApp + CSS. | [positioner/README.md](./positioner/README.md) |

## Architecture interne

```
ControlApp
├─ <Header>            ← layout/Header
├─ <VoiceSidebar>      ← layout/VoiceSidebar
├─ <TabBar>            ← layout/TabBar
├─ <activeTab>         ← l'un des 9 tabs/*Tab
│    ├─ AvatarsTab → <UserCard> (× tokens)
│    │                 └─ avatars/UserCard
│    ├─ AudioTab
│    ├─ ExperimentTab
│    ├─ SetupTab
│    ├─ AdminTab
│    ├─ DbViewTab
│    ├─ SessionsTab
│    ├─ SubscriptionsTab
│    └─ AppTokensTab
├─ <Modal> URL OBS     ← ui/Modal
├─ <UserSettingsModal> ← avatars/UserSettingsModal (lazy)
└─ <ToastContainer>    ← ui/Toast
```

## Audit du dossier

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **Inline styles partout** dans tabs/avatars/ui : duplication massive, pas de thème, pas de responsive. | Extraire dans `styles.css` (ou CSS Modules). |
| 🟠 | **Pas de mémoïsation** sur les composants enfants → `<UserCard>` re-render à chaque tick de polling (10x/s) même si ses props n'ont pas changé. | `React.memo` + comparaison custom sur `levelInfo`. |
| 🟡 | Convention de nommage incohérente : `<UserCard>`/`<TabBar>` (PascalCase) OK, mais certains styles utilisent `kebab-case` (`.profile-card`) côté CSS et d'autres `camelCase` inline. | Choisir une convention. |
| 🟡 | Aucun composant ne gère son propre `loading` / `empty` / `error` de façon homogène — chacun réinvente le pattern. | Composer un `<DataPanel state={...}>` réutilisable. |
