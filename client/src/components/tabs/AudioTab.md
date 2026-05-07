# `AudioTab.jsx`

> **Config audio** — seuils dB, émotions custom, fingerprints, hotkeys clavier.
> 📂 `client/src/components/tabs/AudioTab.jsx`
> 🔗 Module : [`tabs/`](./README.md)

## Résumé

Onglet le plus complexe (~355 lignes). Concentre 5 sous-fonctionnalités :

1. **Sélecteur utilisateur** (`selectedToken`).
2. **Live audio + profil vocal** : affichage temps réel de dB/F1/F2/F3/émotion détectée + table détaillée du profil vocal stats (min/p50/max par marqueur).
3. **Seuils audio** (`thresholds`) : sliders dB par seuil + color picker.
4. **Émotions custom** : ajout (clé + couleur), capture d'empreinte (snapshot passif des valeurs live, calcul std via IQR du profil vocal), suppression empreinte/émotion.
5. **Raccourcis émotions** : capture de touche clavier, mapping → émotion + mode (toggle/hold).

Persiste via `POST /user-config/{token}`.

## Composants / Hooks exportés

### `AudioTab({ toast })`

**Props attendues** :
- `toast: (msg) => void`.

**Comportement actuel** :
- 11 states locaux (gros !) :
  - `selectedToken`, `saving`, `fingerprints`, `addingEmotion`, `newEmotionKey`, `newEmotionColor`, `capturing`, `voiceProfile`, `newHotkeyCode`, `newHotkeyEmotion`, `newHotkeyMode`, `listeningKey`.
- 2 `useEffect` : auto-select premier token, et chargement `/user-config/{token}` au changement de token.
- Helpers internes : `hz`, `fmtDb`, `profileQuality`, `iqrStd`.
- Action `captureFingerprint` mémoïsée (`useCallback`) :
  - Lit les valeurs live depuis `levels[selectedToken]`,
  - Construit un fingerprint `{ db, zcr, centroid, energyVar, freq_low, freq_mid, freq_high, formant_f1, formant_f2, formant_f3 }`,
  - Pour chaque marqueur, std = `iqrStd(voiceProfile, key, defaultStd)`,
  - POST `/calibration/{token}/save-fingerprint`,
  - Re-fetch config pour récupérer la persisted version.
- Modifications du config local (`setAudioConfig`) au fil de l'eau ; bouton "Sauvegarder" final qui POST tout.

**Comportement attendu (contrat)** :
- L'utilisateur **doit parler** au moment du clic "Capturer" (sinon toast "Parlez pour capturer une empreinte").
- Le profil vocal `voiceProfileN ≥ 150` est requis pour des std fiables (sinon fallback aux defaults).
- Les changements de seuils/vitesse/émotions ne sont pas persistés tant qu'on ne clique pas "Sauvegarder".

**Améliorations possibles** :
- Splitter en sous-composants : `<ThresholdsSection>`, `<EmotionsSection>`, `<HotkeysSection>`, `<LiveSection>`.
- Remplacer les 11 states par un `useReducer`.
- Auto-save sur changement (debounced).
- Visualisation graphique du profil vocal (histogramme).
- Indicateur visuel quand la touche est en `listeningKey`.

## State & Side effects

- **State local** : 11 useState (cf. ci-dessus).
- **Context utilisé** : `configData`, `audioConfig`, `setAudioConfig`, `levels`.
- **API appelée** : `GET /user-config/{token}`, `POST /user-config/{token}`, `POST /calibration/{token}/save-fingerprint`, `DELETE /calibration/{token}/fingerprint/{key}`.
- **WebSocket** : non (lit `levels` polling).
- **localStorage** : non.

## Dépendances

- **Importe** : `useState`, `useEffect`, `useCallback`, `useApp`, `useAudioStates`, `apiJson`, `apiPost`, `apiFetch`.
- **Utilisé par** : `App.jsx`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🔴 | **Composant trop gros** (355 lignes) — viole SRP. Difficile à tester. | Splitter en 4-5 sous-composants. |
| 🔴 | **`setAudioConfig(prev => ({ ...prev, ...cfg }))`** au chargement écrase le config global avec celui du token sélectionné — peut faire bugger d'autres onglets qui lisent `audioConfig` (ex: AvatarsTab `<UserCard>` re-calcule les seuils). Sémantique : audioConfig est-il global ou par-token ? | Clarifier : `audioConfigByToken` ou contexte local. |
| 🟠 | **`useEffect[selectedToken, setAudioConfig]`** : `setAudioConfig` est stable, OK ; mais l'effet n'a pas de cleanup → fetch race possible. | AbortController. |
| 🟠 | **11 states** — clairement un signal pour `useReducer`. | Refactor. |
| 🟠 | **Pas de validation** sur `newEmotionKey` (sauf trim+lower+replace) ; clés magiques (`emotionKey === 'silent'` non gardé). | Validation explicite. |
| 🟠 | **`onKeyDown={listeningKey ? captureKey : undefined}`** sur un `<button>` — UX étrange. | Contexte global keydown listener. |
| 🟡 | **Format magique** `formant_f1` / `freq_low` — clés API. | Constantes. |
| 🟡 | **Affichage `+s.min.toFixed(1)`** : préfixe `+` (cast number) sur des valeurs peut-être déjà numériques. | Cleanup. |
| 🟡 | **Inline styles** très présents. | CSS. |

## Notes alternatives

- Si on doit garder ce niveau de complexité, un schéma type Zod + un form library (React Hook Form) éviterait de manipuler 11 states.
