# `NotificationBell.jsx`

> **Cloche notif + dropdown** avec compteur de non-lues.
> 📂 `client/src/components/ui/NotificationBell.jsx`
> 🔗 Module : [`ui/`](./README.md)

## Résumé

Composant en deux parties dans le même fichier :

1. **`NotificationBell`** — bouton 🔔 + badge rouge "n" / "9+" + dropdown 320px avec header (titre + "Tout lire") et liste de `<NotifItem>`. Click extérieur ferme via overlay invisible plein écran.
2. **`NotifItem`** (interne, non exporté) — formate une notif selon son `type` (`invitation`, `invitation_accepted`, `session_started`, autre) en texte FR. Style l'item lu/non-lu, click → `onMarkRead(id)`.

Le payload est lu depuis `notif.payload_json` (JSON string) ou `notif.payload` (déjà objet).

## Composants / Hooks exportés

### `NotificationBell({ notifications, onMarkRead, onMarkAllRead })`

**Props attendues** :
- `notifications: Notif[]` — la liste complète (lues + non-lues).
- `onMarkRead: (id) => void`.
- `onMarkAllRead: () => void`.

**Brève** : bouton + dropdown.

**Comportement actuel** :
- `useState(open)` local.
- `unread` calculé à chaque render (`notifications.filter(n => !n.read)`).
- Dropdown rendu **conditionnellement** : si `open`, on ajoute aussi un overlay invisible plein écran (z-index 998) qui ferme au clic.
- Tous les styles inline.

**Comportement attendu (contrat)** :
- Click sur la cloche → toggle.
- Click sur "Tout lire" → `onMarkAllRead()` (pas de fermeture du dropdown).
- Click sur un item → `onMarkRead(id)` (item devient grisé).
- Click extérieur → ferme.

**Améliorations possibles** :
- A11y : `aria-haspopup`, `aria-expanded`, focus trap dans le dropdown.
- Échap pour fermer.
- Mémoïser `unread` via `useMemo`.

### `NotifItem({ notif, onMarkRead })` (interne)

**Brève** : rend une ligne formatée selon le type.

**Comportement** :
- Parse `payload_json` si string.
- Switch sur `notif.type` pour produire le texte.
- Stylise différemment lu/non-lu via opacité + background tinté.
- Affiche `created_at` formaté `toLocaleString()` en bas.

## State & Side effects

- **State local** : `open: boolean`.
- **Context utilisé** : non.
- **API appelée** : non (passe par `onMarkRead`/`onMarkAllRead`).
- **WebSocket** : non.
- **localStorage** : non.

## Dépendances

- **Importe** : `useState`.
- **Utilisé par** : `Header.jsx`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **A11y** : `aria-haspopup`, `aria-expanded`, navigation clavier flèches dans la liste. | Implémenter. |
| 🟠 | **`JSON.parse(notif.payload_json)` à chaque render** d'un item. | Parser une seule fois (au push/load). |
| 🟠 | **Tous les types non listés tombent dans `payload.message || notif.type`** — pas de vérité unique sur les types possibles. | Map exhaustif typé. |
| 🟡 | **`unread.length > 9 ? '9+' : unread.length`** : OK mais pas localisé (à un moment, "99+" ?). | Acceptable. |
| 🟡 | **Inline styles massifs** sur chaque élément. | CSS Module. |
| 🟡 | **Click sur item = mark-read sans confirmation** — si l'utilisateur clique pour lire le détail (qui n'existe pas ici), il marque lu sans le vouloir. | Bouton explicite. |
| 🟡 | **Date formatting `new Date(...).toLocaleString()`** — utilise la locale navigateur. Cohérent ailleurs. | RAS. |

## Notes alternatives

- Refacto possible : `<NotifItem>` extrait en fichier séparé avec un mapping `TYPE_FORMATTERS`.
