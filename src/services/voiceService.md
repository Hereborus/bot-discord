# `voiceService.js`

> **État partagé de la connexion vocale Discord (singleton de module) + persistance auto-reconnect.**
> `src/services/voiceService.js`
> Module : [`services/`](./README.md)

## Résumé

Remplace les variables globales éparpillées dans `index.js` par un singleton de module ES. Persiste un sous-ensemble de l'état (`autoReconnect`, `guildId`, `channelId`) dans `voice-state.json` pour reconnecter le bot au redémarrage. **Stateful avec exports `let`** — pattern simple mais qui couple les lecteurs au timing des mutations.

## Fonctions / Exports

### `botConnected`, `currentConnection`, `connectedGuildId`, `connectedChannelId`, `followTarget`, `followError` — `let` exports

**Brève** : exports mutables — les modules importeurs lisent l'état courant directement.
**Contrat attendu** : ne **jamais** muter via `voiceService.botConnected = ...` depuis l'extérieur — les imports `let` sont des bindings *en lecture* côté ES Modules, donc impossible de toute façon. Toutes les mutations passent par `setState()`.
**Pièges** :
- Une copie via destructuration (`const { botConnected } = await import('voiceService.js')`) capture la valeur à un instant donné.
- `currentConnection` est un objet runtime discord.js — non sérialisable, **non persisté**.

### `setState(patch)`

**Brève** : applique un patch partiel sur l'état + déclenche `saveVoiceState()`.
**Comportement actuel** : 6 `if (key in patch)` explicites, mute le `let` puis persiste.
**Contrat attendu** : seul point de mutation autorisé ; appelé depuis `index.js` (`connectToVoiceChannel`, `disconnectVoice`) et `bot/discord.js`.
**Améliorations possibles** :
- Persister à chaque `setState` est wasteful (write disque sur changement de `followTarget` qui ne nécessite pas de persistance). Filtrer les clés à persister.
- Pas de validation du patch.

### `saveVoiceState()`

**Brève** : sérialise `{ autoReconnect, guildId, channelId }` dans `voice-state.json` (sync).
**Comportement actuel** : `try {} catch {}` silencieux — un disque plein masque l'échec.
**Améliorations possibles** : log warn ; faire l'écriture async (write sync sur le hot-path bot connect = 1-10 ms).

### `loadVoiceState()` → `{ autoReconnect, guildId, channelId }`

**Brève** : lit `voice-state.json` ; retourne `{ autoReconnect: false, ... }` si absent ou JSON invalide.
**Contrat attendu** : appelé au boot par `bot/discord.js` (`clientReady` event).

### `getAutoReconnect()` → `boolean`

**Brève** : `loadVoiceState().autoReconnect ?? false`.
**Anti-pattern** : **lit le fichier disque à chaque appel**. Appelé via `saveVoiceState` lui-même → un read/write disque par mutation d'état. Ça fonctionne mais c'est inutilement coûteux.

### `setAutoReconnect(val)`

**Brève** : merge `{ autoReconnect }` dans le fichier sans toucher au reste.

## Dépendances
- **Importe** : `node:path`, `node:fs`.
- **Utilisé par** : [`bot/discord.js`](../bot/discord.md), `index.js`, [`routes/voice.js`](../routes/voice.js).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | `getAutoReconnect()` lit le disque **synchrone** à chaque appel + appelé depuis `saveVoiceState()` ⇒ chaque `setState()` fait read + write. | Mettre `autoReconnect` en variable `let` au même titre que les autres ; lire fichier une fois au boot. |
| 🟠 | `currentConnection` exporté **par valeur** (snapshot) au moment de l'import ; les modules qui font `import { currentConnection }` voient toujours la valeur initiale `null`. **Sauf** s'ils utilisent `import * as v` ou re-importent. À vérifier dans `bot/discord.js` qui utilise `getState()` injecté plutôt que l'import direct → bien. | Documenter explicitement : "ne jamais déstructurer cet export, utiliser `import * as voiceService`". |
| 🟡 | Écritures sync `fs.writeFileSync` sur des events vocaux fréquents (follow target change). | `fs.promises.writeFile` + débounce 200 ms. |
| 🟡 | Pas de schéma versionné dans `voice-state.json` — un changement de format casse l'auto-reconnect en silence. | Ajouter `version: 1` et un fallback. |

## Notes alternatives

L'usage des `let` exports est valide en ES Modules (les imports sont des **live bindings**). Mais un objet `state` fermé sur `getState()` (pattern utilisé par `bot/discord.js`) est plus explicite et moins surprenant — cf. la section "Notes alternatives" du README du dossier.
