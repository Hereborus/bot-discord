# `audio.js`

> **Pipeline audio Discord temps réel : Opus → PCM → RMS/dB → FFT → ZCR → LPC formants → émotion.**
> `src/bot/audio.js`
> Module : [`bot/`](./README.md)

## Résumé

Cœur audio du bot. Pour chaque user vocal, attache un pipeline `Opus → PCM 16-bit 48 kHz stéréo` (prism-media), calcule toutes les 50 ms : RMS/dB, énergie par bande low/mid/high (FFT 1024 points), ZCR, variance d'énergie, centroïde spectral, **formants F1/F2/F3** (Levinson-Durbin LPC ordre 12), et persiste une **baseline EMA** + un **profil vocal passif** (1000 samples × 10 marqueurs) en SQLite. La détection d'émotion se fait par **distance normalisée** aux empreintes enregistrées + **hystérésis** (5 confirmations consécutives, hold 800 ms).

État partagé : tout passe par les `Map` de [`services/audioService.js`](../services/audioService.md). C'est **stateful par conception**.

## Fonctions / Exports

### `subscribeUser(receiver, userId, displayName, deps)`

**Brève** : attache le pipeline complet à un user voice Discord.
**Comportement actuel** :
1. Charge la baseline persistée si pas en mémoire.
2. `receiver.subscribe(userId)` → `prism.opus.Decoder` → buffer circulaire `Float32Array` (capacité 2 × `fftSize`).
3. `setInterval(50ms)` qui :
   - Calcule RMS/dB, met à jour la fenêtre glissante (`AUDIO.durationWindow=100`).
   - Lance FFT (`computeFreqBands`), calcule ZCR, energy variance.
   - Lance `computeFormants` (LPC) avec affinage adaptatif si profil ≥ 150 samples.
   - Met à jour baseline EMA (α=0.005) marquée `dirty`.
   - Push un sample dans le profil vocal passif **si parole détectée** (db > -60 ou f1 > 0).
   - Détecte l'émotion (manuelle prioritaire, sinon empreinte avec timeout 30 min).
   - Écrit dans `userLevels.set(userId, {...})`.
4. Sur `end` / `close` / `error` → cleanup + reset niveaux + nettoyage différé (5 min) des Maps.
**Contrat attendu** :
- `deps.manualEmotion` : Map<token, { emotion, setAt }>.
- `deps.getUserConfig(token)` : retourne `{ config_json }` SQLite.
- `deps.upsertUser(token, displayName, json)` : write SQLite.
- Le caller (index.js) doit gérer la déconnexion avec un `unsubscribe` séparé — `subscribeUser` ne retourne **pas** de fonction `dispose()`.
**Améliorations possibles** :
- Aucun retour pour permettre au caller de forcer un cleanup → si Discord drop la connexion sans déclencher `end`, l'interval continue à tourner sur `sumSq=0`.
- Errors de **prism opus decoder** "corrupted" sont **swallowed** (premiers paquets opus normaux) — log conservé en dev pourrait aider à diagnostiquer une vraie corruption.
- 12+ closures par user × pipeline complet — à profiler avec 20+ users vocaux simultanés.

### `computeFreqBands(buffer)` → `{ low, mid, high, centroid }`

**Brève** : FFT sur les 1024 premiers samples ; énergie moyenne par bande + centroïde spectral.
**Comportement actuel** : `fftUtil.fftMag(fft(buffer.slice(0, 1024)))`. Centroïde = `Σ(mag × freq) / Σ(mag)`.
**Contrat attendu** : `buffer.length >= AUDIO.fftSize` sinon retourne 0.
**Améliorations** : `buffer.slice(0, fftSize)` crée une **copie**. Pour un Float32Array, `subarray` éviterait la copie.

### `computeFormants(buffer, voiceProfile)` → `{ f1, f2, f3 }`

