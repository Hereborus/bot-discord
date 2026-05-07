# `discord.js`

> **Client Discord.js v14 + slash commands + events (clientReady, voiceStateUpdate, messageCreate).**
> `src/bot/discord.js`
> Module : [`bot/`](./README.md)

## Résumé

Encapsule tout ce qui parle à Discord : création du client, enregistrement des slash commands **par guild** (propagation instantanée vs global), commandes texte `!join`/`!disconnect`/`!status`, slash commands `/join`/`/config`/`/disconnect`, mode **suivi d'un user** (le bot change de canal quand sa cible bouge), **déconnexion auto** quand le bot reste seul.

Le couplage avec la **logique vocale** se fait via un objet `deps` injecté à `initBot(deps)` — design propre qui évite les imports circulaires avec `index.js`.

## Fonctions / Exports

### `client` — `discord.js Client`

**Brève** : client global avec intents `Guilds | GuildMessages | MessageContent | GuildVoiceStates`.
**Contrat attendu** : singleton importé partout.

### `initBot(deps)`

**Brève** : enregistre **tous** les events sur `client`. À appeler **une seule fois** au boot.
**Comportement actuel** :
- `clientReady` → enregistre slash commands sur chaque guild + tente l'auto-reconnect.
- `error` → détecte `TOKEN_INVALID` / `code 4004` et appelle `deps.onTokenRejected`.
- `messageCreate` → 3 commandes texte préfixées `!`.
- `interactionCreate` → 3 slash commands.
- `voiceStateUpdate` → suivi + déconnexion auto (5 s timer).
**Contrat attendu** : `deps` doit fournir : `connectToVoiceChannel`, `disconnectVoice`, `isAvatarAllowed`, `getState`, `broadcastFollowStatus`, `broadcastFollowError`, `setFollowTarget`, `BASE_URL`, et optionnellement `onBotReady`, `onTokenRejected`.
**Améliorations possibles** :
- Pas de **debounce** sur le timer 5 s de déconnexion auto : si un user join puis re-leave dans la fenêtre, le bot reste alors qu'il devrait peut-être partir.
- Le **nettoyage des slash commands globales** au boot (`rest.put(applicationCommands, [])`) **détruit** toutes les commandes globales à chaque démarrage. Si un jour le bot doit être public avec slash commands globales, c'est destructeur.
- Les commandes `/join`, `/config`, `/disconnect` ne demandent **aucune permission** côté Discord (`setDefaultMemberPermissions`). N'importe quel membre du serveur peut déconnecter le bot.

### `loginBot(token, onReject)`

**Brève** : wrapper async sur `client.login`.
**Comportement actuel** : log + appel `onReject` si échec.

### Variables internes : `slashCommands`

3 commandes : `/join`, `/config`, `/disconnect`. Pas de description par localisation.

## Mode suivi (`voiceStateUpdate`)

**Comportement** : si `followTarget.discordId` change de canal :
1. Vérifie la perm `Connect` sur le nouveau canal.
2. Reconnecte ; sur erreur, `broadcastFollowError`.
3. Si la cible quitte le voice → `setFollowTarget(null)` + broadcast.

**Améliorations** : aucun timeout — si la cible disparaît brièvement (Discord lag), le suivi se désactive d'un coup. Considérer 10 s de tolérance.

## Déconnexion auto

**Comportement** : si `voiceStateUpdate` détecte un canal avec **0 membres non-bots**, lance un `setTimeout(5000)` qui re-vérifie puis déconnecte.

**Améliorations** :
- Pas de **dedup** : 5 voiceStateUpdate consécutives = 5 setTimeout. Sur un raid, queue de 50 timeouts.
- Le timer n'est **pas annulé** si quelqu'un revient — un user qui revient à 4.9 s puis repart à 5.1 s déclenche encore la déconnexion, parce que le check `=== 0` se refait dans le timeout.

## Dépendances
- **Importe** : `discord.js`, `@discordjs/voice`, [`services/voiceService.js`](../services/voiceService.md) (`loadVoiceState`, `saveVoiceState`), [`services/tokenService.js`](../services/tokenService.md), [`services/audioService.js`](../services/audioService.md) (`userLevels` pour `!status`).
- **Utilisé par** : `index.js` (boot du bot, gestion DDS state, broadcast WS).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | Slash commands `/join` / `/disconnect` sans `setDefaultMemberPermissions` → tout membre peut joindre/déconnecter le bot. | `.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)` ou similaire. |
| 🟠 | Auto-disconnect timer **non annulé** si user revient → déconnexion injuste sur churn rapide. | Stocker `disconnectTimers: Map<guildId, timeout>`, clear si membre revient avant échéance. |
| 🟡 | Cleanup global slash commands au boot — destructeur. | Conditionnel par env `RESET_GLOBAL_COMMANDS=1`. |
| 🟡 | Pas de log structuré ; `console.log` partout. | Pino ou similaire pour production. |
| 🟡 | `broadcastFollowError(channelName, userName)` mais l'erreur peut être autre que "perm denied" (ex: rate limit Discord). | Inclure l'erreur réelle. |
| 🟡 | `interaction.editReply` sur erreur capture toujours "Impossible de rejoindre le salon." sans logger l'erreur Discord. | Log + Sentry. |

## Notes alternatives

Le pattern d'injection `initBot(deps)` est élégant et permet le test unitaire trivial (mock `deps`). À conserver. Le couplage à `userLevels` direct (au lieu de passer par `deps`) crée une dépendance silencieuse vers `audioService` — acceptable car module data pur, mais à mentionner dans le README du dossier.
