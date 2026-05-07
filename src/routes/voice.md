# `voice.js`

> Contrôle du bot vocal via HTTP : guildes, canaux, join/disconnect, suivi, auto-reconnect.
> 📂 `src/routes/voice.js`
> 🔗 Module : [`routes/`](./README.md)

## Résumé

Pont HTTP ↔ Discord.js voice. Les non-admins ne voient que les guildes/canaux dans lesquels ils sont membres ET ont la permission `Connect`. Les admins voient tout. Inclut un mode "follow" qui suit dynamiquement un user (via token) entre canaux vocaux.

Toutes les routes dépendent du `client` Discord.js et de fonctions injectées (`connectToVoiceChannel`, `disconnectVoice`, `setFollowTarget`, `broadcastFollowStatus`) définies dans `index.js`.

## Fonctions / Exports

### `handleGuilds(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `GET /api/guilds` — serveurs visibles (filtré par `userGuildIds` si non-admin).

**Comportement actuel** : 503 si bot non connecté. Sinon :
- Admin : tous les serveurs en cache
- Non-admin : intersection avec `session.userGuildIds` (récupéré au login OAuth via scope `guilds`)

Retourne `[{ id, name, icon, memberCount }]`.

**Améliorations possibles** :
- `userGuildIds` peut être stale (un user a quitté/rejoint un serveur depuis le login). Refresh via `/users/@me/guilds` à l'intervalle X serait plus robuste.

### `handleGuildChannels(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `GET /api/guilds/:guildId/channels` — canaux vocaux filtrés par perms.

**Comportement actuel** :
1. 503 si bot pas connecté, 404 si guild introuvable.
2. Non-admin : 403 si pas membre.
3. `member = guild.members.cache.get(discordId)` puis fallback `members.fetch` si absent.
4. Filtre `GuildVoice | GuildStageVoice` + `permissionsFor(member).has(Connect)` (admin bypass).
5. Pour chaque canal : liste des membres (token + displayName, pas de discordId), `botConnected: connectedChannelId === c.id`.

**Comportement attendu (contrat)** : Aucun discordId fuite. ✓

**Améliorations possibles** :
- Le `import('../services/voiceService.js')` dynamique est étrange — `connectedChannelId` est aussi dans `deps`, on pourrait l'injecter directement et éviter l'import dynamique.
- `members.fetch` synchrone bloque la requête — pour les très gros serveurs (>50k members), peut timeout.
- Permission check non bloquant pour admins → un admin connecté qui n'est pas dans la guild voit quand même → OK c'est l'intention.

### `handleGuildMembers(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `GET /api/guilds/:guildId/members` — liste membres (admin only).

**Comportement actuel** : Lit `guild.members.cache` (pas de `fetch` complet → renvoie `partial: true` pour l'UI). Bots filtrés.

**Comportement attendu (contrat)** : Liste partielle — Discord.js cache n'est pas exhaustif. Pour la liste complète, il faudrait `guild.members.fetch()` (lent + intent privilégié `GuildMembers`).

**Améliorations possibles** :
- `discordId` exposé ici (admin) — incohérent avec le reste de l'API qui tokenise. Acceptable car admin only.
- Pas de pagination — un serveur avec 10k members en cache renvoie 10k items.

### `handleVoiceJoin(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `POST /api/voice/join` — bot rejoint un canal.

**Comportement actuel** :
1. 400 si `guildId/channelId` manquants.
2. Non-admin : check membership + permission `Connect`.
3. `connectToVoiceChannel(guildId, channelId)` (injecté).
4. Retourne `{ ok, guild, channel, memberCount }`.

**Améliorations possibles** :
- Plusieurs `try/catch` muets — perdent le contexte d'erreur Discord
- Si le bot est déjà connecté ailleurs, le comportement dépend de `connectToVoiceChannel` (devrait disconnect avant) — non visible ici

### `handleVoiceDisconnect(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `POST /api/voice/disconnect`.

400 si pas connecté.

### `handleVoiceStatus(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `GET /api/voice/status` — état de la connexion.

**Comportement actuel** : Retourne `connected: false` si rien. Sinon : guild/channel info, membres tokenisés, `following` (token + displayName), `followError` (si moins de 10s).

**Améliorations possibles** :
- `Date.now() - followError.ts < 10000` magique — extraire constante

### `handleFollowStatus(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `GET /api/voice/follow-status`.

Subset de `handleVoiceStatus`. Doublon partiel.

### `handleVoiceFollow(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `POST /api/voice/follow` — suivre un user (par token).

**Comportement actuel** :
1. 400 si token manquant.
2. `uidFor(token)` — 404 si inconnu.
3. Lookup display name dans la guild courante.
4. `setFollowTarget({ discordId, requestedBy, displayName })`.
5. `broadcastFollowStatus()`.
6. `console.log('Mode suivi activé:...')`.

**Comportement attendu (contrat)** : Admin only. Le `discordId` n'est pas exposé en réponse.

**Améliorations possibles** :
- Le `console.log` du displayName n'est pas problématique mais pas wrapped dans un logger structuré

### `handleVoiceUnfollow(req, res, ctx, deps)` → `Promise<void>`

**Brève** : `POST /api/voice/unfollow`.

Idempotent.

### `handleGetAutoReconnect(req, res)` / `handleSetAutoReconnect(req, res, ctx)`

**Brève** : Toggle simple `getAutoReconnect()` / `setAutoReconnect(!!body.enabled)`.

**Améliorations possibles** :
- Persistence : la valeur est-elle sauvegardée en `.env` ou en DB ? Si juste en mémoire, perdue au restart.

## Dépendances

- **Importe** : `discord.js` (`ChannelType`, `PermissionFlagsBits`), [`services/voiceService`](../services/voiceService.js), [`services/tokenService`](../services/tokenService.js), [`http/helpers`](../http/helpers.js)
- **deps injectées** : `client`, `botConnected`, `connectToVoiceChannel`, `disconnectVoice`, `connectedGuildId`, `connectedChannelId`, `currentConnection`, `followTarget`, `followError`, `setFollowTarget`, `broadcastFollowStatus`
- **Utilisé par** : `index.js`

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 Maj | `userGuildIds` peut être stale (changements depuis login) | Refresh périodique ou check live `members.fetch` |
| 🟠 Maj | `guild.members.cache` partiel sans `fetch` | Documenter la limite ou implémenter le fetch sur demande |
| 🟡 Min | `import` dynamique de `voiceService` dans `handleGuildChannels` | Injecter via deps |
| 🟡 Min | `try/catch {}` muets | Au moins logger l'erreur |
| 🟡 Min | `handleGuildMembers` expose `discordId` | OK admin only mais documenter |
| 🟡 Min | `handleFollowStatus` doublon partiel de `handleVoiceStatus` | Centraliser |
| 🟡 Min | Pas de pagination sur `handleGuildMembers` | Ajouter `?limit=&offset=` |
| 🟢 Info | `auto-reconnect` persistence non documentée | Vérifier voiceService.js |

## Notes alternatives

Le pattern de **paramètres injectés volumineux** (`{ client, botConnected, connectToVoiceChannel, ... }`) suggère qu'un `VoiceController` (objet ou closure) tenant tout cet état serait plus propre. Refacto possible :

```js
export function makeVoiceRoutes({ client, voiceService }) {
  return { handleGuilds, handleGuildChannels, ... };
}
```

Cela élimine le besoin de re-passer 8 deps à chaque registration.

Le mode "follow" pourrait gagner en sécurité — actuellement, un admin peut faire suivre n'importe quel user (privacy). Ajouter une feature flag `voice.follow.enabled` ou exiger consentement du suivi.