**Brève** : LPC ordre 12 (Levinson-Durbin) → enveloppe spectrale → 3 pics les plus forts (par magnitude) triés par fréquence.
**Comportement actuel** :
1. Pré-accentuation `H(z) = 1 - 0.97z⁻¹`.
2. Fenêtre Hann.
3. Autocorrélation R[0..12].
4. Levinson-Durbin pour les coefficients LPC.
5. Évaluation `|1/A(ω)|` sur 250–4500 Hz, 512 points.
6. Pics locaux → top 5 par mag → top 3 par freq → F1/F2/F3.
7. **Affinage adaptatif** : si profil vocal ≥ 150 samples, restreint chaque formant à la plage `[p10×0.85, p90×1.15]` ; hors plage → cherche le pic le plus fort dans la plage.
**Contrat attendu** :
- F1 (250-1000 Hz) : ouverture / arousal.
- F2 (800-2500 Hz) : position langue / valence.
- F3 (1500-3500 Hz) : tension vocale.
**Améliorations** :
- Buffers `_lpcX/_lpcR/_lpcA/...` sont **module-level** ⇒ **NON thread-safe par user** : si deux users sont traités quasi-simultanément (Node single-thread mais un `setImmediate` au mauvais endroit), corruption possible. En pratique le `setInterval` de chaque user est sérialisé par l'event loop, donc safe — **mais à documenter**.

### `getVoiceStats(userId)` → `stats | null`

**Brève** : accès lecture au cache de stats percentiles du profil vocal passif.

### `invalidateFingerprintCache(token)`

**Brève** : invalide le cache 5 s des empreintes après modification (appelé depuis `bot/calibration.js`).

### `loadBaselineFromConfig(userId, getUserConfig)`

**Brève** : restaure baseline + voiceProfile depuis SQLite au démarrage du pipeline pour un user.

### `startBaselinePersistence(getUserConfig, upsertUser)` → `IntervalId`

**Brève** : `setInterval(60s)` qui flush toutes les baselines `dirty` vers SQLite.
**Améliorations** : si le process crash entre deux flushes, perte de 60 s de données EMA. Acceptable pour des stats lentes.

## Fonctions internes (non exportées)

- `_pushVoiceProfile`, `_computeVoiceStats`, `_refineFormants`.
- `stabilizeEmotion(token, raw)` — hystérésis 5×50ms + hold 800 ms. Map `emotionState` non bornée mais nettoyée 5 min après cleanup pipeline.
- `getFingerprints(token, getUserConfig)` — cache 5 s des empreintes, lit la `config_json`.
- `detectEmotionFromFingerprints` — distance euclidienne normalisée par std + seuil 2σ.

## Dépendances
- **Importe** : `prism-media`, `fft-js`, `@discordjs/voice`, [`services/audioService.js`](../services/audioService.md), [`services/tokenService.js`](../services/tokenService.md).
- **Utilisé par** : `index.js` (`_subscribeUser` wrapper qui injecte `manualEmotion`, `getUserConfig`, `upsertUser`).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **Pas de fonction de cleanup explicite exposée** — le caller doit faire confiance aux events `end/close/error`. Si Discord crash silencieux, l'interval continue. | Retourner `() => cleanup()` depuis `subscribeUser`. |
| 🟠 | Buffers LPC `_lpcX/_lpcR/...` sont **partagés entre users** — sécurisé par le single-thread Node, mais **un seul `await` mal placé casse tout**. | Doc explicite + considérer `WeakMap<userId, buffers>`. |
| 🟠 | `JSON.parse(row.config_json || '{}')` exécuté à chaque chargement de fingerprints / baseline ; cache 5 s atténue mais le `setInterval` de baseline persistence parse à chaque tick. | Cacher `cfg` parsed avec invalidation. |
| 🟡 | **Pas de protection contre `userLevels.size > N`** — si un bot reste connecté longtemps avec churn vocal, fuite mémoire (cleanup différé 5 min mais entrées y restent). | GC périodique scanning `userLevels`. |
| 🟡 | `decoder.on('error')` filtre `'corrupted'` mais d'autres erreurs sont loggées en console.error sans contexte. | Inclure `userId` + Sentry-like. |
| 🟡 | Manual emotion timeout 30 min hard-codé. | Configurable via env. |
| 🟡 | `console.error('Audio error:', err)` global au catch d'init — masque les erreurs d'allocation Float32Array sur low-RAM. | Log avec stack + userId. |

## Notes alternatives

Le choix LPC ordre 12 + Hann + pré-accentuation 0.97 est **standard** pour la voix à 48 kHz — bien documenté dans le code. La détection d'émotion par distance normalisée + hystérésis est simple mais efficace pour des fingerprints capturés manuellement par l'user dans l'UI.

**Cross-link important** : tout l'état vit dans [`services/audioService.js`](../services/audioService.md) — ne pas le dupliquer ici.
