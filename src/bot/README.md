# `bot/`

> **Bot Discord (client + slash commands + events) + pipeline audio temps reel.**
> Parent : [`src/`](../README.md)

## Vue d'ensemble

Deux fichiers :
- `discord.js` (~268 lignes) — couche Discord pure (events, slash commands, mode suivi).
- `audio.js` (~607 lignes) — pipeline DSP temps réel (Opus → FFT → LPC → fingerprints émotion).

Le couplage entre `discord.js` et `audio.js` se fait via [`services/audioService.js`](../services/audioService.md) (`userLevels`) et via les callbacks injectés à `initBot()`. **Aucun import direct circulaire.**

> Note : les routes HTTP de calibration (anciennement dans `bot/calibration.js`) ont ete deplacees dans [`routes/calibration.js`](../routes/calibration.md) lors du refactor de mai 2026.

## Fichiers

| Fichier | Brève | Doc complète |
|---------|-------|--------------|
| `audio.js` | Pipeline DSP : RMS/dB, FFT bandes, ZCR, LPC formants, baseline EMA, profil vocal passif, hystérésis émotion. | [audio.md](./audio.md) |
| `discord.js` | Client Discord.js v14, slash commands, mode suivi, déconnexion auto. | [discord.md](./discord.md) |

## Architecture interne

```
            DISCORD GATEWAY
                  |
                  v
   client (discord.js) -- events
       |       |       |       |
       v       v       v       v
   ready  msgCreate  voiceUpd  intCreate
       |       |       |       |
       |       +-- !join / !disconnect / !status
       |               |
       |               v
       |    deps.connectToVoiceChannel (injected from index.js)
       |               |
       |               v
       |       Voice receiver -----+
       |                            |
       v                            v
   loadVoiceState              audio.subscribeUser(receiver, userId, ...)
   (auto-reconnect)                       |
                                           v
                                    +----- pipeline 50ms tick -----+
                                    |  RMS/dB, FFT, ZCR, LPC, Var  |
                                    +----------------+-------------+
                                                     |
                                                     v
                              audioService.userLevels.set(userId, {...})
                                                     |
                                  +------------------+------------------+
                                  v                                     v
                         routes/levels (HTTP)              websocket broadcast (index.js)
```

`calibration.js` est sur un **chemin orthogonal** : ses routes touchent `cfg.emotionFingerprints` en DB et invalident le cache 5 s d'`audio.js`.

## Audit du dossier

- 🟠 **`audio.js` ne retourne pas de `cleanup()`** — caller doit faire confiance aux events `end/close/error`. Risque de fuite si Discord drop sans event.
- 🟠 **Buffers LPC partagés entre users** dans `audio.js` (`_lpcX/_lpcR/...`). Sécurisé par single-thread Node, mais fragile.
- 🟠 **`calibration.js` mal placé** : devrait être dans `routes/`, pas `bot/`.
- 🟠 **Slash commands sans `setDefaultMemberPermissions`** — tout membre peut déconnecter le bot.
- 🟡 **Auto-disconnect timer** non annulé sur churn rapide (5 s setTimeout).
- 🟡 **Fingerprints non validés** côté backend (`calibration.js`) — payload arbitraire stocké tel quel.
- 🟡 **Cleanup global slash commands** au boot (destructeur si bot devient public un jour).

## Notes alternatives

`audio.js` est ~600 lignes denses mais raisonnablement compartimenté (FFT / LPC / hystérésis / pipeline). Une scission `audioPipeline.js` (subscribe + tick) / `audioDsp.js` (computeFreqBands, computeFormants) / `audioEmotion.js` (stabilizeEmotion, detectEmotionFromFingerprints) serait plus testable, mais pas urgent.
