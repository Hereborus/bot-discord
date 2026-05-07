# `index.html`

> **Une ligne** : **FICHIER LEGACY MASSIF (4804 lignes / 268 KB)** — ancien panneau de contrôle monolithique (HTML + CSS inline + JS inline) que CLAUDE.md déclare supprimé mais qui existe encore physiquement à la racine.
> 📂 `index.html`

## Résumé

Le panneau de contrôle initial du PNGTuber Bot — onglets (Avatars, Audio Config, Expérimentation, Setup), sidebar Voice, modale notifications, gestion subscriptions, etc. Tout en un seul fichier monolithique.

D'après CLAUDE.md (lignes 35 et 95) :
> "The control panel has been fully migrated to a React app in `client/`. The legacy `index.html` has been removed."
> "Les fichiers legacy (`index.html`, `script.js`, `viewer.js`, `positioner.js`) ont été supprimés lors de la migration."

**REALITÉ** : le fichier est encore présent à la racine. Vérifions s'il est servi.

## Audit "est-il servi ?"

### Servi par le backend Node (`index.js`) ?

**Code de routing statique pertinent** (`index.js` L1567-1582) :
```js
// 1. Assets Vite — depuis DIST_ROOT
if (REACT_BUILT && pathname.startsWith('/assets/')) { ... }
// 2. Fichiers physiques depuis SOURCE_ROOT
const fpReal = path.resolve(path.join(STATIC_ROOT, pathname));
if (serveFile(res, fpReal, req)) return;
// 3. SPA fallback React
if (REACT_BUILT) { serveFile(res, path.join(DIST_ROOT, 'index.html'), req); }
```

Avec `STATIC_ROOT = SOURCE_ROOT` (= la racine du projet), une requête `GET /` :
1. Devient `/index.html` (L1551).
2. Étape 1 saute (pas un `/assets/...`).
3. **Étape 2** : tente de servir `<racine>/index.html` (CE FICHIER) avant le SPA fallback !
4. Étape 3 (React fallback) atteinte UNIQUEMENT si étape 2 échoue.

**Résultat** : en dev local hors Docker, le legacy `index.html` est servi en priorité ! Le React build n'est servi que si `index.html` racine est absent.

### Servi par le Dockerfile ?

**NON** — le Dockerfile ne copie PAS `index.html` (`COPY styles.css viewer.html viewer.js ./` ligne 38) → en prod conteneurisée, seul le React build (depuis `dist/`) est accessible.

### Référencé ailleurs ?

- `index.js:1525` : `AUTH_PAGES = ['/index.html', '/']` — la route `/index.html` est gardée pour compat URL.
- `index.js:1551` : redirection `/` → `/index.html`.
- `index.js:1587` : log `Config UI : ${BASE_URL}/index.html`.
- `index.js:1925` : message console `configure-le via ${BASE_URL}/index.html`.
- `client/src/context/AppContext.jsx:5` : commentaire `miroir exact de DEFAULT_AUDIO_CONFIG dans index.html` — référence morte à la valeur historique.
- `client/index.html:7` : `<link rel="stylesheet" href="/styles.css" />` (réutilisation de la feuille de style — index.html legacy n'est PAS référencé).

## Sections / Composants principaux du fichier legacy

### Header (L10-46)
Logo, indicator API, auth-info, notifications bell, modale OBS URL, bouton Viewer.

### App layout (L48-)
- **Voice sidebar** (L51-62) : guildes, statut, auto-reconnect.
- **Tabs bar** (L67-80) : Accueil, Audio Config, Expérimentation, Setup.

### Onglets (estimés via volume)
1. **AvatarsTab** (gestion des avatars uploadés)
2. **AudioConfigTab** (thresholds, blink, émotions)
3. **ExperimentationTab** (probablement debug/calibration)
4. **SetupTab** (bot token, permissions, subscriptions, sessions)

### Modaux
- OBS URL generator
- User settings (positionner)
- Notifications dropdown

### Inline JS (~3500+ lignes estimées)
Toute la logique frontend était embarquée. Le commentaire `client/src/context/AppContext.jsx:5` confirme que `DEFAULT_AUDIO_CONFIG` était défini dans ce fichier.

## Dépendances
- **Importe** : `styles.css`
- **Utilisé par** : potentiellement servi en dev local hors Docker (cf. analyse ci-dessus).
- **Remplacé par** : `client/` (React app) → `dist/index.html` après `npm run build:ui`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🔴 | **Présent à la racine alors que CLAUDE.md (L35, L95) le déclare SUPPRIMÉ** — contradiction documentation/code | Supprimer réellement le fichier OU corriger CLAUDE.md |
| 🔴 | **Servi en priorité sur le React build en dev local** (logique de fallback static→SPA) — peut afficher l'ancienne UI silencieusement | Supprimer ce fichier OU exclure explicitement `index.html` racine du `serveFile` |
| 🟠 | 268 KB de code mort versionné dans git | `git rm index.html` |
| 🟠 | Le Dockerfile ne le copie pas mais le `.dockerignore` ne l'exclut pas non plus → désordre | Si gardé : ajouter `index.html` au `.dockerignore` pour clarifier |
| 🟡 | `client/src/context/AppContext.jsx:5` mentionne ce fichier comme source de vérité historique pour `DEFAULT_AUDIO_CONFIG` — ce commentaire deviendra cassé après suppression | Supprimer le commentaire ou le mettre à jour |
| 🟡 | Les `console.log` du backend (L1587, L1925) suggèrent à l'utilisateur d'aller sur `${BASE_URL}/index.html` — URL qui devra rester valide (la route `/` déjà couvre ça) | Mettre à jour les messages : `${BASE_URL}/` |

## Notes alternatives

**Plan de suppression propre** :
1. `git rm index.html` (4804 lignes éliminées d'un coup).
2. Mettre à jour `index.js` L1587 + L1925 pour pointer sur `${BASE_URL}/` au lieu de `/index.html`.
3. Mettre à jour `index.js` L1525 : `AUTH_PAGES = ['/']` (retirer `/index.html`).
4. Mettre à jour le commentaire `AppContext.jsx:5`.
5. Tester en dev local : `npm run dev:ui` (port 5173) ET `npm run dev:api` (port 3000) → vérifier que `/` sert bien le React.
6. Tester en Docker : `docker compose up --build` → vérifier idem.
7. CLAUDE.md devient véridique.

**Si suppression refusée** : Au minimum, ajouter au début de `index.html` :
```html
<!-- ⚠️ FICHIER LEGACY — ne plus modifier — voir client/ pour le panel React actif -->
```
