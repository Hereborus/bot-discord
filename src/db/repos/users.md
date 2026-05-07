# `users.js`

> Repository pour `users` (config audio) et `frames` (images d'avatar).
> 📂 `src/db/repos/users.js`
> 🔗 Module : [`repos/`](./README.md)

## Résumé

Cœur du persistance par utilisateur :
- Table **`users`** : indexée par token opaque (HMAC du discordId). Stocke `display_name` et `config_json` (config audio sérialisée).
- Table **`frames`** : un enregistrement par image uploadée, lié à `users.token` par FK.

Tous les statements sont **prepared une seule fois** au chargement du module et réutilisés — bénéfice de better-sqlite3 (pas de re-parse SQL à chaque appel).

## Fonctions / Exports

### `users.get` → SELECT par token

Lookup unitaire — utilisé partout pour vérifier l'existence d'un user.

### `users.upsert` → INSERT … ON CONFLICT

UPSERT sur `token`. Met à jour `display_name`, `config_json`, `updated_at` sur conflit.

### `users.getConfig` / `users.setConfig`

Lecture / écriture isolées de `config_json`. Permet de modifier la config sans toucher `display_name` (utile pour les MAJ partielles depuis l'agent local).

### `users.all` → SELECT \*

Sans pagination — utilisé par `handleKnownUsers` ([routes/config.md](../../routes/config.md)). Acceptable pour quelques dizaines d'users, problématique au-delà.

### `frames.byToken` → SELECT triées

`ORDER BY state_key, sort_order` — résultat exploité directement par `handleGetFrames` ([routes/frames.md](../../routes/frames.md)) pour grouper côté JS.

### `frames.byState` → SELECT par état

Filtre par `(token, state_key)` — lecture pour le viewer.

### `frames.insert` → INSERT OR IGNORE

L'IGNORE évite la collision sur la clé unique (probablement `token, state_key, filename`). Mais masque les doublons silencieusement — l'appelant ne sait pas si l'INSERT a fait quelque chose.

### `frames.delete` → DELETE par triplet

Hard delete d'une frame.

### `frames.deleteAll` → DELETE par token

Utilisé par `handleDeleteUser` ([routes/admin.md](../../routes/admin.md)) — purge toutes les frames d'un user.

### `frames.updateOrder` → UPDATE sort_order

Pour le réordo. L'appelant doit boucler sur la liste ordonnée (idéalement dans une transaction — voir [routes/upload.md](../../routes/upload.md)).

### `frames.maxOrder` → SELECT MAX

`COALESCE(MAX(sort_order), -1)` — astuce élégante : si la table est vide, retourne -1 et la prochaine frame sera à l'index 0.

### `frames.move` → UPDATE state_key

Change le state_key d'une frame existante. Pas de garde sur la collision avec une frame existante dans la cible (cf. [routes/frames.md](../../routes/frames.md) audit).

### `frames.stats` → SELECT agrégats globaux

Pour le dashboard admin : `user_count`, `frame_count`, `total_size`. **3 sous-requêtes** chacune scannant la table — coûteux si nombre de frames élevé (>10k).

### `frames.allForAdmin` → SELECT JOIN

LEFT JOIN avec `users` pour exposer `display_name` au DB browser. Pas de pagination — voir audit.

## Dépendances

- **Importe** : [`db/database`](../database.js)
- **Utilisé par** : 
  - [`routes/admin.js`](../../routes/admin.md) (`users`, `frames` pour stats/allForAdmin/deleteAll)
  - [`routes/frames.js`](../../routes/frames.md)
  - [`routes/config.js`](../../routes/config.md) — indirect via `stmts` deps-injecté
  - [`routes/upload.js`](../../routes/upload.md) — indirect via `stmts`

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 Maj | `users.all` et `frames.allForAdmin` sans pagination | LIMIT/OFFSET — DoS mémoire sur grosse base |
| 🟠 Maj | `frames.stats` : 3 sous-requêtes par appel | Cache 60s ou indexes adéquats (`COUNT(*)` sur SQLite est lent en grosse table) |
| 🟡 Min | `frames.insert` (INSERT OR IGNORE) masque les doublons | Retourner `result.changes` |
| 🟡 Min | `frames.move` ne gère pas la collision (UNIQUE violation possible) | Soit rename auto, soit DELETE existant en transaction |
| 🟡 Min | Pas de méthode `users.delete` exposée — admin.js fait `db.prepare('DELETE FROM users')` direct | Ajouter `users.delete` au repo pour cohérence |
| 🟡 Min | Pas de méthode `users.purgeOrphans` (users sans frames depuis X mois) | Hygiène |
| 🟡 Min | `display_name` non longueur-bornée | Côté schema (CHECK length) ou applicatif |

## Notes alternatives

Le manque d'une méthode `users.delete` (orchestrant la suppression cross-tables) explique l'import dynamique dans `admin.js`. Recommandation : exposer `users.purge(token)` qui fait :
```js
db.transaction(() => {
  framesDeleteAll.run(token);
  // delete pngtuber_sessions where owner... (cascade?)
  // delete session_participants where token...
  // delete avatar_permissions where token...
  // delete users where token...
})()
```

Cela permettrait à `admin.js` d'appeler simplement `users.purge(token)` sans import dynamique ni inconsistance.

`config_json` stocké en string opaque a l'avantage de la flexibilité mais l'inconvénient des requêtes natives impossibles ("tous les users avec emotionsEnabled"). Migration possible vers SQLite JSON1 ext (`json_extract`) si requis.
