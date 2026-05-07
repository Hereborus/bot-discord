# `UserSettingsModal.jsx`

> **Modal d'upload + suppression de frames PNG par état.**
> 📂 `client/src/components/avatars/UserSettingsModal.jsx`
> 🔗 Module : [`avatars/`](./README.md)

## Résumé

Modal grille (max 800px), ouvert quand `settingsToken` est défini dans `App.jsx`. Affiche **tous** les `allStates` (silent, low/medium/high + leurs `_closed`, plus chaque émotion + son `_silent`). Pour chaque état :

- Liste des frames existantes (mini 48×48 + bouton ✕ rouge en surimpression).
- Bouton 📐 → `window.open('/positioner?t=...&state=...&w=...&h=...')` avec taille canvas issue de `localStorage('pngtuber-canvasSize')`.
- Zone d'upload (drag & drop + `<input type="file" multiple>`) qui POST chaque fichier en `multipart/form-data` à `/upload`.

Le modal se ferme au clic sur l'overlay ou sur le bouton "Fermer".

## Composants / Hooks exportés

### `UserSettingsModal({ token, onClose, toast })`

**Props attendues** :
- `token: string` — token utilisateur ciblé.
- `onClose: () => void`.
- `toast: (msg) => void` — passé en prop drilling depuis `App.jsx`.

**Comportement actuel** :
- 2 states locaux : `uploading{}` (par stateKey), `dragOver: stateKey | null`.
- `upload(stateKey, files)` : pour chaque fichier, POST `multipart`, attend `{ ok, file, url }`, append au state local via `updateConfigData`.
- `deleteFrame(stateKey, file)` : POST `/delete-frame`, retire de la liste locale.
- `openPositioner(stateKey)` : ouvre nouvelle fenêtre.
- Pas de validation client (taille, type, count).

**Comportement attendu (contrat)** :
- L'upload est **séquentiel** dans la boucle `for (const file of files)` — un échec sur une frame stoppe le batch via `try/catch`.
- L'utilisateur final ne voit que `toast(e.message)` côté erreur.

**Améliorations possibles** :
- Upload parallèle (`Promise.allSettled`) pour gros lots.
- Validation client (extension/MIME/taille max).
- Progress bar par fichier (au lieu d'un booléen `uploading`).
- Drag & drop visuel sur tout le modal, pas seulement sur la tuile.
- Confirmation avant `deleteFrame`.

## State & Side effects

- **State local** : `uploading`, `dragOver`.
- **Context utilisé** : `configData`, `updateConfigData`, `audioConfig` (via `useAudioStates`).
- **API appelée** : `POST /upload` (multipart), `POST /delete-frame`.
- **WebSocket** : non.
- **localStorage** : oui — lecture de `pngtuber-canvasSize` pour passer w/h au positioner.

## Dépendances

- **Importe** : `useState`, `useCallback`, `useApp`, `useAudioStates`, `apiFetch`, `apiPost`, `getApiBase`.
- **Utilisé par** : `App.jsx`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | Upload `for…await` sur `try` → première erreur stoppe tout le batch. | `Promise.allSettled` + résultats par fichier. |
| 🟠 | Pas de validation client (taille/type). | Whitelist `image/png|webp` + check size. |
| 🟠 | Pas de confirmation pour `deleteFrame`. | `confirm()` ou bouton 2-step. |
| 🟠 | Inline styles envahissants. | CSS Module. |
| 🟡 | A11y : pas de `aria-modal`, focus trap, Escape. | Cf. `Modal.md`. |
| 🟡 | `localStorage.getItem('pngtuber-canvasSize')` sans `try/catch JSON.parse` global. | Wrapper safe-parse. |
| 🟡 | Frame URL absolue figée (`getApiBase() + data.url`). | Stocker URL relative. |

## Notes alternatives

- Pour gros uploads : `tus-js-client` ou chunked upload.
