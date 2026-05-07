# Audit frameworks

> Date : 2026-05-07
> Branche : `feat/full-migration`
> Auditeur : Claude (Opus 4.7)

## Synthèse

**Score global : 7 / 10**

La stack hereborus-bot est **globalement saine et cohérente** : ESM partout, séparation backend/frontend propre, modules `src/` bien découpés, sécurité prise au sérieux (HMAC, CORS dynamique, sanitisation `sharp`, rate limiting, signature de cookies en `timingSafeEqual`). Les versions des libs majeures (discord.js v14.26, @discordjs/voice 0.19, sharp 0.33, ws 8) sont **à jour ou très proches du latest**. Le routeur HTTP maison reste minimaliste (~50 lignes) et raisonnable pour le scope actuel.

Trois points noirs cependant : (1) **`fft-js@0.0.12`** est un package *abandonné* (dernière publication juin 2022, pre-alpha permanent) sur le **hot-path audio à 20 Hz par utilisateur** ; (2) **aucun outil de qualité de code** (ni ESLint, ni Prettier, ni type-checking JSDoc, ni lint-staged) ; (3) **routing frontend par `window.location.pathname`** fragile, qui empêche d'ajouter des écrans sans rebuild de la condition.

Le reste relève de l'optimisation incrémentale, pas de dette critique.

## Findings

### Critique

- **`fft-js@0.0.12`** — package abandonné (dernier release 2022-06-18), version sub-alpha (`0.0.x`), aucune issue triée, perf médiocre (objets `{re, im}` au lieu de `Float32Array` interleaved). Utilisé dans `src/bot/audio.js` à chaque tick 50 ms par user. À remplacer.

### Majeur

- **Pas d'ESLint / Prettier / formatter** — sur ~6 000 lignes JS, l'absence de lint laisse passer des bugs triviaux (variables shadow, imports non utilisés, `==` vs `===`).
- **Routing frontend en dur** (`window.location.pathname === '/positioner'`) — non extensible, casse si on veut ajouter `/share/:id`, `/embed/:token`, etc.
- **`index.js` à 1 935 lignes** — malgré la migration vers `src/`, le fichier racine reste monolithique (bot Discord, OAuth, WS, audio glue, server HTTP). Effort de découpage encore à faire mais pas un problème *de framework*.

### Mineur

- **`prism-media@1.3.5`** — pas de release depuis février 2023. Maintenu *de fait* via discord.js mais pas de nouvelle feature. OK tant que discord.js le linke.
- **`better-sqlite3` synchrone** — bloque l'event-loop sur grosses queries. À l'échelle actuelle (≤100 users concurrents, queries simples) c'est acceptable, mais à surveiller.
- **CSS non modulaire** — `styles.css` à 1 703 lignes, plus `client/src/components/positioner/positioner.css` (375 lignes), pas de scope par composant.
- **Pas de bundle analyzer** — aucune visibilité sur la taille des assets Vite.
- **Pas de state manager** — pour le scope actuel le Context API suffit, mais re-renders sur changement `audioConfig`/`levels` peuvent dégrader le FPS du panneau.

## Détail par catégorie

### Backend

#### 1. Native HTTP server (vs Express / Fastify / Hono)

| Aspect | Évaluation |
|--------|-----------|
| Pourquoi c'est bien | Zéro deps, contrôle complet sur la gestion des body-parsers (multipart maison à 30 lignes), perf comparable à Fastify pour le scope, code testable sans mock du framework |
| Pourquoi c'est risqué | Réimplémentation de routing (pattern `:param` + `*`), CORS, JSON parsing, error handling, rate-limiter — chaque morceau est un risque sécu (cf. CVE-2022-24999 sur `qs`, parsers multipart vulnérables, etc.) |
| Code actuel | `src/http/router.js` (50 lignes) propre, `src/http/helpers.js` clair, `src/http/middleware.js` minimaliste |
| Trous à boucher | Pas de support `HEAD` automatique, pas de `OPTIONS` global pour CORS preflight (chaque handler le gère), pas de gestion centralisée des erreurs (chaque route fait son `try/catch`) |

