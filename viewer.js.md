# `viewer.js`

> **Une ligne** : Module ES vanilla autonome (855 lignes) — moteur de rendu des avatars PNGTuber pour OBS, gère WebSocket + polling HTTP fallback, flipbook, blink, émotions, multi-modes (global/filtré/session sécurisée).
> 📂 `viewer.js`

## Résumé

IIFE asynchrone (`(async () => { ... })();`) qui s'exécute au chargement de `viewer.html`. Pas de dépendance npm — vanilla JS pur. Trois modes d'affichage :
1. **Global** : tous les utilisateurs renvoyés par `/levels`.
2. **Filtré** : `?t=<token>` → un seul utilisateur en plein écran.
3. **Session sécurisée** : `?s=<sessionId>` → résolu via `/api/viewer-session/:id` au boot.

Utilise `WebSocket` en priorité (canal `/ws`), avec fallback `setInterval(fetch /levels)` si le WS échoue. Reçoit aussi `BroadcastChannel` pour les mises à jour de config et de positions depuis l'admin React.

## Sections / Fonctions

### Bootstrap (L5-51)
**Brève** : Lit query params, résout session sécurisée, applique CSS variable `--avatar-size`.
**Comportement actuel** : Si `?s=<id>` présent, fait un fetch HTTP synchrone (await) à `/api/viewer-session/:id` pour récupérer le `userToken`. Affiche un message d'erreur si la session est invalide/expirée.

### Helpers états audio (L53-92)
- `getAudioStates()` : retourne `['silent', ...thresholds.sorted.map(t.key)]`
- `getFallbackChain()` : map ascendant `low → silent`, `medium → low`, `high → medium`
- `isClosedState(key)` / `baseState(key)` / `closedVariant(key)` : helpers pour les variantes `_closed` (yeux fermés)
- `isAudioState(key)` : check si la clé est un état audio valide

### Config audio (L94-216)
- **`audioConfig`** : objet avec defaults (thresholds dB, émotions, blinkSettings).
- **`loadConfigs()`** : priorité serveur (`/user-config/:token`) → fallback localStorage. Marqué `serverLoaded` pour éviter un double-merge.
- **`BroadcastChannel("pngtuber-config")`** : reçoit les updates en temps réel depuis le panneau admin (même origine).
- **`BroadcastChannel("pngtuber-positions")`** : reçoit les updates de positions de frames depuis `positioner.html` (legacy — supposément remplacé par le React `/positioner` selon CLAUDE.md mais le code écoute encore le canal).

### Helpers fréquences (L252-279)
- `bandEnergy(freq, fMin, fMax)` : interpole l'énergie entre les 3 bandes serveur (low/mid/high) sur une plage Hz arbitraire.
- `bandDelta(freqDelta, ...)` : idem pour les deltas.
**Audit** : 🟡 Ces helpers sont définis mais ne sont **jamais appelés** dans le reste de `viewer.js` — la détection d'émotion est gérée serveur-side via `info.detectedEmotion`. **Code mort.**

### Cache frames (L289-339)
- `frameCache[uid__state]` : Map des frames par état.
- `closedAvail[uid][stateKey]` : marque les états qui ont une variante `_closed` disponible.
- `fetchUserFrames(uid)` : fetch `/frames/:token?guild=...`, gère 403 (avatar interdit sur ce serveur).
- `BroadcastChannel("pngtuber-frames")` : invalide le cache après upload.

### Rendu avatars (L342-422)
- `ensureAvatar(uid)` : crée un `<div class="avatar">` dans `#stage`.
- `removeAvatar(uid)` : cleanup complet (flipbook + blink + DOM).
- `getOrCreateImg(uid, url, file, stateKey)` : pool d'`<img>` réutilisables — applique la position depuis localStorage.
- `setAvatarFrame(uid, url, file, stateKey)` : switch d'image avec antimicipation du `onload` pour éviter le flash noir.

### Flipbook engine (L424-461)
**Brève** : Anime les frames d'un état en boucle à `audioConfig.frameSpeed` ms.
**Comportement actuel** : Utilise `setInterval` + `Math.floor(Date.now() / speed) % frames.length` pour rester synchrone si l'interval drift.
**Audit** : 🟢 Pattern correct.

### Blink/transition engine (L463-596)
**Brève** : Planifie des clignements aléatoires basés sur `blinkSettings[stateKey]` avec frames `_closed`.
**Comportement actuel** :
- `startBlinkTimer(uid)` : démarre le scheduler de blinks.
- `triggerBlink(uid, gen)` : affiche les frames `_closed`, attend `randBetween(durationMin, durationMax)`, restaure les frames open.
- **Continuité du blink** : si l'état audio change pendant le blink, switch vers la variante `_closed` du nouvel état (lignes 568-583).
- **Generation counter** (`blinkGeneration`) : annule les blinks orphelins quand `startBlinkTimer` est rappelé.
**Audit** : 🟢 Logique solide. 🟡 La boucle while à 50ms (L562-583) avec `await Promise(setTimeout)` pourrait être remplacée par une seule promesse + clearTimeout pour réduire le nombre de microtasks.

