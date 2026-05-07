# `viewer.html`

> **Une ligne** : Page HTML standalone (16 lignes) servant de browser source pour OBS — affiche l'avatar PNGTuber animé en plein écran.
> 📂 `viewer.html`

## Résumé

Page HTML squelette minimale qui charge `styles.css` (legacy) et `viewer.js` (en module ES). Le script `viewer.js` injecte tout le contenu dynamique (avatars, frames, debug overlay) dans `<div id="stage">`.

Statut : **non migrée vers React** par choix volontaire — usage OBS browser source = besoin d'un fichier statique simple, sans bundler à pré-charger.

## Sections / Éléments DOM

### `<div id="stage">`
**Brève** : Conteneur principal injecté par `viewer.js`. Reçoit la classe `single-user` quand `?t=<token>` est passé en query param (avatar plein écran).

### `<div id="err">`
**Brève** : Affiche les erreurs réseau (fetch /levels échoué, etc.). Visible via classe `.on`.

### `<div id="debug-overlay">`
**Brève** : Overlay debug top-bar montrant raw dB, smooth dB, status, emotion, frame affichée. Activé via `?debug=1` ou touche `D`.

### `<script type="module" src="viewer.js">`
**Brève** : Charge le viewer JavaScript principal en module ES.

## Query params supportés (gérés par `viewer.js`)

| Param | Rôle | Défaut |
|-------|------|--------|
| `?t=<token>` | Filtre sur un seul utilisateur (mode single-user) | tous |
| `?userId=<token>` | Alias de `t` (rétrocompatibilité) | — |
| `?guild=<guildId>` | Vérifie l'autorisation avatar pour ce serveur | aucun |
| `?s=<sessionId>` | Session sécurisée — résolue via `/api/viewer-session/:id` | aucun |
| `?sourceUrl=<url>` | Endpoint /levels custom | `${origin}/levels` |
| `?poll=<ms>` | Intervalle de polling HTTP fallback | 100ms (min 50) |
| `?size=<css>` | Taille de l'avatar | 200px |
| `?debug=1` | Active l'overlay debug | off |

## Dépendances
- **Importe** : `styles.css`, `viewer.js`
- **Utilisé par** : OBS browser source. URL générée depuis le panneau React (composant `ObsModal` ou équivalent) ou via session sécurisée `/api/viewer-session`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟡 | Charge `styles.css` (1703 lignes — partagé avec le legacy `index.html`) alors que le viewer n'en utilise probablement que ~5% | Extraire un `viewer.css` minimal et le référencer ici |
| 🟡 | Pas de meta `viewport` ni `<base>` — les browser sources OBS sont des Chromium isolés mais une largeur fixe peut être souhaitée | Ajouter `<meta name="viewport" content="width=device-width">` |
| 🟢 | Pas de styles inline (sauf `debug-overlay`) — propre |
| 🟢 | `<script type="module">` : pas de pollution globale, ESM strict |

## Notes alternatives

- **Pourquoi pas migrer en React ?** Les browser sources OBS rendent à 60fps, doivent démarrer en <500ms, et n'ont qu'un seul avatar à afficher. Un bundle React + Vite ajouterait ~50-100KB de runtime sans bénéfice. Le choix de garder ça en vanilla JS est correct.
- **Migration partielle envisageable** : un `viewer.tsx` minimal compilé vers un seul fichier `viewer.js` autonome (sans React DOM) serait possible mais marginal.
