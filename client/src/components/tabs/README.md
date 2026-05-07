# `tabs/`

> **Onglets du panneau de contrôle** — un fichier par onglet, 9 onglets au total.
> 🔗 Parent : [`components/`](../README.md)

## Vue d'ensemble

Chaque onglet est un composant indépendant rendu par `ControlApp` selon `activeTab`. Tous reçoivent éventuellement la prop `toast` (prop drilling). Filtrage de visibilité géré par `TabBar` selon `effectiveRole`.

## Fichiers

| Fichier | Brève | Rôles | Doc complète |
|---------|-------|-------|--------------|
| `AvatarsTab.jsx` | Page d'accueil — grille de `<UserCard>` pour chaque token live. | admin/client/viewer | [AvatarsTab.md](./AvatarsTab.md) |
| `AudioTab.jsx` | Config audio par utilisateur : seuils dB, émotions custom, fingerprints, hotkeys. | admin/client/viewer | [AudioTab.md](./AudioTab.md) |
| `ExperimentTab.jsx` | Prévisualisation statique de toutes les frames par état pour chaque user. | admin/client/viewer | [ExperimentTab.md](./ExperimentTab.md) |
| `SetupTab.jsx` | Génération URL viewer OBS sécurisée (session ID temporaire). | admin only | [SetupTab.md](./SetupTab.md) |
| `AdminTab.jsx` | Gestion permissions + Discord bot token. | admin only | [AdminTab.md](./AdminTab.md) |
| `DbViewTab.jsx` | Stats DB + table des frames (read-only). | admin only | [DbViewTab.md](./DbViewTab.md) |
| `SessionsTab.jsx` | Sessions collaboratives (créer, inviter, accepter, terminer). | admin/client | [SessionsTab.md](./SessionsTab.md) |
| `SubscriptionsTab.jsx` | Vue abonnement + sièges streamer + panel admin. | admin/client | [SubscriptionsTab.md](./SubscriptionsTab.md) |
| `AppTokensTab.jsx` | Liste + révocation des tokens d'application (Bearer). | admin/client | [AppTokensTab.md](./AppTokensTab.md) |

## Architecture interne

Tous les onglets suivent le même pattern :

```
TabComponent({ toast? })
├─ useState(...)            ← state local par onglet
├─ useApp()                 ← context global lu (sélectif)
├─ useEffect([], () => load())  ← charge les données au mount
├─ async load()             ← apiJson('/api/...')
├─ async actions(...)       ← apiPost / apiDelete + load() + toast
└─ return <div className="panel active">…</div>
```

Aucun onglet n'a de propre routing interne. Aucun n'utilise `useMemo` ou `useCallback` (sauf `AudioTab`).

## Audit du dossier

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🔴 | **Pas de gestion d'erreur visible** dans la majorité (try/catch silencieux). Un 500 ne dit rien à l'utilisateur. | Toaster les erreurs ou afficher un message dans le panel. |
| 🟠 | **Re-fetch complet après chaque action** (`load()` après `addX`/`removeX`) au lieu de mutation locale optimiste. | Update optimiste + invalidation. |
| 🟠 | **Pas de loader fin** — souvent juste un texte "Chargement…" sans skeleton. | Composant `<Spinner />` ou skeleton. |
| 🟠 | **Inline styles** envahissants dans tous les onglets. | Classes CSS. |
| 🟠 | **`AudioTab` est massif** (355 lignes) — concentre 5 sous-fonctionnalités. | Splitter en sous-composants. |
| 🟠 | **`toast` en prop drilling** — passé à 7 onglets. | Context. |
| 🟡 | **Render conditionnel `{loading && <X/>}`** sans typer `loading` initial → premier render parfois vide. | Initial state cohérent. |
| 🟡 | **Pas de pagination** sur `DbViewTab` — peut charger des centaines de lignes. | Pagination/virtualisation. |
