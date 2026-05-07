# `styles.css`

> **Une ligne** : Feuille de style legacy (1703 lignes) partagée entre l'ancien `index.html` et `viewer.html` — servie aussi par le React build via `client/index.html`.
> 📂 `styles.css`

## Résumé

Stylesheet historique de l'application (CSS variables, layouts du panneau, composants OBS viewer, animations, modaux). Survit à la migration React car :
1. **`viewer.html`** (toujours en vanilla pour OBS) la référence en direct.
2. **`client/index.html`** (Vite dev + build) la référence aussi via `<link href="/styles.css">` — donc le React app la consomme aussi pour les styles communs (theme tokens, helpers).

## Sections probables (basé sur le volume et les références)

| Section | Lignes approx. | Usage |
|---------|----------------|-------|
| CSS variables (`--bg`, `--accent`, etc.) | ~50 | Theme tokens — réutilisés par React via `var(--xxx)` |
| Layout app (header, sidebar, tabs) | ~300 | Legacy `index.html` UNIQUEMENT (React refait son layout) |
| Composants UI legacy (boutons, inputs, modaux) | ~400 | Legacy `index.html` |
| Avatar viewer (`#stage`, `.avatar`, `.vis`, transitions) | ~150 | `viewer.html` ✓ encore actif |
| Positioner | ~100 | Legacy `positioner.html` (supposé supprimé selon CLAUDE.md) |
| Animations / keyframes | ~100 | Probablement partagées |
| Cas particuliers (notifications, voice sidebar) | ~600 | Legacy `index.html` UNIQUEMENT |

## Dépendances
- **Référencé par** :
  - `viewer.html:6` (legacy mais ACTIF — usage OBS standalone)
  - `index.html:7` (legacy à supprimer)
  - `client/index.html:7` (React app — actif)
- **Servi par** : `index.js` (handler statique sur `STATIC_ROOT`) — proxifié en dev par Vite (`client/vite.config.js:27`).
- **Note** : `client/src/components/positioner/positioner.css` est un extrait dédié du Positioner.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **1703 lignes pour 3 consommateurs** — la majorité est dédiée au legacy `index.html` (~70% si on suppose la même ratio que viewer/positioner extraits) | Auditer ce qui est *réellement* utilisé après suppression de `index.html` legacy |
| 🟡 | Couplage : la moindre modification visuelle dans le React peut affecter le viewer OBS via les variables partagées | Extraire `tokens.css` (variables) + `viewer.css` (rendu OBS) + laisser le reste mourir avec le legacy |
| 🟡 | Pas de PostCSS / autoprefixer / minification documentée — fichier servi tel quel | Si le React Vite ne le bundle pas (chargé via `<link>` direct), ajouter une étape de minification au build |
| 🟡 | Surface CSS importante = CSP `style-src 'self'` OK mais pas de `nonce` pour les styles inline résiduels (`viewer.html` a un `style=...` sur le debug overlay) | Considérer migrer vers CSS Modules / styled-components côté React |

## Notes alternatives

**Plan de splitting** :
1. **`styles/tokens.css`** : variables CSS uniquement (theme colors, sizes, fonts) → consommé par React + viewer.
2. **`styles/viewer.css`** : tout ce qui touche `#stage`, `.avatar`, `.vis`, animations OBS → référencé par `viewer.html`.
3. **`styles/legacy.css`** : tout le reste → supprimé avec `index.html` legacy.

Aucune urgence, mais à prévoir dans le sprint de finalisation de la migration React.
