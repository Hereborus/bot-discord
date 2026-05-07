# `context/`

> **État global React Context** — un seul store pour toute l'app.
> 🔗 Parent : [`src/`](../README.md)

## Vue d'ensemble

Un seul fichier : `AppContext.jsx`. Il définit un context unique (`AppContext`) consommé par `useApp()` et un provider `AppProvider` qui regroupe tout l'état partagé : auth (rôle, tier, user, token), config audio, frames par utilisateur (`configData`), niveaux audio live (`levels`), statut bot, état de connexion API, override host API.

Pas de Redux, pas de Zustand, pas de reducers. Tout est en `useState` brut. Les setters sont exposés directement → tout consommateur peut tout muter.

## Fichiers

| Fichier | Brève | Doc complète |
|---------|-------|--------------|
| `AppContext.jsx` | Provider + hook `useApp()` qui expose 14 paires `state/setter`. | [AppContext.md](./AppContext.md) |

## Architecture interne

```
<AppProvider>                     ← monté dans main.jsx
  └─ value = {
      authRole, setAuthRole,           ← role brut depuis /auth/me
      effectiveRole, setEffectiveRole, ← rôle utilisé par les guards UI
      myToken, setMyToken,
      tier, setTier,
      tierLimits, setTierLimits,
      authUser, setAuthUser,           ← { username, avatar, discordId }
      apiHost, setApiHost,             ← override base URL (Header)
      audioConfig, setAudioConfig,     ← thresholds, emotions, frameSpeed…
      configData, setConfigData,       ← token → { displayName, states }
      updateConfigData,                ← helper merge par token
      levels, setLevels,               ← /levels live (poll 100ms)
      botStatus, setBotStatus,         ← { connected, inVoice, channelName }
      apiConnected, setApiConnected,   ← null | true | false
    }
```

## Audit du dossier

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **Re-render global** : tout consommateur de `useApp()` re-render dès qu'**une seule** des 14 pièces change (notamment `levels` qui change toutes les 100 ms). | Splitter en plusieurs contexts (auth / audio / live) ou utiliser `use-context-selector`. |
| 🟠 | Setters publics → couplage fort. N'importe quel composant peut écraser `effectiveRole`. | Exposer plutôt des actions (`login`, `logout`, `setTier`) ou un reducer. |
| 🟡 | `DEFAULT_AUDIO_CONFIG` dupliqué côté frontend ET backend (le commentaire le note). Risque de drift. | Servir le default depuis l'API. |