### `applyUser(uid, info)` (L610-660) ⚠️ BUG CRITIQUE
**Brève** : Met à jour l'avatar d'un user à partir des données reçues (`info.db`, `info.state`, `info.detectedEmotion`).
**Comportement actuel** :
```js
const displayKey = emotion || status;       // L635
const frames = resolveFrames(uid, displayKey);
// ...
if (effectiveKey !== userStates[uid].displayKey) {  // L652 — effectiveKey jamais défini !
    if (frames.length > 0) {
        userStates[uid].displayKey = effectiveKey;
        // ...
    }
}
```
**Audit** :
- 🔴 **`effectiveKey` est utilisé en L652-657 mais jamais déclaré dans la fonction** — c'est probablement un renommage incomplet de `displayKey`. Cause `ReferenceError: effectiveKey is not defined` à chaque appel. Le viewer ne peut pas changer d'état → tout reste figé sur la première frame ! **À fixer immédiatement** : remplacer `effectiveKey` par `displayKey`.

### `handleData(data)` (L665-674)
**Brève** : Filtre les uids selon `FILTER_UID`, appelle `applyUser` puis cleanup les avatars disparus.

### WebSocket + polling (L677-787)
- `connectWebSocket()` : ouvre `wss://host/ws`, écoute `frame-update`, `config-update`, `levels`.
- `poll()` : fallback HTTP si WS down.
- Auto-reconnexion WS toutes les 2s sur close.
- **Optimisation** : `if (wsConnected) return;` dans `poll()` empêche le double traitement.
**Audit** :
- 🟡 `pollTimerId` est créé puis `clearInterval` mais redémarré dans `ws.onclose` ce qui peut créer de petits délais.
- 🟡 Pas de backoff exponentiel sur la reco WS (toujours 2s) — peut surcharger en cas de panne réseau.

### `showFallbackSilent()` (L793-807)
**Brève** : Affiche immédiatement la frame `silent` même sans données audio (l'utilisateur n'est pas connecté en vocal).

### Debug overlay (L810-840)
**Brève** : Overlay top-bar avec metrics. Toggle via touche `D`.
**Audit** : 🟢 Utile pour debug, peu intrusif. 🟡 Couleurs hard-codées.

### Bootstrap final (L843-853)
```js
loadConfigs().then(() => showFallbackSilent());
connectWebSocket();
startPolling();
```

## Dépendances
- **Importe** : aucune (vanilla JS).
- **Utilisé par** : `viewer.html` via `<script type="module">`.
- **API consommée** :
  - `GET /levels` (fallback HTTP)
  - `GET /frames/:token?guild=...`
  - `GET /user-config/:token`
  - `GET /api/viewer-session/:sessionId`
  - `WS /ws` (subscribe / messages)

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🔴 | **`effectiveKey` non défini** dans `applyUser` (L652-657) — provoque un ReferenceError | Remplacer `effectiveKey` par `displayKey` (4 occurrences) |
| 🟠 | `bandEnergy` / `bandDelta` (L256-276) sont définies mais **jamais appelées** — code mort | Supprimer ou réintégrer si la détection d'émotion repasse côté client |
| 🟡 | `BroadcastChannel("pngtuber-positions")` écoute encore les positions de `positioner.html` legacy | Vérifier si le React `/positioner` envoie toujours sur ce canal — sinon supprimer le listener |
| 🟡 | Pas de backoff exponentiel sur la reconnexion WS | Doubler le délai à chaque échec (2s, 4s, 8s, max 30s) |
| 🟡 | `forwarded-by-token` filter côté client (L668) — le serveur filtre déjà via `subscribe` WS | Faire confiance au serveur, simplifier le filtrage |
| 🟡 | `POLL_MS = max(50, parseInt(?poll))` — pas de cap haut | Cap à 5000ms pour éviter `?poll=999999999` |
| 🟢 | Pattern d'IIFE async pour permettre `await` au top level — propre |

## Notes alternatives

- Le code envoie des `debug-log` au serveur via WS (L642-649) à chaque frame audio (~20Hz). Cela génère ~1200 entrées en 60s, stockées dans un ring buffer côté serveur (L1611). Utile mais peut être désactivé en prod via un flag pour réduire la bande passante.
- Le `currentVisibleFrame[uid]` (L391) tracke le fichier actuel — pourrait être centralisé avec `userStates[uid]`.
- Une refacto propre de `applyUser` (qui mélange fetch frames, état audio, blink, debug) serait bénéfique mais risquée — laisser tel quel et juste fixer le bug critique.
