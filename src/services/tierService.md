# `tierService.js`

> **Résolution du tier d'un user (free/premium/streamer) + middlewares premium.**
> `src/services/tierService.js`
> Module : [`services/`](./README.md)

## Résumé

Définit `TIER_LIMITS` (table de capacités par tier) et résout le tier d'un user dans cet ordre : abonnement direct actif → seat dans un pack streamer → `free`. Expose deux middlewares : `loadTier` injecte `ctx.tier` + `ctx.tierLimits`, `requirePremium` bloque les frees.

## Fonctions / Exports

### `TIER_LIMITS` — `Record<'free'|'premium'|'streamer', limits>`

**Brève** : table déclarative des limites (états max, frames max, features booléennes, max participants).
**Contrat attendu** : `Infinity` = pas de limite côté code (toujours capper côté UI/upload). `free` = 2 états × 3 frames + emotions/hotkeys/miniApp/calibration désactivés.
**Améliorations** : aucune (table claire).

### `getUserTier(discordId)` → `'free' | 'premium' | 'streamer'`

**Brève** : 1) abonnement direct (`subscriptions.get`) ; 2) seat actif (`seats.byUser`) ; 3) `free`.
**Comportement actuel** :
- Si `sub` existe et `expires_at < now` → appelle `subscriptions.expire.run()` (purge globale, pas seulement cet user) puis tombe dans le branch suivant.
- Si seat actif (`sub_status='active'`) → retourne **`premium`** même si le pack est `streamer`.
**Contrat attendu** : pure (mais I/O DB) ; deux lookups SQLite par appel.
**Améliorations possibles** :
- Le retour `premium` pour un seat dans un pack streamer est **intentionnel** mais pas évident dans le code — un commentaire l'explique partiellement, mais l'absence de mapping `seat → tier` dans la table le rend fragile.
- Aucune **mise en cache** : appelé à chaque requête via `loadTier`.

### `loadTier(req, res, ctx)` → `boolean` *(middleware)*

**Brève** : injecte `ctx.tier` et `ctx.tierLimits` ; pas-thru si pas de session.
**Contrat attendu** : à chaîner après `requireAuth` ; ne fait rien si auth absent.

### `requirePremium(req, res, ctx)` → `boolean` *(middleware)*

**Brève** : bloque si `ctx.tier === 'free'`. **N'envoie pas la 403 lui-même** — laisse le caller faire.
**Comportement actuel** : retourne `false` sans `res.writeHead(403)` ⇒ le router doit avoir un fallback générique pour fermer la réponse, sinon la connexion hang.
**Améliorations possibles** : harmoniser avec les autres middlewares de [`http/middleware.js`](../http/middleware.md) qui font `json(res, ..., 403, req)` directement.

## Dépendances
- **Importe** : [`db/repos/subscriptions.js`](../db/repos/subscriptions.js).
- **Utilisé par** : [`routes/upload.js`](../routes/upload.js) (limite frames), [`routes/config.js`](../routes/config.js) (strip premium keys), `index.js` (chaînes de middlewares).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | `requirePremium` retourne `false` sans envoyer de réponse — risque de **handler hang** si le caller oublie d'envoyer la 403. | Faire `json(res, { error: 'Premium requis' }, 403, req)` puis retourner `false`. |
| 🟠 | `subscriptions.expire.run()` purge **tous** les abonnements expirés à chaque hit sur un user ayant un sub expiré → write SQLite imprévue sur le hot-path read. | Ne purger qu'une fois par minute via `setInterval`, ou marquer puis purger en batch. |
| 🟡 | Aucun cache — `getUserTier` exécute 1-2 lookups SQLite par requête. | Cache `Map<discordId, { tier, exp }>` avec TTL 30 s, invalidé sur `/api/subscription` POST/DELETE. |
| 🟡 | Pas de tier `streamer` retourné en sortie — les seats sont mappés à `premium`. Si un futur feature distingue streamer/premium côté UI, l'info est perdue. | Retourner `{ tier, source: 'subscription' | 'seat' }`. |

## Notes alternatives

`TIER_LIMITS.free.maxStates = 2` est dur-codé : un futur passage à 3 par exemple impose une migration manuelle des comptes existants. Acceptable tant que les limites ne bougent pas souvent.
