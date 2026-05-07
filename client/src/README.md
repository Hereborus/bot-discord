# `src/`

> **Code source React** — point d'entrée, router minimaliste, helpers API, contexte global, hooks et composants.
> 🔗 Parent : [`client/`](../README.md)

## Vue d'ensemble

Tout le code applicatif vit sous `src/`. Trois fichiers à la racine + 4 sous-dossiers :

- `main.jsx` — bootstrap React (StrictMode + AppProvider).
- `App.jsx` — router pathname (`ControlApp` ou `PositionerApp`) + bootstrap auth + lance polling/WS.
- `api.js` — helpers fetch (5 fonctions, base URL configurable).
- `context/` — `AppContext` (état global partagé).
- `hooks/` — 5 hooks custom (polling levels, WS, notifications, toast, dérivation états audio).
- `components/` — UI structurée par rôle (layout, ui, tabs, avatars, positioner).

## Fichiers

| Fichier | Brève | Doc complète |
|---------|-------|--------------|
| `main.jsx` | Bootstrap React 18 (`createRoot` + `<StrictMode>` + `<AppProvider>`). | [main.md](./main.md) |
| `App.jsx` | Router custom basé sur `window.location.pathname` ; `ControlApp` orchestre l'app entière. | [App.md](./App.md) |
| `api.js` | `apiFetch`, `apiJson`, `apiPost`, `apiDelete`, `getApiBase`, `setApiBase`. | [api.md](./api.md) |

## Sous-dossiers

| Dossier | Rôle | Doc |
|---------|------|-----|
| `context/` | État global React Context (auth, audio config, levels, frames). | [context/README.md](./context/README.md) |
| `hooks/` | Hooks réutilisables (polling, WebSocket, notifications, toast, dérivation états). | [hooks/README.md](./hooks/README.md) |
| `components/` | Tous les composants visuels organisés par rôle. | [components/README.md](./components/README.md) |

## Architecture interne

```
main.jsx
  └─ <StrictMode>
       └─ <AppProvider>          ← context/AppContext.jsx
            └─ <App>             ← App.jsx
                 ├─ <PositionerApp>    si pathname === '/positioner'
                 └─ <ControlApp>       sinon
                      ├─ <Header>
                      ├─ <VoiceSidebar>
                      ├─ <TabBar>
                      ├─ {activeTab === 'avatars' && <AvatarsTab>}
                      ├─ ...8 autres onglets
                      ├─ <Modal> (URL OBS)
                      ├─ <UserSettingsModal> (lazy, si settingsToken)
                      └─ <ToastContainer>
```

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | Aucun `ErrorBoundary` — un throw dans un onglet casse toute l'app. | Wrapper dans `main.jsx`. |
| 🟡 | Routing pathname pris à `module load` (cf. `App.jsx`) → ne supporte pas la navigation client. | Acceptable pour 2 routes. |
| 🟡 | Le contexte expose tous ses setters publiquement → couplage fort. | Exposer plutôt des actions sémantiques. |
