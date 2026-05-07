# `SetupTab.jsx`

> **Génération URL viewer OBS** sécurisée — basée sur session ID temporaire (24h).
> 📂 `client/src/components/tabs/SetupTab.jsx`
> 🔗 Module : [`tabs/`](./README.md)

## Résumé

Onglet **admin** (cf. `TabBar`). Permet de générer une URL `viewer.html?s={sessionId}` pour un token donné, sans exposer le token brut. Le `sessionId` vient de `POST /api/viewer-session` et expire après 24h côté backend.

UX : sélecteur de token → bouton "Générer l'URL" → affichage de l'URL + boutons Copier / Ouvrir.

## Composants / Hooks exportés

### `SetupTab({ toast })`

**Props attendues** :
- `toast: (msg) => void`.

**Comportement actuel** :
- 3 states locaux : `viewerToken`, `viewerUrl`, `genLoading`.
- Auto-select du premier token si non défini (`useEffect[tokens, viewerToken]`).
- `generateViewerUrl` : `POST /api/viewer-session { userToken }` → `${base}/viewer.html?s=${sessionId}`.
- `copyUrl` : `navigator.clipboard.writeText` + toast.
- `openViewer` : `window.open(url, '_blank')`.

**Comportement attendu (contrat)** :
- L'URL est valide 24h. Le frontend ne réindique pas l'expiration.
- Si l'utilisateur navigue ailleurs et revient, `viewerUrl` reste mais peut être expirée silencieusement.

**Améliorations possibles** :
- Afficher la date d'expiration.
- Bouton "Copier" → indicateur visuel de succès.
- Régénérer en cas d'expiration détectée.
- Lister les sessions actives.

## State & Side effects

- **State local** : `viewerToken`, `viewerUrl`, `genLoading`.
- **Context utilisé** : `configData`, `myToken` (lu mais inutilisé).
- **API appelée** : `POST /api/viewer-session`.
- **WebSocket** : non.
- **localStorage** : non.

## Dépendances

- **Importe** : `useState`, `useEffect`, `useApp`, `apiJson`, `apiPost`, `getApiBase`.
- **Utilisé par** : `App.jsx`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **`myToken` lu du contexte mais jamais utilisé**. | Retirer du destructure. |
| 🟠 | **`apiJson` importé mais inutilisé**. | Retirer. |
| 🟠 | **Pas d'indicateur d'expiration** — l'utilisateur peut copier une URL périmée. | Afficher "valable jusqu'à ...". |
| 🟡 | **`navigator.clipboard.writeText`** sans fallback (peut échouer en HTTP non-secure). | Try/catch + fallback. |
| 🟡 | **Inline styles**. | CSS. |

## Notes alternatives

- Pour partager rapidement, un QR code de l'URL serait pratique (équivalent OBS-mobile).
