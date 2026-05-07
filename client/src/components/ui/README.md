# `ui/`

> **Primitives UI réutilisables** — Modal, Toast, NotificationBell.
> 🔗 Parent : [`components/`](../README.md)

## Vue d'ensemble

Trois composants atomiques sans logique métier :

- **`Modal`** : overlay simple, fermeture au clic extérieur, slot `children`. + `<ModalRow>` helper de layout interne.
- **`ToastContainer`** : rend la file de toasts (alimentée par le hook `useToast`).
- **`NotificationBell`** : icône cloche + dropdown avec liste des notifs, `unread` count visible (max "9+"), clic extérieur ferme.

Aucun de ces composants ne lit le contexte directement — tout passe par props (bonne pratique).

## Fichiers

| Fichier | Brève | Doc complète |
|---------|-------|--------------|
| `Modal.jsx` | Overlay simple + `<ModalRow>` (12 lignes). | [Modal.md](./Modal.md) |
| `NotificationBell.jsx` | Cloche + dropdown notifs. | [NotificationBell.md](./NotificationBell.md) |
| `Toast.jsx` | Container des toasts (10 lignes). | [Toast.md](./Toast.md) |

## Architecture interne

```
ControlApp
├─ <Modal open={obsModalOpen} onClose={...}>
│    ├─ <p>texte</p>
│    └─ <ModalRow><buttons/></ModalRow>
└─ <ToastContainer toasts={toasts}/>

Header
└─ <NotificationBell notifications={...} onMarkRead={...} onMarkAllRead={...}/>
     └─ <NotifItem/>  (interne)
```

## Audit du dossier

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **Aucun composant n'est mémoïsé** — re-render à chaque tick de l'app. | `React.memo`. |
| 🟠 | **Modal sans portail** (pas de `createPortal`) — risque d'accroc avec les `z-index`/transform du parent. | `createPortal(children, document.body)`. |
| 🟠 | **A11y absente** : pas d'`aria-modal`, pas de focus trap, pas de `Escape` pour fermer. | Implémenter ou utiliser une lib (Radix). |
| 🟡 | **`NotificationBell`** : parsing `JSON.parse(notif.payload_json)` dans le render — inefficace. | Le faire en amont (au push/load). |
| 🟡 | **NotifItem défini dans le même fichier** que `NotificationBell` (pas un sous-fichier). | OK pour ce projet, mais pourrait être extrait. |
