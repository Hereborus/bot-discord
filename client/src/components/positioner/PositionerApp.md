# `PositionerApp.jsx`

> **Éditeur visuel de positions de frames PNG** — app `/positioner`.
> 📂 `client/src/components/positioner/PositionerApp.jsx`
> 🔗 Module : [`positioner/`](./README.md)

## Résumé

Composant volumineux (647 lignes) qui reproduit fidèlement le legacy `positioner.html`. Affiche un canvas avec :
- Frame **silent** (fond de référence opaque),
- Frames de l'**état courant** (dragables, semi-transparentes, frame sélectionnée plus visible),
- Crosshair de centrage.

Sidebar gauche :
- Inputs taille canvas (W × H),
- Liste cliquable des frames de l'état avec position courante affichée,
- Panel "transform" : sliders X (-500 à 500), Y (-500 à 500), Scale (0.1 à 3) + reset par axe.

Header : badges état/user, toast "Sauvegardé", boutons "Reset tout" / "Sauvegarder".

Persistence : `localStorage[pos__{slug}__{state}__{file}] = { x, y, s }`. Sauvegarde déclenchée par : drag end, slider reset, bouton save explicite. Notifie aussi `viewer.html` (autre fenêtre) via `BroadcastChannel('pngtuber-positions')`.

## Composants / Hooks exportés

### `PositionerApp()` (sans props)

**Brève** : composant root de la route `/positioner`.

**Comportement actuel** :

**Constantes lues au module load** (depuis `window.location.search`) :
- `USER_ID` (param `t` ou `userId`),
- `STATE` (défaut `'low'`),
- `INIT_W` / `INIT_H` (défaut 500),
- `USER_SLUG` (défaut = 8 premiers caractères de `USER_ID`),
- `API_BASE = window.location.protocol + '//' + window.location.host`.

**State local** :
- `stateFrames`, `silentFrames` (de `/frames/:t`),
- `displayName` (de `/levels`),
- `selectedFile` (frame courante),
- `canvasW`, `canvasH` (sliders d'inputs),
- `toastVisible` (badge "Sauvegardé"),
- `error` (cas fetch échoué).

**Refs** :
- `positionsRef.current = { [file]: { x, y, s } }` — mutable pour drag fluide,
- `layersContainerRef` — container DOM des layers,
- `abortCtrlRef` — `AbortController` pour cleanup mousemove/mouseup,
- `selectedFileRef` — sync avec `selectedFile` pour les closures de drag.

**Effets** :
1. `useEffect[selectedFile]` → sync `selectedFileRef`.
2. `useEffect[]` → fetch `/frames/:t` puis `/levels` ; init `positionsRef` depuis localStorage.
3. `useEffect[stateFrames, saveAll]` → attache `mousedown` sur chaque layer + `mousemove/mouseup` window via AbortController. À l'unmount/re-render, abort. Le drag mute `positionsRef` et **manipule directement le DOM** (`img.style.transform`, sliders, indicateurs). À `mouseup`, `saveAll()`.
4. `useEffect[stateFrames, selectedFile]` → applique tous les transforms via DOM après changement.

**Mutations DOM directes** (volontaires pour la perf) :
- `applyTransformDOM(container, file, pos)` — set `img.style.transform`.
- `updateFramePosDOM(container, file, pos)` — met à jour l'indicateur textuel `[data-fpos="..."]`.
- `updateSlidersDOM(pos)` — set `value`/`textContent` des sliders et `<span>` valeur.

**Comportement attendu (contrat)** :
- Sauvegarde atomique : tous les `pos__{slug}__{state}__{file}` sont écrits ensemble.
- `BroadcastChannel('pngtuber-positions').postMessage({ userId, state })` après chaque save.
- L'utilisateur peut éditer une frame à la fois (`selectedFile`) ; les autres restent à 35 % d'opacité.
- Sans `USER_ID` → message d'erreur "userId manquant".

**Améliorations possibles** :
- Migrer entièrement le drag vers React (`useState` + `requestAnimationFrame`).
- Sortir les `id="pos-sl-x"` au profit de refs locales.
- Garder un seul nom de paramètre (`t` ou `userId`).
- Utiliser un AbortController plus fin (par layer, pas global).
- Loader pendant le fetch initial.

## State & Side effects

- **State local** : (cf. ci-dessus, 6 useState).
- **Context utilisé** : aucun (autonome).
- **API appelée** : `GET /frames/:t`, `GET /levels`.
- **WebSocket** : non.
- **localStorage** : oui — clés `pos__{slug}__{state}__{file}`.
- **BroadcastChannel** : `pngtuber-positions` (post `{ userId, state }`).

## Dépendances

- **Importe** : `useState`, `useEffect`, `useRef`, `useCallback`, `./positioner.css`.
- **Utilisé par** : `App.jsx` (default export quand `IS_POSITIONER`).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🔴 | **Source de vérité ambiguë** : `selectedFile` (state) + `selectedFileRef` (ref) écrits indépendamment. Risque de désynchro. | Choisir l'un, l'autre dérivé. |
| 🔴 | **Mutations DOM directes** mélangées avec re-renders React → un re-render écrase les opacités/transforms posés manuellement (cas `selectFrame` / `useEffect[stateFrames, selectedFile]`). | Tout React ou tout DOM. |
| 🟠 | **`document.getElementById('pos-sl-x')`** — fragile (collision id, instances multiples), pas idiomatique React. | `useRef`. |
| 🟠 | **`useEffect[]` pour le fetch initial** : pas d'`AbortController`, pas de cleanup, pas de loader visuel. | Standard fetch + abort + state `loading`. |
| 🟠 | **`esc(s)` défini mais utilisé seulement dans `{esc(f.file)}`** dans un context React (où l'échappement est automatique). | Code mort. |
| 🟠 | **`setSelectedFile(f => f)` pour forcer un re-render** dans `resetAll` — anti-pattern. | Mettre à jour un counter dédié. |
| 🟡 | **Inputs canvas size sans validation** — `parseInt(value) || 500` accepte des valeurs aberrantes. | Min/max + clamp. |
| 🟡 | **Pas de `try/catch` sur `localStorage.setItem`** — quota dépassé = throw silencieux côté `saveAll`. | Wrapper. |
| 🟡 | **Touche Echap / Ctrl+S** non gérées. | Raccourcis utiles. |
| 🟡 | **`broadcastSave` réessaye à chaque save** — `new BroadcastChannel(...)` à chaque appel. Pourrait être créé une fois. | Ref. |

## Notes alternatives

- Refonte pure-React utilisable avec `react-rnd` ou `react-draggable` simplifierait drastiquement.
- Stockage côté serveur (au lieu de localStorage) éviterait la perte sur changement de navigateur.
