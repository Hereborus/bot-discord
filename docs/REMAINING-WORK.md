# Plan du travail restant — post-PR `release/v2-with-fixes`

> Inventaire exhaustif et actionnable de ce qui n'a **pas** été fait dans la PR `release/v2-with-fixes`.
> Chaque item contient : localisation précise, description du problème, plan de fix étape par étape, et estimation d'effort wall-clock.
>
> Date : 2026-05-07
> PR liée : [#2](https://github.com/Hereborus/bot-discord/pull/2)

---

## Sommaire

- [Erratum sur ROADMAP.md](#erratum-sur-roadmapmd)
- [P1 — Hardening backend (non fait)](#p1--hardening-backend-non-fait)
  - [1. `bot/audio.js subscribeUser` sans cleanup](#1-botaudiojs-subscribeuser-sans-cleanup)
  - [2. `tierService` cache manquant + `requirePremium` ne send pas 403](#2-tierservice-cache-manquant--requirepremium-ne-send-pas-403)
  - [3. `subscriptions.expire` sur hot path](#3-subscriptionsexpire-sur-hot-path)
  - [4. Duplication userLevels → JSON dans `index.js`](#4-duplication-userlevels--json-dans-indexjs)
  - [5. Logger structuré (pino) — `console.log/error` partout](#5-logger-structur%C3%A9-pino--consolelogerror-partout)
- [P1 — Frontend perf/qualité (non fait)](#p1--frontend-perfqualit%C3%A9-non-fait)
  - [6. `PositionerApp` mélange DOM mutations + React renders](#6-positionerapp-m%C3%A9lange-dom-mutations--react-renders)
  - [7. `AvatarsTab` `dangerouslySetInnerHTML`](#7-avatarstab-dangerouslysetinnerhtml)
  - [8. `try { } catch {}` silencieux partout](#8-try---catch--silencieux-partout)
  - [9. Aucun `ErrorBoundary` global](#9-aucun-errorboundary-global)
  - [10. `TIER_COLORS` dupliqué](#10-tier_colors-dupliqu%C3%A9)
  - [11. Code mort / imports inutilisés](#11-code-mort--imports-inutilis%C3%A9s)
  - [12. Inline styles partout](#12-inline-styles-partout)
- [P1 — Migration `index.js` → `src/` (continuation)](#p1--migration-indexjs--src-continuation)
- [P2 — Tests P0 manquants (6 modules)](#p2--tests-p0-manquants-6-modules)
- [P2 — Frameworks (deferes)](#p2--frameworks-deferes)
  - [13. `fft-js` → `webfft`](#13-fft-js--webfft)
  - [14. Routeur frontend `wouter`](#14-routeur-frontend-wouter)
- [P3 — Kubernetes manifests réels](#p3--kubernetes-manifests-r%C3%A9els)
- [P3 — Scaling horizontal](#p3--scaling-horizontal)
- [Estimation totale](#estimation-totale)

---

## Erratum sur ROADMAP.md

`docs/ROADMAP.md` (commit `e4f0d7d`) a été écrit **avant** l'exécution des fixes et marque ✅ certains items qui n'ont en fait **pas** été appliqués. Les statuts réels post-PR sont :

| Item | Statut ROADMAP.md | Statut réel |
|------|--------------------|-------------|
| `bot/audio.js subscribeUser` cleanup | ⏳ | ⏳ (correct) |
| `tierService` cache + `requirePremium` 403 | ⏳ | ⏳ (correct) |
| Logger structuré | ⏳ | ⏳ (correct) |
| Migration `index.js` → `src/` complète | ⏳ | ⏳ (correct) |
| Compat layer `stmts` retrait | ⏳ | ⏳ (correct) |
| Duplication userLevels JSON | ⏳ | ⏳ (correct) |
| `PositionerApp` mixin DOM/React | ⏳ | ⏳ (correct) |
| `AvatarsTab` `dangerouslySetInnerHTML` | ⏳ | ⏳ (correct) |
| Tests P0 complets (7 modules) | ⏳ | 1/7 fait (tokenService) |
| K8s manifests réels | ⏳ | ⏳ (correct, doc seulement) |

> Tout ce qui était ✅ dans ROADMAP.md à la création est bien fait dans la PR. Les ⏳ sont décrits ci-dessous.

---

## P1 — Hardening backend (non fait)

### 1. `bot/audio.js subscribeUser` sans cleanup

**Localisation** : `src/bot/audio.js#subscribeUser` (autour de la ligne ~250 selon la dernière version).

**Problème** : la fonction `subscribeUser(receiver, userId, ...)` attache des listeners (`receiver.subscribe(...).on('data', ...)`) mais ne retourne pas de fonction `cleanup()`. Si Discord drop la connexion sans émettre les events `end/close/error` attendus, les listeners et le buffer FFT restent en mémoire — fuite progressive sur des sessions longues.

**Plan étape par étape** :

1. Lire `src/bot/audio.js` pour identifier toutes les ressources allouées dans `subscribeUser` :
   - listeners sur `opusStream`
   - intervals/timeouts (ex: emotion stabilization)
   - entrées dans `userLevels` Map
   - buffers locaux LPC/FFT
2. Refactorer la signature :
   ```js
   export function subscribeUser(receiver, userId, ...) {
       const opusStream = receiver.subscribe(userId, { end: { behavior: 'manual' } });
       // ... attacher listeners ...
       const cleanup = () => {
           opusStream.removeAllListeners('data');
           opusStream.destroy();
           clearTimeout(emotionStabilizationTimer);
           userLevels.delete(userId);
           // remettre _lpcX/_lpcR à 0 si partagé
       };
       opusStream.on('end', cleanup);
       opusStream.on('close', cleanup);
       opusStream.on('error', cleanup);
       return { cleanup, opusStream };
   }
   ```
3. Mettre à jour le caller dans `src/bot/discord.js` (handler `voiceStateUpdate` ou ready) pour stocker `cleanup` par userId et l'appeler quand l'utilisateur quitte le canal.
4. Ajouter un timeout de garde (ex: 60s sans data → cleanup forcé).

**Effort** : ~2h wall-clock.

**Test à ajouter** : simuler un drop Discord (mock receiver qui n'émet pas `end`), vérifier que `userLevels` est purgé après timeout.

---

### 2. `tierService` cache manquant + `requirePremium` ne send pas 403

**Localisation** :
- `src/services/tierService.js#getUserTier`
- `src/services/tierService.js#requirePremium`

**Problème 1** : `getUserTier(discordId)` fait 1-2 lookups SQLite (`subscriptions.get`, `subscription_seats.has`) à chaque requête authentifiée. Sur le polling `/levels` à 10x/s × N consommateurs, c'est 20-40 SQLite calls/s pour des données qui changent rarement (jours/semaines).

**Problème 2** : `requirePremium` retourne `false` quand le user n'est pas premium, mais NE SEND PAS de réponse 403 — le handler appelant continue son code, ce qui peut causer des handlers qui hang ou répondent en double.

**Plan étape par étape** :

1. Ajouter un cache LRU simple en mémoire :
   ```js
   const tierCache = new Map(); // discordId → { tier, expiresAt }
   const TIER_CACHE_TTL_MS = 60_000; // 1 minute
   
   export function getUserTier(discordId) {
       const cached = tierCache.get(discordId);
       if (cached && cached.expiresAt > Date.now()) return cached.tier;
       
       // ... logique actuelle (lookup subscriptions + seats) ...
       
       tierCache.set(discordId, { tier, expiresAt: Date.now() + TIER_CACHE_TTL_MS });
       return tier;
   }
   
   // Invalider explicitement quand on change un tier (route admin)
   export function invalidateTierCache(discordId) {
       tierCache.delete(discordId);
   }
   ```
2. Cap du cache à ~1000 entrées avec eviction LRU si dépassé (sinon fuite mémoire potentielle sur gros serveur).
3. Appeler `invalidateTierCache(discordId)` dans :
   - `src/routes/subscriptions.js` après update/delete
   - `src/routes/admin.js#handleSetPermission` après changement de role
4. Pour `requirePremium`, fixer pour envoyer un 403 :
   ```js
   export function requirePremium(req, res, ctx) {
       if (!ctx.tier || ctx.tier === 'free') {
           json(res, { error: 'Premium requis', tier: ctx.tier || 'free', upgrade: true }, 403, req);
           return false;
       }
       return true;
   }
   ```
5. Vérifier tous les callers de `requirePremium` — s'assurer qu'ils retournent immédiatement quand `false` (chain middleware déjà en place dans le router).

**Effort** : ~1h30 wall-clock.

**Test à ajouter** : `tests/unit/tierService.test.js` — cache hit/miss, invalidation, requirePremium retourne 403 + early return.

---

### 3. `subscriptions.expire` sur hot path

**Localisation** : `src/services/tierService.js#getUserTier` (appel à `subscriptions.expire.run()` dans certains chemins).

**Problème** : la requête `subscriptions.expire.run()` est appelée pendant le calcul du tier — donc à chaque requête authentifiée. Cette requête écrit en DB (`UPDATE subscriptions SET status='expired' WHERE expires_at < ?`). Sur un site actif, c'est une write SQLite par requête HTTP qui authentifie un user — gaspillage massif.

**Plan étape par étape** :

1. Identifier tous les appels à `subscriptions.expire` dans `src/services/tierService.js` et autres callers.
2. Remplacer par un cron périodique dans `src/services/tierService.js` (ou un fichier nouveau `src/services/cronJobs.js`) :
   ```js
   // src/services/tierService.js
   setInterval(() => {
       try {
           const expired = subscriptions.expire.run().changes;
           if (expired > 0) {
               console.log(`✓ ${expired} abonnements expires`);
               tierCache.clear(); // invalider tout le cache de tiers
           }
       } catch (err) {
           console.error('Cron expire error:', err);
       }
   }, 5 * 60 * 1000); // toutes les 5 minutes
   ```
3. Au cold start, faire un appel one-shot pour rattraper les expirations passées pendant le downtime :
   ```js
   subscriptions.expire.run();
   ```

**Effort** : ~30min wall-clock.

---

### 4. Duplication userLevels → JSON dans `index.js`

**Localisation** :
- `index.js:1690-1747` (`handleLevels` HTTP route)
- `index.js:661-711` (broadcast WebSocket)

**Problème** : ~30 lignes de transformation `userLevels Map → JSON object` dupliquées entre les deux endpoints. Tout changement de format (ex: ajout de `voiceProfileN`, `detectedEmotion`, etc.) doit être fait deux fois — source de bugs (un endpoint à jour, l'autre pas).

**Plan étape par étape** :

1. Extraire la transformation dans un nouveau module `src/services/levelsFormatter.js` :
   ```js
   import { userLevels, emotionState, voiceProfiles } from './audioService.js';
   import { tokenFor } from './tokenService.js';
   
   export function buildLevelsPayload({ uidToToken, ... }) {
       const out = {};
       for (const [userId, level] of userLevels) {
           const token = tokenFor(userId);
           out[token] = {
               db: level.db,
               speaking: level.speaking,
               freq: level.freq,
               state: level.state,
               displayName: level.displayName,
               detectedEmotion: emotionState.get(userId)?.emotion ?? null,
               voiceProfileN: voiceProfiles.get(userId)?.length ?? 0,
               // ... TOUS les champs ...
           };
       }
       return out;
   }
   ```
2. Remplacer les deux blocs (HTTP handler et WS broadcast) par un appel à `buildLevelsPayload()`.
3. Préserver le cache `_levelsCache` (50ms) si présent.
4. Vérifier que le format est identique au byte près (golden test si nécessaire).

**Effort** : ~1h wall-clock.

**Test à ajouter** : snapshot test du payload pour verrouiller la forme.

---

### 5. Logger structuré (pino) — `console.log/error` partout

**Localisation** : tous les fichiers `src/**/*.js` et `index.js`.

**Problème** : `console.log` / `console.error` partout — pas de niveaux (debug/info/warn/error/fatal), pas de format structuré, pas de request-id pour corrélation, pas de contexte (userId, route).

**Plan étape par étape** :

1. Installer `pino` :
   ```bash
   npm install pino pino-pretty
   ```
2. Créer `src/services/logger.js` :
   ```js
   import pino from 'pino';
   
   const isProduction = process.env.NODE_ENV === 'production';
   
   export const logger = pino({
       level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
       transport: isProduction ? undefined : { target: 'pino-pretty' },
       redact: ['req.headers.authorization', 'req.headers.cookie', '*.token', '*.password', '*.secret'],
   });
   
   // Helper pour logger par module
   export function child(name) {
       return logger.child({ module: name });
   }
   ```
3. Refactorer progressivement :
   - `src/bot/audio.js` : `const log = child('audio');`
   - `src/services/authService.js` : `const log = child('auth');`
   - etc.
4. Remplacer `console.log → log.info`, `console.error → log.error` avec contexte structuré :
   ```js
   // Avant
   console.error('Upload error:', err);
   // Apres
   log.error({ err, token, stateKey }, 'upload failed');
   ```
5. Ajouter un middleware HTTP request-id et logger par requête :
   ```js
   // src/http/middleware.js
   export function requestLogger(req, res, ctx) {
       ctx.log = logger.child({ reqId: crypto.randomUUID().slice(0, 8) });
       ctx.log.info({ method: req.method, url: req.url }, 'request');
       return true;
   }
   ```
6. Mettre à jour `Dockerfile` (rien à faire, pino-pretty est dev only).

**Effort** : ~3h wall-clock (~50 fichiers à toucher mais sed/regex efficaces).

---

## P1 — Frontend perf/qualité (non fait)

### 6. `PositionerApp` mélange DOM mutations + React renders

**Localisation** : `client/src/components/positioner/PositionerApp.jsx`.

**Problème** : `selectFrame()` mute `img.style.opacity` directement, puis le re-render React peut écraser. Sources de vérité dupliquées (`selectedFile` state vs `selectedFileRef`) qui peuvent diverger.

**Plan étape par étape** :

1. Lister toutes les mutations DOM directes (`element.style.X = ...`, `element.classList.add/remove`).
2. Pour chaque mutation, déterminer si elle est dans un :
   - **handler React contrôlé** (onClick, onChange) → conserver le state, supprimer la mutation directe
   - **gesture continu** (drag) → utiliser `requestAnimationFrame` + `ref` muté, pas de state
3. Unifier `selectedFile` et `selectedFileRef` :
   ```jsx
   // Garder UNIQUEMENT le ref pour les performances drag
   // Mettre a jour le state uniquement au mouseup pour declencher un seul re-render
   ```
4. Tester manuellement : drag fluide, sélection persistante, pas de flicker.

**Effort** : ~2h wall-clock + tests manuels.

---

### 7. `AvatarsTab` `dangerouslySetInnerHTML`

**Localisation** : `client/src/components/tabs/AvatarsTab.jsx` (chercher `dangerouslySetInnerHTML`).

**Problème** : actuellement la string `msg` est codée en dur, donc pas exploitable. Mais c'est un piège futur si quelqu'un branche `msg` sur des données dynamiques (ex: notification serveur, message Discord) — XSS direct.

**Plan étape par étape** :

1. Identifier l'usage exact :
   ```jsx
   <div dangerouslySetInnerHTML={{ __html: msg }} />
   ```
2. Si `msg` est juste du HTML statique (ex: instructions avec `<br/>`, `<strong>`) :
   - Remplacer par du JSX pur :
     ```jsx
     <div>Premier paragraphe.<br /><strong>Bold</strong> texte.</div>
     ```
3. Si `msg` doit rester du HTML dynamique :
   - Ajouter `DOMPurify` pour sanitiser :
     ```bash
     npm install dompurify --workspace=client
     ```
     ```jsx
     import DOMPurify from 'dompurify';
     <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(msg) }} />
     ```
4. Idéalement : éliminer tout `dangerouslySetInnerHTML` du projet et utiliser exclusivement du JSX.

**Effort** : ~30min wall-clock.

---

### 8. `try { } catch {}` silencieux partout

**Localisation** : grep `try.*catch.*{}` ou `catch.*{}` dans `client/src/**/*.jsx` — environ 15-20 occurrences.

**Problème** : toutes les erreurs API sont avalées sans feedback utilisateur ni log. L'utilisateur ne sait pas pourquoi son action a échoué.

**Plan étape par étape** :

1. Lister tous les `try { ... } catch (e) {}` ou similaires :
   ```bash
   grep -rn "catch.*{[[:space:]]*}" client/src/ | head -20
   ```
2. Pour chaque, ajouter au minimum :
   ```jsx
   } catch (err) {
       console.error('Action X failed:', err);
       toast.error(`Erreur: ${err.message || 'unknown'}`);
   }
   ```
3. Idéalement utiliser le hook `useToast()` déjà présent.

**Effort** : ~1h wall-clock (mécanique).

---

### 9. Aucun `ErrorBoundary` global

**Localisation** : `client/src/App.jsx` (composant racine).

**Problème** : si un composant crash en production (TypeError, etc.), toute l'app devient blanche. Pas de fallback.

**Plan étape par étape** :

1. Créer `client/src/components/ui/ErrorBoundary.jsx` :
   ```jsx
   import { Component } from 'react';
   
   export class ErrorBoundary extends Component {
       state = { hasError: false, error: null };
       
       static getDerivedStateFromError(error) {
           return { hasError: true, error };
       }
       
       componentDidCatch(error, info) {
           console.error('ErrorBoundary:', error, info);
           // Future: envoyer a un endpoint /api/client-errors pour logging serveur
       }
       
       render() {
           if (this.state.hasError) {
               return (
                   <div style={{ padding: '2rem', textAlign: 'center' }}>
                       <h2>Quelque chose s'est mal passe</h2>
                       <p>{this.state.error?.message}</p>
                       <button onClick={() => this.setState({ hasError: false })}>
                           Reessayer
                       </button>
                       <button onClick={() => location.reload()}>
                           Recharger
                       </button>
                   </div>
               );
           }
           return this.props.children;
       }
   }
   ```
2. Wrapper dans `client/src/App.jsx` :
   ```jsx
   import { ErrorBoundary } from './components/ui/ErrorBoundary.jsx';
   
   export default function App() {
       return (
           <ErrorBoundary>
               <AppProvider>
                   <ControlApp />
               </AppProvider>
           </ErrorBoundary>
       );
   }
   ```
3. Ajouter aussi un ErrorBoundary autour de chaque tab (granularité fine).

**Effort** : ~30min wall-clock.

---

### 10. `TIER_COLORS` dupliqué

**Localisation** :
- `client/src/components/layout/Header.jsx`
- `client/src/components/tabs/SubscriptionsTab.jsx`

**Problème** : la même constante `TIER_COLORS` (mapping tier → couleur) est définie deux fois. Toute modification doit être faite à deux endroits.

**Plan étape par étape** :

1. Créer `client/src/constants/tier.js` :
   ```js
   export const TIER_COLORS = {
       free:     '#888888',
       premium:  '#f0a500',
       streamer: '#9b59b6',
   };
   
   export const TIER_LABELS = {
       free:     'Free',
       premium:  'Premium',
       streamer: 'Streamer',
   };
   ```
2. Importer dans les deux fichiers, supprimer les définitions locales.

**Effort** : ~10min.

---

### 11. Code mort / imports inutilisés

**Localisation** : 6+ fichiers identifiés par l'agent DOC-Frontend :
- `apiFetch` non utilisé dans `VoiceSidebar.jsx`, `SessionsTab.jsx`, `AdminTab.jsx`
- `levels` non utilisé dans `ExperimentTab.jsx`
- `myToken` non utilisé dans `SetupTab.jsx`
- `animRef` non utilisé dans `UserCard.jsx` (résidu de l'ancienne version)
- `audioCfgRef` non utilisé dans `usePollLevels.js` (déjà retiré dans la PR ?)
- `esc()` non utilisé dans `PositionerApp.jsx`

**Plan étape par étape** :

1. Lancer ESLint après installation des deps :
   ```bash
   npm install
   npm run lint
   ```
2. Le rule `no-unused-vars` flag tous les imports/vars inutilisés.
3. `npm run lint:fix` ne supprime PAS les imports (il faut le faire à la main ou avec eslint-plugin-unused-imports).
4. Installer `eslint-plugin-unused-imports` pour auto-fix :
   ```bash
   npm install -D eslint-plugin-unused-imports
   ```
   Ajouter dans `eslint.config.js` :
   ```js
   import unusedImports from 'eslint-plugin-unused-imports';
   // ...
   plugins: { 'unused-imports': unusedImports },
   rules: {
       'no-unused-vars': 'off',
       'unused-imports/no-unused-imports': 'error',
       'unused-imports/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
   }
   ```
5. `npm run lint:fix` → cleanup automatique.

**Effort** : ~30min.

---

### 12. Inline styles partout

**Localisation** : ~80% du code visuel des composants `client/src/components/`.

**Problème** : pas de thème centralisé, pas de dark/light mode, duplication massive (ex: `style={{ padding: '0.5rem 1rem' }}` répété 50+ fois). Difficile à maintenir.

**Plan étape par étape (graduel)** :

1. **Étape 1 (rapide)** : extraire les couleurs et spacings dans des CSS variables :
   ```css
   /* client/src/index.css */
   :root {
       --color-primary: #4a90e2;
       --color-warning: #f0a500;
       --color-danger:  #e74c6c;
       --color-muted:   #888;
       --space-xs: 0.25rem;
       --space-sm: 0.5rem;
       --space-md: 1rem;
       --space-lg: 1.5rem;
   }
   ```
2. **Étape 2** : remplacer progressivement `color: '#4a90e2'` par `var(--color-primary)` (sed-friendly).
3. **Étape 3 (lourd)** : migrer vers CSS Modules ou un framework :
   - Option A : CSS Modules (déjà supporté par Vite, low-effort)
   - Option B : Tailwind CSS (utility-first, courbe d'apprentissage mais énorme gain à long terme)
   - Option C : styled-components / emotion (CSS-in-JS, ~12 KB de runtime)
   - Recommandation : **CSS Modules** pour ce projet (cohérent avec le style "no framework" actuel).
4. Convertir un composant à la fois — commencer par les plus utilisés (Header, TabBar, UserCard).

**Effort** : étape 1+2 = ~2h. Étape 3 (migration complète) = ~10-15h.

---

## P1 — Migration `index.js` → `src/` (continuation)

**Statut** : 70% migré (61 / 89 routes extraites). 28 routes inline restent dans `index.js` (~1900 lignes).

**Routes encore inline à migrer** (selon l'agent DOC-Root) :

| Sous-système | Routes restantes | Estimation |
|--------------|------------------|------------|
| Sessions | `/api/sessions` GET/POST/DELETE, `/api/sessions/:id/end` | ~1h |
| Invitations | `/api/invitations` GET/POST/DELETE, `/api/my-invitations`, `/invite/:id` | ~1h30 |
| Notifications | `/api/notifications` GET/POST/DELETE | ~30min |
| Subscriptions | `/api/subscription` GET/POST/DELETE, `/api/subscription/seats` | ~1h |
| Viewer-sessions | `/api/viewer-session` POST + GET/:sessionId | ~30min |
| Levels/status/bot-info | `/levels`, `/status`, `/bot-info` (déjà partiellement dans `routes/levels.js`) | ~30min |
| OAuth flow inline | déjà partiellement extrait dans `routes/auth.js`, vérifier ce qu'il reste | ~30min |

**Plan général par module** :

1. Identifier le bloc dans `index.js` (handlers + helpers).
2. Créer `src/routes/<domain>.js` avec template :
   ```js
   import { json } from '../http/helpers.js';
   import { sessions as sessionRepo } from '../db/repos/sessions.js';
   
   export async function handleListSessions(req, res, ctx) { ... }
   export async function handleCreateSession(req, res, ctx) { ... }
   // ...
   ```
3. Importer dans `index.js` et remplacer les `route(...)` par les nouveaux handlers.
4. Vérifier `node --check` + smoke test.
5. Commit isolé par module.

**Important** : retirer aussi le compat layer `stmts` (60+ aliases dans `index.js:175-246`) une fois la migration complète. Toutes les routes doivent utiliser les `repos` directement.

**Effort total** : ~6h pour finir la migration + ~1h pour retirer le compat layer.

---

## P2 — Tests P0 manquants (6 modules)

Sur les 7 modules P0 listés dans `docs/audit/tests.md`, **1 seul** a un test (tokenService). Reste 6.

| Module | Effort | Tests à écrire |
|--------|--------|----------------|
| `src/services/authService.js` | ~1h30 | sign/verify cookies, parseCookies, getSession (cache + expiry), createSession, setSessionCookie (TLS detection), resolveAuth (cookie + Bearer), AUTH_ENABLED guard |
| `src/services/rateLimiter.js` | ~45min | bucket création, refill linéaire, expiration, IP extraction (avec/sans TRUST_PROXY) |
| `src/services/tierService.js` | ~1h | getUserTier (free/premium/streamer + seats), TIER_LIMITS, loadTier middleware, requirePremium (apres fix #2) |
| `src/db/repos/*` (5 fichiers) | ~2h30 | Pour chacun : création, lecture, update, delete avec une DB `:memory:`. Utiliser un setup commun via beforeEach. |
| `src/http/middleware.js` | ~1h | requireAuth (avec/sans AUTH_ENABLED), requireAdmin (admin/client/anonymous), requireClientOrAdmin (token match) |
| `src/routes/upload.js` | ~1h30 | path traversal (token avec `..`), MIME validation, magic bytes, tier enforcement (free 3 states max), rate limit |
| `src/routes/sessions.js` | ~1h | invitation accept ownership (le fix critique de cette PR), use_count, expiration |

**Effort total tests P0** : ~9h wall-clock (peut être parallélisé via subagents).

**Setup recommandé pour les tests DB** :

```js
// tests/helpers/dbFixture.js
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

export function createTestDb() {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    // Charger le schema depuis src/db/database.js (extraire d'abord le bloc CREATE TABLE)
    db.exec(SCHEMA_SQL);
    return db;
}
```

**Pyramide à atteindre** (rappel `docs/audit/tests.md`) :
- 70% lines coverage backend
- 90% lines coverage crypto/auth
- Tests intégration (supertest) sur 5-10 routes critiques
- Tests E2E Playwright sur 3 parcours (login, upload, voice join)

---

## P2 — Frameworks (deferes)

### 13. `fft-js` → `webfft`

**Localisation** : `package.json` + `src/bot/audio.js` (et possiblement `index.js`).

**Problème** : `fft-js@0.0.12` est abandonware (dernière version juin 2022, sub-alpha permanent), sur le hot path audio (FFT à 20 Hz par utilisateur). Risque de bugs et perfs sous-optimales.

**Recommandation audit** : `webfft@1.0.3` (gain perf ~5x).

**Plan étape par étape** :

1. Mesurer le baseline actuel :
   - Démarrer le bot avec un user en vocal
   - Mesurer le CPU usage côté audio.js (via `perf_hooks.performance.now()` autour de l'appel FFT)
   - Mesurer le temps total par tick (50ms cap)
2. Installer `webfft` :
   ```bash
   npm install webfft
   npm uninstall fft-js
   ```
3. Adapter le code dans `src/bot/audio.js` :
   ```js
   // Avant (fft-js)
   import { fft, util } from 'fft-js';
   const phasors = fft(signal);
   const magnitudes = util.fftMag(phasors);
   
   // Apres (webfft)
   import WebFFT from 'webfft';
   const fft = new WebFFT(1024); // FFT_SIZE
   const out = new Float32Array(1024 * 2);
   fft.fft(signal, out); // re/im interleaved
   // Magnitude : sqrt(re*re + im*im) pour chaque bin
   ```
4. **Test crucial** : écouter le bot en vrai. Comparer la sortie magnitudes avant/après sur un signal connu (sinusoïde 440 Hz, white noise) — les valeurs absolues doivent être proches (à un facteur près) et les pics doivent être au bon endroit.
5. Vérifier que les seuils d'émotion / fingerprints fonctionnent toujours (snapshot test).
6. Documenter le changement de format dans `src/bot/audio.md`.

**Effort** : ~3h wall-clock (~2h code + 1h test audio).

**Risque** : si les tests audio passent mais les fingerprints ne matchent plus, il faudra re-calibrer.

---

### 14. Routeur frontend `wouter`

**Localisation** : `client/src/App.jsx`.

**Problème actuel** : routing custom fragile via `window.location.pathname === '/positioner'` évalué une seule fois au chargement. Pas de support des routes dynamiques (ex: `/embed/:token` pour OBS, `/share/:invitationId` pour les invitations).

**Plan étape par étape** :

1. Installer `wouter` (1.5 KB, modern hooks-based) :
   ```bash
   npm install wouter --workspace=client
   ```
2. Refactorer `App.jsx` :
   ```jsx
   import { Router, Route, Switch } from 'wouter';
   import { ControlApp } from './ControlApp';
   import { PositionerApp } from './components/positioner/PositionerApp';
   
   export default function App() {
       return (
           <Router>
               <Switch>
                   <Route path="/positioner" component={PositionerApp} />
                   <Route path="/embed/:token">
                       {(params) => <EmbedView token={params.token} />}
                   </Route>
                   <Route path="/share/:invitationId">
                       {(params) => <SharedSession id={params.invitationId} />}
                   </Route>
                   <Route component={ControlApp} />
               </Switch>
           </Router>
       );
   }
   ```
3. Ajuster le serving statique côté backend (déjà OK avec le SPA fallback).

**Effort** : ~1h wall-clock.

---

## P3 — Kubernetes manifests réels

**Statut actuel** : `docs/audit/kubernetes.md` décrit le plan + manifests YAML inline mais aucun fichier YAML dans le repo.

**Plan étape par étape** :

1. Créer le dossier `k8s/` avec :
   ```
   k8s/
   ├── namespace.yaml
   ├── deployment.yaml
   ├── service.yaml
   ├── ingress.yaml
   ├── pvc.yaml
   ├── configmap.yaml
   ├── secret.template.yaml   # exemple, secrets reels via sealed-secrets ou external-secrets
   └── kustomization.yaml
   ```
2. Copier les manifests YAML de `docs/audit/kubernetes.md` dans les fichiers correspondants.
3. Tester sur un cluster (minikube ou k3s) :
   ```bash
   kubectl apply -k k8s/
   kubectl get pods
   kubectl logs deployment/hereborus-bot -f
   ```
4. Itérer jusqu'à ce que tout démarre :
   - PVC bind ✅
   - Pod healthy (HEALTHCHECK répond)
   - Ingress accessible avec TLS (cert-manager)
   - Secrets injectés correctement
5. Optionnel : créer un Helm chart `charts/hereborus-bot/` pour package + versionning + values overrides.

**Effort** :
- Manifests bruts : ~2h
- Helm chart : ~3h supplémentaires

**Important** : SQLite single-writer **bloque le scaling horizontal**. Le deployment doit avoir `replicas: 1` jusqu'à la migration vers Postgres (cf P3 scaling).

---

## P3 — Scaling horizontal

**Pour passer de mono-instance à multi-replica** (cf `docs/audit/kubernetes.md`) :

| Item | Effort | Impact |
|------|--------|--------|
| **SQLite → Postgres** : migration schéma + driver `pg`/`postgres` | 1-2 jours wall-clock | Critique (débloque tout le reste) |
| **Sessions in-memory → Redis** : `services/authService.js` `sessions` Map → `ioredis` | ~4h | Sticky sessions plus nécessaire |
| **rateLimiter in-memory → Redis** : `services/rateLimiter.js` buckets → Redis sorted sets | ~2h | Rate limit cohérent multi-pod |
| **Image storage : filesystem → S3/MinIO** : `routes/upload.js`, `images/` | ~6h | Pas de PVC partagé entre replicas |
| **Pipeline audio : worker thread vs main thread** | ~6h | Bot Discord reste mono-pod (Discord limit), mais les FFT peuvent être déportées |
| **Metrics Prometheus** : `/metrics` endpoint exposé, libs `prom-client` | ~3h | Observabilité prod |
| **Helm chart values** : multi-environnements (dev/staging/prod) | ~3h | Cohérence déploiement |

**Effort total scaling complet** : ~3-4 jours wall-clock.

---

## Estimation totale

| Lot | Effort wall-clock | Priorité |
|-----|-------------------|----------|
| P1 backend (items 1-5) | ~7h | High |
| P1 frontend (items 6-12) | ~3h (sans inline styles step 3) | High |
| P1 migration `index.js` | ~7h | Medium |
| P2 tests P0 (6 modules) | ~9h | High |
| P2 frameworks (fft-js + wouter) | ~4h | Medium |
| P3 K8s manifests | ~2h (sans Helm) | Low |
| P3 scaling complet | 3-4 jours | Low (futur) |

**TOTAL pour atteindre "vraiment tout fait"** : **~32h wall-clock parallélisable** (≈ 4 demi-journées avec subagents en parallèle).

---

## Ordre recommandé d'exécution

1. **Sprint A** (~3h) : items 1, 2, 3, 4 (audio cleanup + tier cache + subscriptions cron + dedup levels)
2. **Sprint B** (~3h) : item 5 (logger pino) — touche beaucoup de fichiers, à faire en bloc
3. **Sprint C** (~3h) : items 6-12 (frontend hardening) — peut être un seul commit "frontend cleanup"
4. **Sprint D** (~9h) : tests P0 — peut être parallélisé via subagents (1 module = 1 agent)
5. **Sprint E** (~7h) : finir la migration `index.js` → `src/` route par route
6. **Sprint F** (~4h) : `fft-js` → `webfft` + `wouter`
7. **Sprint G** (~2h+) : k8s manifests réels (quand la prod est stable)

---

## Notes pour le prochain Claude / le developpeur

- **Important** : `npm install` échoue sur Windows avec Node v24 à cause de `better-sqlite3@11.10` + node-gyp. Solutions :
  - Utiliser Node 22 (meilleur support pré-built binary)
  - OU travailler dans Docker (build container OK)
  - OU `npm install --build-from-source=false`
- **Tests** : tant que `npm install` ne passe pas, impossible de lancer Vitest localement. Privilégier le développement en Docker pour les tests.
- **Branch** : la PR `release/v2-with-fixes` est ouverte vers main. Soit on enrichit cette PR avec les fixes ci-dessus, soit on merge cette PR puis on en fait des nouvelles plus petites.
- **Smoke test** : `bash scripts/smoke-test.sh` est fonctionnel mais nécessite un `npm install` réussi (sinon le bot ne démarre pas).
- **CI/CD** : règle projet "pas de GitHub Actions" — si une CI est souhaitée, faire un script bash dans `scripts/` (ex: `scripts/ci.sh`) à lancer manuellement ou via cron sur le NAS.

---

*Plan généré 2026-05-07 après l'exécution partielle de la PR `release/v2-with-fixes`.*
*Référence audits : `docs/audit/{security,cve,docker,kubernetes,frameworks,tests}.md`.*
