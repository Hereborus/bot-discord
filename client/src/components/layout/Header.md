# `Header.jsx`

> **Top bar** — logo, statut API, bloc utilisateur, boutons OBS.
> 📂 `client/src/components/layout/Header.jsx`
> 🔗 Module : [`layout/`](./README.md)

## Résumé

Bandeau supérieur permanent. Affiche le logo, un indicateur de connexion API (dot vert/rouge/gris), un input "BOT" qui permet d'override la base URL via `setApiBase`, le bloc utilisateur (badge tier coloré, username Discord, `<NotificationBell>`, lien "Déconnexion") si connecté, et deux boutons (URL OBS / Viewer) injectés via callbacks.

## Composants / Hooks exportés

### `Header({ onOpenObsModal, onOpenViewer, notifications, onMarkRead, onMarkAllRead })`

**Props attendues** :
- `onOpenObsModal: () => void` — handler pour ouvrir le modal "URL OBS".
- `onOpenViewer: () => void` — handler pour ouvrir l'URL `/viewer.html`.
- `notifications: Notif[]` — passé à `<NotificationBell>`.
- `onMarkRead: (id) => void` — passé à `<NotificationBell>`.
- `onMarkAllRead: () => void` — passé à `<NotificationBell>`.

**Brève** : layout pur, peu de logique.

**Comportement actuel** :
- Lit `apiHost`, `setApiHost`, `apiConnected`, `authUser`, `tier` depuis le contexte.
- `handleApiHostChange` : à chaque keystroke, met à jour le state ET appelle `setApiBase` (mute le singleton de `api.js`). **Effet immédiat** : tous les fetches suivants utilisent la nouvelle base.
- Calcule `dotClass` selon `apiConnected` (`null | true | false`).
- Bloc utilisateur affiché **conditionnellement** sur `authUser`.
- Lien `Déconnexion` est un `<a href="/auth/logout">` direct (full page reload).

**Comportement attendu (contrat)** :
- Le badge `tier` ne s'affiche que si `tier !== 'free'`.
- Le bouton "URL OBS" ouvre un modal externe ; le bouton "Viewer" ouvre une nouvelle fenêtre directement.

**Améliorations possibles** :
- Debounce le `handleApiHostChange` (chaque keystroke = changement immédiat de la base URL → fetches qui partent en plein milieu d'un host invalide).
- Persister `apiHost` dans `localStorage`.
- Indicateur WebSocket (séparé de `apiConnected`).

## State & Side effects

- **State local** : aucun.
- **Context utilisé** : `apiHost`, `setApiHost`, `apiConnected`, `authUser`, `tier`.
- **API appelée** : non directement (mais `setApiBase` change la base de tous les fetches).
- **WebSocket** : non.
- **localStorage** : non (mais devrait pour `apiHost`).

## Dépendances

- **Importe** : `useApp`, `setApiBase`, `NotificationBell`.
- **Utilisé par** : `App.jsx`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **`setApiBase` à chaque keystroke** — pendant qu'on tape "192.168.", des fetches partent vers `http://192.168.` (incomplet). | Debounce 500 ms ou trigger sur blur. |
| 🟠 | **Pas de persistance** de `apiHost` — refresh = perdu. | localStorage. |
| 🟡 | **`<a href="/auth/logout">`** au lieu d'un bouton — full reload non animé. | Soit OK volontairement (clean state), soit faire un fetch + reload. |
| 🟡 | **Inline styles** envahissants pour le bloc user. | Classes CSS. |
| 🟡 | Pas d'aria-label sur le `<input className="api-input">`. | A11y. |

## Notes alternatives

- Le badge `tier` est dupliqué entre `Header` et `SubscriptionsTab` (constante `TIER_COLORS` deux fois). À factoriser.