**Alternatives 2026** :
- **Fastify 5.8** : 30k+ req/s, plugin system mature, validation JSON Schema intégrée, écosystème (`@fastify/multipart`, `@fastify/cookie`, `@fastify/cors`) → migration en ~6 h, gain énorme sur upload + validation
- **Hono 4.12** : ultra-léger (~12 kB), API moderne (Web Fetch), edge-ready, TypeScript-first, mais écosystème encore jeune côté multipart
- **Express 5.1** : LTS, gigantesque écosystème, mais perf en-dessous (~10x plus lent qu'Hono/Fastify)

**Recommandation : KEEP** pour le moment, **MAIS** :
- Documenter explicitement les choix de sécurité du routeur maison (déjà fait dans `src/http/router.js`)
- Si une refonte devient nécessaire (ex: passage HTTP/2, websockets natives, rate-limiting distribué), migrer vers **Fastify 5** plutôt que d'enrichir le routeur custom
- Risque acceptable tant que le code reste sous 100 lignes par fichier `src/http/`

#### 2. discord.js v14.25.1 → latest 14.26.4

- Mise à jour mineure non urgente, breaking changes nuls entre 14.25 et 14.26
- **discord.js v15 prévu fin 2026** (cf. roadmap GitHub) — préparer la migration en gardant `subscribeUser` isolé dans `src/bot/audio.js`
- Alternatives : **Eris 0.18** (plus bas-niveau, perf++, mais maintenance ralentie), **Oceanic.js 1.14** (TypeScript-first, fork moderne d'Eris, en croissance) — pas de raison de migrer
- **Recommandation : KEEP** + bump à `^14.26.4` au prochain `npm update`

#### 3. better-sqlite3 v11 → latest v12.9

- v12 : prebuild Node 22 ✓, breaking change mineur (Node 18 droppé — déjà sur Node 22)
- **Synchrone par design** : bloque l'event-loop. Pour ce projet (queries < 1 ms, indexées), c'est acceptable
- Si scaling nécessaire :
  - **`@libsql/client` 0.17** — fork SQLite avec mode async, replicas, embedded ou serveur Turso (gratis tier généreux)
  - **PostgreSQL** via `pg` 8.x — overkill ici, mais option si jamais multi-instance
- **Recommandation : BUMP vers 12.9** (effort 30 min, juste vérifier les prepared statements)

#### 4. fft-js v0.0.12 — **À REMPLACER**

État du package :
- Dernière version : **0.0.12** publiée le **2022-06-18** (~3.9 ans)
- Numéro `0.0.x` = jamais sorti d'alpha, abandonné par l'auteur (cf. GitHub issues sans réponse depuis 2023)
- Aucun audit sécu, dépendances non maintenues
- Format des données : `Array<[real, imag]>` → coût de conversion depuis `Float32Array`

Alternatives concrètes :

| Package | Version | Perf relative | Bundle | Verdict |
|---------|---------|---------------|--------|---------|
| **`webfft@1.0.3`** | 1.0.3 (2024) | ⭐⭐⭐⭐⭐ (10–100x) | ~30 kB | Auto-tuning de l'algo selon la taille, WASM optionnel — recommandé |
| `@thi.ng/fft` | 8.x | ⭐⭐⭐⭐ | ~15 kB | API propre, TS-first, in-place sur `Float64Array` |
| `dsp.js` | 1.0 | ⭐⭐⭐ | 5 kB | Fonctionnel mais plus maintenu |
| FFT custom (Cooley-Tukey, ~60 lignes) | — | ⭐⭐⭐ | 0 kB | Pour 1024 points en radix-2, faisable et auditable |

**Recommandation : SWITCH urgent vers `webfft@1.0.3`** (effort 2 h y compris adaptation `computeFreqBands` pour consommer un `Float32Array` interleaved au lieu de `Array<[r, i]>`).

#### 5. prism-media v1.3.5

- Dernière version : 1.3.5 (février 2023). Stagnant mais **toujours utilisé par discord.js officiel**
- Pas d'alternative crédible : `@discordjs/voice` ne fournit pas le décodeur Opus standalone
- **Recommandation : KEEP**, surveiller les annonces discord.js v15

#### 6. sharp v0.33 → latest v0.34.5

- v0.34 : libvips 8.16, gain perf ~10 %
- **Recommandation : BUMP vers 0.34.5** au prochain `npm update`

#### 7. ws v8.18.x → latest v8.20

- Mainstream, OK
- Alternative perf : **uWebSockets.js** (10x throughput, mais native binding, déploiement plus complexe)
- **Recommandation : KEEP** — `ws` suffit pour ~50 conns simultanées

#### 8. dotenv v17.3.1 → latest v17.4.2

- **Recommandation : BUMP** (patch sans risque)

#### 9. @discordjs/opus, sodium-native, @snazzah/davey

- À jour. **KEEP**.

### Frontend

#### 1. React 18.3 + Vite 5.4

- React **19.2** disponible (oct 2024), apporte `use()` hook, `useActionState`, server actions (non applicable SPA), compiler RC
- Vite **8.0** disponible (refactoring Rolldown, build 5–10x plus rapide)
- Migration React 18 → 19 = effort ~2 h (changements mineurs sur `forwardRef`, `useEffect` cleanup)
- **Recommandation** : **BUMP Vite vers 7.x** (gain CI), **HOLD React 19** jusqu'à ce que les libs tierces (très peu ici) le supportent — rebump à la prochaine session

#### 2. Pas de routeur (fragile)

```js
// client/src/App.jsx ligne 33
const IS_POSITIONER = window.location.pathname === '/positioner';
```

Problème : ajouter `/embed/:token` ou `/share/:id` demande un `if/else` en cascade, pas de history API, pas de query parsing centralisé.

| Option | Bundle | Verdict |
|--------|--------|---------|
| **`wouter@3.9.0`** | ~1.5 kB | Idéal pour ce projet : API React-Router-like, hooks-only, pas de Provider lourd |
| `react-router-dom@7.15` | ~12 kB | Standard mais overkill pour 2 routes |
| `@tanstack/router` | ~30 kB | Type-safe, file-based — overkill ici |

**Recommandation : SWITCH vers `wouter@3.9.0`** (effort 1 h, swap propre, +1.5 kB de bundle).

#### 3. Pas de state manager externe

Context API utilisé dans `client/src/context/AppContext.jsx` :
- **OK** tant que les valeurs changent peu (auth, tier, config)
- **Risque** : `levels` poll à 100 ms → tout le sous-arbre re-render. À profiler avec React DevTools

Alternatives :
- **Zustand 5.0** : 1.2 kB, sélecteurs fins → re-renders ciblés, idéal pour le `levels` polling
- Jotai, Valtio : pertinents si on adopte un modèle atomique

**Recommandation : SWITCH partiel** — déplacer `levels` (haute fréquence) vers un store **Zustand** dédié, garder Context pour le reste. Effort 1 h.

#### 4. Pas de TypeScript

Convention projet (CLAUDE.md). Le coût de migration est :
- ~6 000 lignes JS backend + ~3 000 lignes JSX
- Effort migration progressive (`allowJs: true`, `checkJs: true`) : ~2 jours wall-clock
- Bénéfice : auto-complétion sur `ctx.session`, `ctx.tierLimits`, `frames[]`, contrats DB

**Alternative low-cost : `// @ts-check` + JSDoc** sur les modules critiques (`src/services/*.js`, `src/db/repos/*.js`) — détecte 80 % des bugs sans renoncer à la convention JS. Effort ~3 h.

**Recommandation : KEEP JS**, mais **ajouter `// @ts-check` + JSDoc types** sur `src/services/` et `src/db/repos/` (gain dev sans rupture de convention).

#### 5. Vite config (`client/vite.config.js`)

Audit :
- ✓ Proxy bien configuré pour toutes les routes API
- ✓ `outDir: '../dist'` → cohérent avec le service Node
- ✗ **Pas de code splitting** : tous les onglets (`AdminTab`, `DbViewTab`, `PositionerApp`) sont dans le bundle initial
- ✗ **Pas de visualizer** : impossible d'auditer la taille
- ✗ **Pas de `define`** pour `__APP_VERSION__` ou la build date

Améliorations proposées :

```js
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  plugins: [
    react(),
    process.env.ANALYZE && visualizer({ open: true, gzipSize: true, brotliSize: true })
  ],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'positioner': ['./src/components/positioner/PositionerApp.jsx'],
          'admin': ['./src/components/tabs/AdminTab.jsx', './src/components/tabs/DbViewTab.jsx'],
        }
      }
    }
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
  }
});
```

Et l'utilisation de `lazy()` pour les onglets rares :
```jsx
const AdminTab = lazy(() => import('./components/tabs/AdminTab.jsx'));
const PositionerApp = lazy(() => import('./components/positioner/PositionerApp.jsx'));
```

#### 6. Stratégie CSS

État : `styles.css` (1 703 lignes) à la racine + `positioner.css` (375 lignes) à côté du composant.

Options :
- **CSS Modules** (intégré Vite) : `Component.module.css` → scoping automatique, zéro runtime, **recommandé**
- Tailwind 4 : refonte complète (~2 jours)
- styled-components / emotion : runtime cost, pas adapté à un panneau de contrôle

**Recommandation** : **migration progressive vers CSS Modules par composant** sur les nouveaux écrans, garder `styles.css` global pour le reset + variables CSS. Effort 4–6 h pour la moitié du panneau.

### Outils manquants — à ajouter

| Outil | Version | Pour quoi | Effort |
|-------|---------|-----------|--------|
| **ESLint 10** + `eslint-plugin-react`, `eslint-plugin-react-hooks` | 10.3 | Lint backend + frontend, catch bugs triviaux | 1 h |
| **Prettier 3.8** | 3.8 | Format auto cohérent | 30 min |
| **`lint-staged` + `simple-git-hooks`** | latest | Lint au commit (sans Husky overhead) | 30 min |
| **`rollup-plugin-visualizer` 7** | 7.0 | Audit bundle Vite | 15 min |
| **`@types/node`, `@types/react` + JSDoc + `tsc --noEmit`** | latest | Type-checking incrémental sans TS | 3 h |

Configuration minimale ESLint suggérée (`eslint.config.js`) :
```js
export default [
  { languageOptions: { ecmaVersion: 2024, sourceType: 'module' } },
  { rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'eqeqeq': 'error',
    'no-undef': 'error',
    'prefer-const': 'warn',
  }},
];
```

## Plan d'action priorisé

| Priorité | Action | Effort | Impact |
|----------|--------|--------|--------|
| **P0** | Remplacer `fft-js@0.0.12` par `webfft@1.0.3` (abandoned, hot-path 20 Hz) | 2 h | Sécu + perf (~5x sur FFT) |
| **P0** | Ajouter ESLint + Prettier + `simple-git-hooks` (qualité de code zéro coût) | 2 h | Maintenabilité |
| **P1** | Bump `better-sqlite3` v11 → v12, `sharp` v0.33 → v0.34, `dotenv` v17.3 → v17.4, `discord.js` v14.25 → v14.26 | 1 h | Sécu + bug-fixes |
| **P1** | Ajouter routeur frontend `wouter@3.9` (remplace `IS_POSITIONER`) | 1 h | Extensibilité |
| **P1** | Code splitting Vite + `rollup-plugin-visualizer` + `lazy()` sur 3 onglets rares | 1.5 h | Perf chargement initial |
| **P2** | Migrer `levels` (poll 100 ms) vers store **Zustand** dédié, garder Context pour le reste | 1 h | Perf React (FPS panneau) |
| **P2** | Bump Vite v5 → v7 | 1 h | Build time |
| **P2** | Ajouter `// @ts-check` + JSDoc types sur `src/services/` et `src/db/repos/` | 3 h | DX, catch bugs |
| **P3** | Migration CSS Modules progressive sur les composants nouveaux/refactorés | 6 h amorti | Maintenabilité styles |
| **P3** | Décomposer `index.js` (1 935 lignes) en `src/server.js` + `src/bot/discord.js` finalisé + `src/routes/auth.js` complet | 6 h | Maintenabilité |

**Total P0 : 4 h** (gain immédiat sécu + lint).
**Total P0+P1 : 9 h** (stack à jour + extensibilité).
**Total P0+P1+P2 : 14 h** (production-ready).
