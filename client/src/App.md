# `App.jsx`

> **Router custom + composant principal `ControlApp`** — orchestre tout le panneau de contrôle.
> 📂 `client/src/App.jsx`
> 🔗 Module : [`src/`](./README.md)

## Résumé

Deux responsabilités dans ce fichier :

1. **Routing custom ultra-simple** : la constante `IS_POSITIONER = window.location.pathname === '/positioner'` est évaluée **une seule fois au module load**. Si vrai → on rend `<PositionerApp />`, sinon `<ControlApp />`. Cette stratégie évite d'embarquer `react-router` mais sacrifie toute navigation client.
2. **Composant `ControlApp`** : structure complète du panneau (header + sidebar vocale + barre d'onglets + 9 onglets switch + 2 modaux + toasts). Bootstrap l'auth (`/auth/me`), récupère le `botInfo`, démarre le polling levels (100ms) et la connexion WebSocket, gère le state d'onglet actif et le token utilisateur du modal de configuration.

## Composants / Hooks exportés

### `ControlApp` (sans props)

**Brève** : composant racine du panneau de contrôle.

**Comportement actuel** :
- `useEffect` au mount avec deps `[]` (volontairement) : appelle `/auth/me` et `/bot-info` ; remplit le contexte (role, tier, user, token, tierLimits) ; si l'auth échoue, force `effectiveRole = 'viewer'`.
- Démarre `usePollLevels(100)` (polling permanent).
- Démarre `useWebSocket(msg => …)` qui pousse les notifs reçues.
- 4 states locaux : `activeTab` ('avatars' par défaut), `obsModalOpen`, `settingsToken`, `botInfo`.
- Rend `<Header>` + `<VoiceSidebar>` + `<TabBar>` + onglet actif + 2 modaux conditionnels + `<ToastContainer>`.

**Comportement attendu (contrat)** :
- Loader visuel pendant le bootstrap auth (actuellement absent — l'app affiche d'abord en mode `viewer`).
- Si `effectiveRole` change, l'onglet actif doit rester valide pour ce rôle (cf. filtrage dans `TabBar`). Le risque actuel : on peut être bloqué sur un onglet que `TabBar` ne rend plus mais que `ControlApp` instancie quand même.

**Améliorations possibles** :
- Extraire `bootstrap()` dans un hook (`useAuthBootstrap`) ou directement dans `AppContext`.
- Ajouter une garde de cohérence : si `activeTab` n'est plus visible pour ce rôle → revenir à `avatars`.
- Mettre `IS_POSITIONER` derrière `useMemo`/lazy pour permettre à terme une vraie navigation.

### `App` (default export, sans props)

**Brève** : wrapper qui choisit entre `<PositionerApp />` et `<ControlApp />` selon le pathname.

## State & Side effects

- **State local (ControlApp)** : `activeTab`, `obsModalOpen`, `settingsToken`, `botInfo`.
- **Context utilisé** : `setAuthRole`, `setEffectiveRole`, `setMyToken`, `setTier`, `setTierLimits`, `setAuthUser`.
- **API appelée** : `GET /auth/me`, `GET /bot-info`.
- **WebSocket** : oui (via `useWebSocket`).
- **localStorage** : non (ici).

## Dépendances

- **Importe** : `useState`, `useEffect`, `useApp`, `apiJson`, `getApiBase`, `PositionerApp`, `usePollLevels`, `useWebSocket`, `useToast`, `useNotifications`, `Header`, `VoiceSidebar`, `TabBar`, `ToastContainer`, `Modal`/`ModalRow`, 9 onglets, `UserSettingsModal`.
- **Utilisé par** : `main.jsx` (default export).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🔴 | `useEffect(..., [])` lance `bootstrap()` sans cleanup — si le composant est unmount pendant l'await, on appelle `setState` après unmount → warning React. Les setters viennent du context donc l'app est toujours montée mais c'est fragile. | Ajouter un flag `cancelled` ou utiliser un AbortController. |
| 🟠 | `try { … } catch {}` silencieux sur `/auth/me` et `/bot-info` — impossible de distinguer "non connecté" de "backend down". | Logger ou toaster les erreurs autres que `401`. |
| 🟠 | `IS_POSITIONER` capturé au module load → un re-render après `history.pushState` ne change rien. Pas grave aujourd'hui (2 routes), mais piège futur. | Utiliser `useSyncExternalStore` ou un mini hook `useLocation`. |
| 🟡 | Pas de loader pendant le bootstrap → flicker `viewer` → role réel. | Render un splash conditionnel. |
| 🟡 | 9 onglets tous montés/démontés à chaque switch → state local des onglets perdu (ex: `selectedToken` dans AudioTab). | Utiliser `display: none` ou `<Suspense>` avec `lazy()`. |
| 🟡 | Inline styles `flex: 1, overflow: 'auto'` au lieu de classes CSS. | Déplacer dans `styles.css`. |

## Notes alternatives

- **Code-splitting** des onglets : chaque tab pourrait être chargé en `lazy()` pour réduire le bundle initial.
- **Routing** : un mini `useState(pathname)` + `popstate` listener permettrait une vraie navigation deep-link (ex: `/admin`, `/sessions`).
