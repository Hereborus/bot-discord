# `TabBar.jsx`

> **Barre d'onglets filtrée par rôle** + bouton "Inviter le bot".
> 📂 `client/src/components/layout/TabBar.jsx`
> 🔗 Module : [`layout/`](./README.md)

## Résumé

Définition statique de 9 onglets (constante `ALL_TABS`), chacun avec une liste de rôles autorisés. Filtre selon `effectiveRole` du contexte. À droite, un bouton SVG Discord pour ouvrir l'URL d'invitation du bot — visible uniquement si admin ET si le backend a renvoyé `botInfo.inviteUrl`.

## Composants / Hooks exportés

### `TabBar({ activeTab, onSwitch, botInfo })`

**Props attendues** :
- `activeTab: string` — clé de l'onglet actif (ex: `'avatars'`).
- `onSwitch: (key: string) => void` — handler de changement.
- `botInfo: { inviteUrl?: string } | null` — infos du bot (chargées dans `App.jsx`).

**Brève** : composant 100% présentationnel.

**Comportement actuel** :
- Filtre `ALL_TABS` selon `effectiveRole`.
- Rend chaque tab comme `<button>` avec classe `active` conditionnelle.
- Spacer flex-1, puis bouton invite.

**Comportement attendu (contrat)** :
- Si l'onglet actif n'est plus dans `visible` (rôle changé), aucun comportement défini ici → `ControlApp` continue de rendre cet onglet (cf. audit `App.md`).

**Améliorations possibles** :
- Mémoïser `visible` via `useMemo`.
- Si `activeTab` n'est plus visible, émettre un `onSwitch('avatars')` automatique.
- A11y : `role="tablist"` + `role="tab"` + `aria-selected` + flèches clavier.

## State & Side effects

- **State local** : aucun.
- **Context utilisé** : `effectiveRole`.
- **API appelée** : non.
- **WebSocket** : non.
- **localStorage** : non.

## Dépendances

- **Importe** : `useApp`.
- **Utilisé par** : `App.jsx`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **A11y** : pas de `role="tablist"` / `role="tab"` / navigation clavier flèches. | WAI-ARIA Tab pattern. |
| 🟠 | **Pas de fallback** si `activeTab` n'est plus dans `visible` (changement de rôle). L'app pourrait afficher un onglet sans bouton de retour. | Reset auto sur changement de rôle. |
| 🟡 | **Mauvaise factorisation** : la liste `ALL_TABS` contient des emojis hardcodés ; réutilisable comme source de vérité depuis le routing si on en avait. | Extraire dans un module config. |
| 🟡 | **Bouton invite SVG inline** — alourdit le composant. | Extraire en composant `<DiscordIcon />`. |
| 🟡 | Pas de `key` stable pour les tabs (utilise `t.key`, OK). | RAS. |

## Notes alternatives

- Si on ajoute beaucoup d'onglets, intégrer un menu kebab pour les overflow.
