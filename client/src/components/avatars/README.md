# `avatars/`

> **Carte utilisateur live + modal de configuration des frames PNG.**
> 🔗 Parent : [`components/`](../README.md)

## Vue d'ensemble

Deux composants spécialisés autour d'un "utilisateur PNGTuber" :

- **`UserCard`** : tuile rendue dans `AvatarsTab` pour chaque token actif. Affiche le nom, le statut speaking, l'avatar live (flipbook PNG selon dB + freq), un canvas de bars de fréquence (low/mid/high), un footer dB + état courant, et un bouton "⚙ Configurer" pour les utilisateurs autorisés.
- **`UserSettingsModal`** : modal d'upload de frames PNG par état (drag & drop + click). Pour chaque état (silent, low, medium, high, plus _closed et émotions), affiche la grille des frames existantes (avec bouton ✕ pour supprimer) et une zone d'ajout. Bouton 📐 ouvre le `/positioner` dans une nouvelle fenêtre pour cet état.

## Fichiers

| Fichier | Brève | Doc complète |
|---------|-------|--------------|
| `UserCard.jsx` | Tuile live (avatar flipbook + bars audio canvas). | [UserCard.md](./UserCard.md) |
| `UserSettingsModal.jsx` | Modal grille upload de frames par état. | [UserSettingsModal.md](./UserSettingsModal.md) |

## Architecture interne

```
AvatarsTab
└─ <UserCard token=... levelInfo={live[token]} onOpenSettings={setSettingsToken}/>
     ├─ resolveState() → state actif selon dB
     ├─ flipbook setInterval(audioConfig.frameSpeed)
     ├─ <canvas> bars audio (rAF)
     └─ button → onOpenSettings(token)

App
└─ {settingsToken && <UserSettingsModal token onClose toast/>}
     ├─ allStates.map → <Tile state>
     │     ├─ frames existantes (img + ✕)
     │     ├─ bouton 📐 → window.open('/positioner?...')
     │     └─ <input file accept="image/*" multiple/>
     └─ POST /upload + POST /delete-frame
```

## Audit du dossier

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🔴 | **`UserCard`** : ré-instancie son `setInterval` flipbook + setup canvas à chaque change de `freq`/`speaking` (deps du useEffect canvas) — coûteux à 10 fps. | Sortir le canvas dans son propre composant mémoïsé, passer freq via ref. |
| 🟠 | **`UserSettingsModal`** : pas de validation côté client de la taille / type / quota (limites tier). Backend gère, mais UX confuse. | Pré-valider. |
| 🟠 | **Inline styles** très dense dans les deux fichiers. | CSS Modules. |
| 🟡 | **`UserCard.dangerouslySetInnerHTML` n'est PAS utilisé ici** (c'est dans AvatarsTab). RAS. | — |
