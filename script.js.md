# `script.js`

> **Une ligne** : **FICHIER LEGACY ORPHELIN** — widget PNGTuber primitif (170 lignes) référencé NULLE PART dans le code actif, à supprimer.
> 📂 `script.js`

## Résumé

Script JavaScript vanilla qui implémentait une version primitive du widget PNGTuber : poll de `/levels`, génération de cartes par utilisateur, upload local d'images on/off pour 4 états (silent/low/medium/high). Largement antérieur à `viewer.js` et `viewer.html`.

L'en-tête du fichier (L1-18) déclare lui-même son statut LEGACY :
> "Ce fichier est conservé pour compatibilité / historique. Les pages principales actuelles utilisent surtout des scripts inline dans `index.html` et `viewer.html`."

## Audit "est-ce orphelin ?"

**Recherche exhaustive** : aucune référence à `script.js` dans :
- Aucun `<script src="script.js">` nulle part
- Aucun import dans `viewer.html` ni `client/`
- Aucun `COPY ... script.js` dans le `Dockerfile`
- Aucun fetch / require dans `index.js` ou `src/`

**Seules occurrences trouvées** :
1. `script.js:2` — son propre commentaire d'en-tête
2. `CLAUDE.md:95` — déclaré comme **supprimé** ("Les fichiers legacy (`index.html`, `script.js`, `viewer.js`, `positioner.js`) ont été supprimés lors de la migration.")

**Conclusion** : Le fichier est **un orphelin total**. CLAUDE.md prétend qu'il est supprimé mais il existe encore au niveau racine.

## Sections / Fonctions

### `params + sourceUrl + poll` (L21-30)
Lecture des query params (mode standalone — non intégré au backend actuel).

### `stateImages` (L36-43)
Map locale `{state: {on, off}}` — chargée via `<input type="file">` (URL.createObjectURL côté client). Pas de persistance serveur.

### Generation des contrôles d'upload (L46-70)
DOM injection de 8 inputs file dans `#image-controls` (4 états × 2 modes).

### `updateUserState(u, state)` (L72-95)
Switche les classes `on`/`off` sur les enfants de `.states`, applique le `background-image` selon `stateImages[state]`.

### `users + ensureUser(id) + updateLevels(obj)` (L97-147)
Map `userId → carte DOM`. Cleanup des users inactifs après 10s.
**À noter** : utilise `id` (userId Discord) directement — incompatible avec le système actuel de tokens opaques.

### `pollOnce()` (L149-170)
`fetch(sourceUrl)` toutes les `poll` ms.

## Dépendances
- **Importe** : aucune.
- **Utilisé par** : ❌ **PERSONNE** — fichier orphelin.
- **DOM attendu** : `#container`, `#image-controls` (présents dans le legacy `index.html` mais inutilisés en pratique).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🔴 | **Fichier orphelin** — non référencé, non chargé, marqué "supprimé" dans CLAUDE.md mais physiquement présent (170 lignes / 6 KB) | **SUPPRIMER** : `git rm script.js` |
| 🔴 | Utilise `userId` Discord brut (incompatible avec les tokens opaques) | N/A — supprimer le fichier |
| 🟠 | Contradiction directe avec CLAUDE.md ligne 95 | Soit remettre la suppression réellement, soit corriger CLAUDE.md |

## Notes alternatives

Aucune. Ce fichier doit être supprimé immédiatement. Si un jour quelqu'un veut un widget minimaliste, le code est récupérable via l'historique git.

**Action recommandée** :
```bash
cd "C:/Users/glenn/Desktop/Code/hereborus-bot"
git rm script.js
git commit -m "chore: remove orphaned legacy script.js (declared deleted in CLAUDE.md L95)"
```
