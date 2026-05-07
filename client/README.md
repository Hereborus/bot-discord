# `client/`

> **Frontend React 18 + Vite 5** — panneau de contrôle web du bot PNGTuber Discord.
> 🔗 Parent : projet `hereborus-bot/`

## Vue d'ensemble

Application React qui pilote le bot Discord PNGTuber. Sert deux rôles distincts via un router minimaliste basé sur `window.location.pathname` :

- **`/`** (et toute autre route) → `ControlApp` : panneau de contrôle complet (avatars, audio, sessions, admin, etc.).
- **`/positioner`** → `PositionerApp` : éditeur visuel de positions de frames PNG (drag, sliders X/Y/scale).

En **dev**, Vite (port 5173) proxie toutes les routes API vers le backend Node (port 3350). En **prod**, le build est généré dans `../dist/` et c'est Node qui sert `dist/index.html` + `dist/assets/`.

L'app est à 100% same-origin une fois servie en prod. La constante `getApiBase()` permet un override manuel via le champ "BOT" dans le header (debug remote).

## Fichiers à la racine

| Fichier | Brève | Doc complète |
|---------|-------|--------------|
| `package.json` | Dépendances React 18 + Vite 5 ; scripts `dev` / `build` / `preview`. | — (config plate) |
| `vite.config.js` | Config Vite : plugin React, proxy dev des 18 routes API vers `localhost:3350`, `outDir: ../dist/`. | — (config plate) |
| `index.html` | Template HTML minimal Vite (`#root` + `<script type="module">` vers `src/main.jsx`). Charge `/styles.css` depuis le backend. | — (template) |
| `src/` | Code source React (voir [`src/README.md`](./src/README.md)). | [`src/README.md`](./src/README.md) |

## Architecture interne

```
client/
├── index.html              ← entrée Vite (proxie /styles.css)
├── vite.config.js          ← proxy dev + build outDir
├── package.json
└── src/
    ├── main.jsx            ← bootstrap React (StrictMode + AppProvider)
    ├── App.jsx             ← router pathname (/positioner | ControlApp)
    ├── api.js              ← apiFetch / apiJson / apiPost / apiDelete
    ├── context/            ← AppContext (état global)
    ├── hooks/              ← 5 hooks réutilisables
    └── components/
        ├── layout/         ← Header / TabBar / VoiceSidebar
        ├── ui/             ← Modal / Toast / NotificationBell
        ├── avatars/        ← UserCard / UserSettingsModal
        ├── tabs/           ← 9 onglets (1 fichier par onglet)
        └── positioner/     ← PositionerApp (route /positioner)
```

**Data flow** :

1. `main.jsx` monte `<AppProvider>` autour de `<App>`.
2. `App.jsx` (ControlApp) bootstrap l'auth (`/auth/me` + `/bot-info`), démarre `usePollLevels(100)` et `useWebSocket(...)`.
3. `usePollLevels` peuple `levels` + `configData` (frames par token) dans `AppContext`.
4. Chaque onglet lit le state global via `useApp()` et appelle ses propres endpoints `/api/...` au mount.

## Audit du dossier

### Issues transversales

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **Pas de TypeScript** — props non typées, risque de régression silencieuse sur 9 onglets + 8 endpoints. | Migration progressive `.jsx` → `.tsx`, à minima typer `AppContext` et `api.js`. |
| 🟠 | **Pas de tests** (aucun framework configuré). | Ajouter Vitest + React Testing Library, focus sur les hooks (`usePollLevels`, `useWebSocket`). |
| 🟠 | **Pas de gestion d'erreur globale** — pas d'`ErrorBoundary` autour de `<App>`. Une erreur dans un onglet crashe tout. | Ajouter un `ErrorBoundary` dans `main.jsx`. |
| 🟠 | **Styles inline omniprésents** — quasi tous les composants utilisent `style={{...}}` au lieu d'utiliser `styles.css`. Re-renders coûteux + duplication. | Extraire dans des classes CSS. |
| 🟡 | **Pas de lint / format** (ni ESLint ni Prettier configurés). | Ajouter ESLint + plugin React + react-hooks. |
| 🟡 | **Polling 100ms permanent** sur `/levels` même quand l'onglet n'est pas visible. | Désactiver via `document.visibilityState`. |
| 🟡 | **Routing custom sans librairie** — basé uniquement sur `window.location.pathname` évalué une seule fois. Pas de navigation interne. | Acceptable pour 2 routes ; envisager `react-router` si plus. |
| 🟡 | **Versions épinglées avec `^`** sur React + Vite — risque de breaking changes mineurs. | Verrouiller via `package-lock.json` (déjà présent) ; bon. |

### Observations

- **Patron récurrent `try/catch` silencieux** : `try { ... } catch {}` partout, masque les erreurs réseau.
- **Props drilling `toast`** : passé à 7 onglets via prop. Devrait vivre dans le contexte.
- **`apiFetch` vs `apiJson`** : choix incohérent entre fichiers (certains gèrent eux-mêmes le `.json()`).
