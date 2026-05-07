# `positioner/`

> **App `/positioner`** — éditeur visuel de positions de frames PNG (drag, sliders X/Y/scale).
> 🔗 Parent : [`components/`](../README.md)

## Vue d'ensemble

Sous-app entièrement séparée de `ControlApp`. Sélectionnée par `App.jsx` quand `window.location.pathname === '/positioner'`. Reproduit fidèlement le comportement du legacy `positioner.html` : drag & drop des frames sur un canvas, sliders X/Y/Scale par frame, persistance dans `localStorage` (clé basée sur slug + state), notification du viewer via `BroadcastChannel('pngtuber-positions')`.

Les paramètres viennent de l'URL : `?t=TOKEN&state=STATE&w=500&h=500&slug=SLUG`. Lus une seule fois au module load (constantes).

## Fichiers

| Fichier | Brève | Doc complète |
|---------|-------|--------------|
| `PositionerApp.jsx` | Le composant root de la route `/positioner`. | [PositionerApp.md](./PositionerApp.md) |
| `positioner.css` | Styles dédiés à cette app. | — (CSS, pas de doc) |

## Architecture interne

```
PositionerApp
├─ useEffect [USER_ID]              → fetch /frames/:t puis /levels (pour displayName)
├─ useEffect [stateFrames]          → attache mousedown/move/up sur chaque layer (AbortController)
├─ useEffect [stateFrames, sel]     → applique transforms initiaux au DOM
├─ render
│   ├─ <header> avec badges + boutons Reset/Save
│   ├─ <sidebar>
│   │    ├─ canvas size inputs
│   │    ├─ liste frames cliquables (positioner-frame-card)
│   │    └─ panel transform (sliders X/Y/S + reset axe)
│   └─ <canvas-area>
│        └─ <layers> (silent fond + stateFrames draggables)
```

**Particularité** : le composant utilise massivement la **mutation DOM directe** (`document.getElementById('pos-sl-x').value = ...`) pendant le drag pour atteindre 60 fps sans déclencher de re-renders React. C'est volontaire mais à double tranchant.

## Audit du dossier

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🔴 | **Mutations DOM directes contre React** : `selectFrame` set `img.style.opacity` puis le re-render React peut écraser. Comportement instable selon ordre. | Confier à React (state) ou totalement au DOM (pas mixé). |
| 🟠 | **`document.getElementById('pos-sl-x')`** : si plusieurs instances coexistent (théoriquement non, mais dev avec HMR…) → collision id. | Utiliser refs locales. |
| 🟠 | `selectedFile` géré à la fois par state ET par ref (`selectedFileRef.current = file` dans plusieurs endroits) → source de vérité ambiguë. | Choisir un seul. |
| 🟡 | Constantes URL parsées **au module load** — pas de réactivité aux changements (peu critique en pratique). | RAS. |
