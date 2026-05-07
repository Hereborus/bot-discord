# `main.jsx`

> **Bootstrap React 18** — point d'entrée monté sur `#root`.
> 📂 `client/src/main.jsx`
> 🔗 Module : [`src/`](./README.md)

## Résumé

Mini-fichier (12 lignes) qui crée la racine React via `createRoot`, l'enveloppe d'un `<StrictMode>` (double-render des effets en dev pour détecter les bugs) et d'un `<AppProvider>` (contexte global), puis monte `<App />`.

C'est l'équivalent strict du template Vite officiel pour React. Aucune logique métier ici.

## Composants / Hooks exportés

Aucun export — fichier d'entrée uniquement.

## State & Side effects

- **State local** : aucun.
- **Context utilisé** : monte `<AppProvider>` (cf. [`context/AppContext.md`](./context/AppContext.md)).
- **API appelée** : aucune.
- **WebSocket** : aucun.
- **localStorage** : aucun.

## Dépendances

- **Importe** : `react` (`StrictMode`), `react-dom/client` (`createRoot`), `./context/AppContext.jsx` (`AppProvider`), `./App.jsx` (`App`).
- **Utilisé par** : `index.html` (via `<script type="module" src="/src/main.jsx">`).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | Pas de `ErrorBoundary` autour de `<App />`. Une exception non capturée crashe le bundle entier (écran blanc). | Ajouter un `ErrorBoundary` (composant class + fallback UI). |
| 🟡 | `document.getElementById('root')` non gardé — si l'élément manque, throw silencieux côté React. | Vérifier ou gérer le `null`. |

## Notes alternatives

- Pourrait charger un `<Suspense fallback>` global pour préparer un futur code-splitting des onglets (`React.lazy(() => import('./components/tabs/AdminTab.jsx'))`).
