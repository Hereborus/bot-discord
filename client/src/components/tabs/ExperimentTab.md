# `ExperimentTab.jsx`

> **Prévisualisation statique** des frames par état pour chaque user.
> 📂 `client/src/components/tabs/ExperimentTab.jsx`
> 🔗 Module : [`tabs/`](./README.md)

## Résumé

Tableau visuel read-only : pour chaque utilisateur de `configData`, affiche en grille tous les `allStates` (silent, low, medium, high + closed + emotions + emotion_silent), avec la **première** frame de chaque liste comme miniature 64×64 et le compteur de frames.

Sert d'inspection rapide / debug pour vérifier qu'on a bien des frames pour chaque état.

## Composants / Hooks exportés

### `ExperimentTab()` (sans props)

**Brève** : grille de prévisualisation.

**Comportement actuel** :
- Lit `configData`, `levels` (importé mais inutilisé), `audioConfig`.
- `useAudioStates(audioConfig)` pour `allStates`, `stateColor`, `isClosedState`, `isEmotionSilent`.
- État vide si aucun token.
- `frames[0].url.replace(getApiBase(), '')` puis re-concaténation : tentative de normaliser une URL absolue vers la base courante.

**Comportement attendu (contrat)** :
- Un état sans frames affiche "vide" (placeholder gris).
- Aucune action — c'est statique.

**Améliorations possibles** :
- Boucle d'aperçu animé sur hover (preview du flipbook).
- Lien vers `<UserSettingsModal>` au clic sur un état.
- Pagination/scroll horizontal pour les longues listes d'émotions.

## State & Side effects

- **State local** : aucun.
- **Context utilisé** : `configData`, `levels` (jamais utilisé), `audioConfig`.
- **API appelée** : non.
- **WebSocket** : non.
- **localStorage** : non.

## Dépendances

- **Importe** : `useApp`, `useAudioStates`, `getApiBase`.
- **Utilisé par** : `App.jsx`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **`levels` lu mais jamais utilisé** → re-render inutile à chaque tick. | Retirer du destructure. |
| 🟠 | **`isClosedState`/`isEmotionSilent` importés mais inutilisés**. | Code mort. |
| 🟠 | **`frames[0].url.replace(getApiBase(), '')` puis re-concat** : si l'URL ne contient PAS la base actuelle (changée via apiHost), le replace est no-op et on double la base. | Stocker URL relative en amont. |
| 🟡 | **Pas d'interaction** — pourrait au moins ouvrir le modal au clic. | UX. |
| 🟡 | **Inline styles**. | CSS. |

## Notes alternatives

- Onglet exclusivement diagnostic — pourrait être réservé à `admin`.
