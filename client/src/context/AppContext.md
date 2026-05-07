# `AppContext.jsx`

> **Provider + hook unique** pour tout l'état global de l'app de contrôle.
> 📂 `client/src/context/AppContext.jsx`
> 🔗 Module : [`context/`](./README.md)

## Résumé

Un seul Context React, plat, avec 14 paires `state/setter` exposées + 1 helper (`updateConfigData`). Aucun reducer, aucun découpage, aucune mémoïsation. Le provider est monté une seule fois dans `main.jsx`.

Sert de **single source of truth** pour :
- l'identité utilisateur (Discord OAuth) et son rôle effectif,
- les niveaux audio live de tous les participants (mis à jour 10 fois/s par `usePollLevels`),
- la config audio courante (seuils, émotions, vitesse, hold) — **pré-remplie** depuis le defaut FR `DEFAULT_AUDIO_CONFIG`, puis hydratée par `AudioTab` au changement de token,
- les frames PNG par utilisateur (`configData[token].states`).

## Composants / Hooks exportés

### `AppProvider({ children })` — composant

**Props attendues** :
- `children: ReactNode` — sous-arbre à rendre.

**Brève** : monte le `AppContext.Provider` avec un `value` mémo-naturel (recréé à chaque render — voir audit).

**Comportement actuel** :
- Initialise 13 `useState` :
  - `authRole = 'viewer'`, `effectiveRole = 'viewer'`, `myToken = null`,
  - `tier = 'free'`, `tierLimits = {}`, `authUser = null`,
  - `apiHost = ''`,
  - `audioConfig = DEFAULT_AUDIO_CONFIG` (constante locale),
  - `configData = {}`, `levels = {}`, `botStatus = { connected: false, inVoice: false }`,
  - `apiConnected = null`.
- Définit `updateConfigData(token, updater)` mémoïsé via `useCallback([])` qui :
  - accepte un updater fonction OU un objet partiel,
  - merge avec l'entrée existante (ou `{ displayName: '???', states: {} }`),
  - sans écraser les autres tokens.

**Comportement attendu (contrat)** :
- L'objet `value` devrait être stable entre renders à state inchangé. Aujourd'hui il est recréé à **chaque render**, ce qui force tous les consommateurs à re-render systématiquement.
- `DEFAULT_AUDIO_CONFIG` doit rester en sync avec le défaut backend (cf. `AUDIO_DEFAULT_CONFIG` dans `index.js`) — actuellement codé en dur côté front.

**Améliorations possibles** :
- Mémoïser `value` via `useMemo` (à minima par groupe sémantique).
- Splitter en plusieurs contexts pour limiter les re-renders (cf. audit).
- Charger `DEFAULT_AUDIO_CONFIG` depuis `/api/defaults` au boot.

### `useApp()` — hook

**Brève** : `useContext(AppContext)`. Renvoie l'objet `value` complet.

**Note** : ne fait **pas** de garde sur le contexte null (si `useApp()` est appelé hors `<AppProvider>`, on obtient `null` et la déstructuration crashe).

## State & Side effects

- **State local** : 13 `useState` listés ci-dessus.
- **Context utilisé** : crée le sien.
- **API appelée** : aucune directement (les setters sont remplis par d'autres fichiers).
- **WebSocket** : non.
- **localStorage** : non.

## Dépendances

- **Importe** : `react` (`createContext`, `useContext`, `useState`, `useCallback`).
- **Utilisé par** : quasi tous les composants (`useApp()` est appelé dans 16+ fichiers).
- **Hydraté par** : `App.jsx` (auth bootstrap), `usePollLevels.js` (`levels`, `botStatus`, `apiConnected`, `configData`), `AudioTab.jsx` (`audioConfig`), `Header.jsx` (`apiHost`).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🔴 | **`value` recréé à chaque render** → tous les consommateurs re-render à chaque changement de **n'importe quel** state, y compris `levels` (toutes les 100 ms). C'est la principale cause de re-renders inutiles dans l'app. | `useMemo(() => ({...}), [authRole, effectiveRole, ...])` ou splitter en plusieurs contexts. |
| 🟠 | **Aucune garde** dans `useApp()` — un appel hors provider renvoie `null` silencieusement. | `if (!ctx) throw new Error('useApp must be inside AppProvider')`. |
| 🟠 | **Tous les setters exposés publiquement** — n'importe quel composant peut muter `effectiveRole`, `tier`, etc. → fuite de logique métier. | Exposer des actions (`login`, `logout`, `applyAuth(me)`) plutôt que les setters bruts. |
| 🟠 | `DEFAULT_AUDIO_CONFIG` dupliqué côté front et backend — risque de drift au prochain ajout d'un seuil ou d'une émotion. | Charger depuis API + fallback statique. |
| 🟡 | `apiHost` est un doublon de `_customBase` dans `api.js` — deux sources de vérité. | Synchroniser ou ne garder qu'une seule. |
| 🟡 | `apiConnected = null` n'est interprété nulle part autrement que par `Header` (dot grise). Sémantique tri-état pas évidente. | Documenter ou passer à un enum (`'idle'` / `'ok'` / `'err'`). |
| 🟡 | Pas de persistance — refresh perd `apiHost`. | localStorage léger. |

## Notes alternatives

- **Zustand** ou **Jotai** simplifieraient (selecteurs fins → moins de re-renders).
- **`useReducer`** + actions typées suffirait pour cadrer les mutations sans dépendance externe.
- Pour l'audio config, un contexte dédié `<AudioConfigProvider>` (consommé seulement par 3 onglets) serait pertinent.
