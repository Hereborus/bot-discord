# Audit tests

> Date : 2026-05-07
> Branche : `feat/full-migration`
> Auditeur : Claude (Opus 4.7)

## Synthèse

**Score test readiness : 1 / 10**

Le projet ne possède **aucun test automatisé**. Le seul mécanisme de validation est `node --check index.js` (vérification syntaxique). Aucun framework configuré, aucun script `test` dans `package.json`, aucun dossier `tests/` ou `__tests__/`. Le risque est élevé étant donné la surface de code (~6 000 lignes JS, ~3 000 JSX), la complexité du domaine (HMAC, OAuth2, Device Auth Flow, parsing multipart maison, pipeline audio temps-réel), et la sensibilité sécu (sessions, app tokens, path traversal upload).

Ce document est donc **un PLAN**, pas un audit d'existant.

**Cible recommandée** :
- 70 % de coverage de lignes sur `src/services/`, `src/db/repos/`, `src/http/`
- 90 % sur les helpers crypto + auth (`tokenService`, `authService`, signature cookies, hash app tokens)
- Une suite de smoke tests bash en remplacement d'une CI

## Findings

### Critique

- **Zéro test** sur du code qui touche à de la crypto (HMAC, SHA-256, signature de cookies, comparaison `timingSafeEqual`) — un bug silencieux peut compromettre l'auth complète
- **Pas de validation automatique** des routes upload (path traversal, MIME, magic bytes) — la sécu repose sur 4 regex et `path.resolve()`, mais aucune assertion ne le prouve
- **Aucune protection contre les régressions** : chaque modification de `index.js` (1 935 lignes) ou `src/bot/audio.js` (607 lignes) est un saut dans le vide

### Majeur

- Pas de `npm test`, pas de `npm run lint` → impossible d'avoir un signal automatique avant commit/déploiement
- Pas de CI (par règle projet : pas de GitHub Actions) → besoin d'une alternative *script-driven*
- Pas de mocks pour Discord API, OAuth, filesystem → les tests futurs devront être bien isolés

### Mineur

- Pas de TypeScript → pas de safety net statique (cf. `frameworks.md` recommandation JSDoc)
- `src/services/audioService.md` et `src/services/authService.md` documentent partiellement, ce qui aidera à écrire les specs

## Pyramide de tests recommandée

```
         /\
        /E2E\          ← Playwright (5–10 scénarios critiques)
       /──────\
      /  Intg  \       ← supertest + serveur réel ports éphémères (~30 tests)
     /──────────\
    /    Unit    \     ← Vitest (~150 tests : services, helpers, repos)
   /──────────────\
```

**Choix de framework : Vitest 4.1**

Pourquoi Vitest plutôt que Jest :
- **Cohérence avec Vite** (déjà utilisé côté `client/`) → un seul transformeur, ESM natif sans config
- **Perf** : ~5x plus rapide que Jest sur ce volume (workers + esbuild)
- **API quasi-identique** à Jest → pas de friction si on doit migrer
- **`vitest --coverage`** intégré (v8/c8 sous le capot)
- Supporte tests UI (`@vitest/ui`) pour debug interactif

## Coverage cible

| Module | Cible lignes | Justification |
|--------|--------------|----------------|
| `src/services/tokenService.js` | **95 %** | Crypto (HMAC), exposé dans toutes les URLs publiques |
| `src/services/authService.js` | **95 %** | Sessions, signature cookies, Bearer tokens |
| `src/services/rateLimiter.js` | **90 %** | Logique fenêtre fixe simple |
| `src/services/tierService.js` | **85 %** | Gating premium, logique abonnements |
| `src/db/repos/*.js` | **80 %** | Queries SQLite, contrats DB |
| `src/http/middleware.js` | **90 %** | requireAuth/requireAdmin/requireClientOrAdmin |
| `src/http/router.js` | **90 %** | Matching de routes (params, wildcards) |
| `src/http/cors.js` + `helpers.js` | **80 %** | Helpers réponse |
| `src/routes/upload.js` | **70 %** | Magic bytes, path traversal, multipart parsing |
| `src/routes/*.js` (autres) | **60 %** | Handlers métier |
| `src/bot/audio.js` | **40 %** (snapshots) | Pipeline DSP — tests par snapshot d'output |
| `index.js` (à décomposer) | **30 %** | Glue Discord + bootstrap |
| `client/src/components/**` | **50 %** | Composants critiques + hooks |

## Tests prioritaires

### P0 — sécu critique, à écrire en premier

Ordre d'écriture suggéré :

1. **`src/services/tokenService.js`** (HMAC, IDs Discord jamais en clair)
   - `tokenFor(userId)` est déterministe pour un même `USER_HASH_SECRET`
   - `tokenFor(userId)` change si on change le secret
   - `uidFor(token)` retourne `null` pour un token inconnu
   - Le cache `tokenToUid` / `uidToToken` est cohérent (round-trip)
   - `isKnownToken` fallback DB

2. **`src/services/authService.js`** (sessions, OAuth state, app tokens)
   - `sign()/verify()` est round-trip
   - `verify()` rejette une signature falsifiée
   - `verify()` est resistante aux timing attacks (assertion : durée constante sur N essais)
   - `getSession()` rejette un cookie expiré, supprime la session de la map
   - `resolveAuth()` accepte un Bearer valide, rejette un Bearer invalide
   - GC supprime les sessions expirées

3. **`src/services/rateLimiter.js`**
   - Bloque après N requêtes
   - Reset à la fin de la fenêtre
   - Clés isolées par route (`upload:ip` vs `auth:ip`)
   - GC supprime les buckets expirés

4. **`src/services/tierService.js`**
   - `getUserTier` retourne `'free'` sans abonnement
   - Retourne `'premium'` avec sub directe active
   - Retourne `'premium'` via seat actif
   - Expire les subs périmées
   - `requirePremium` bloque sur `free`

5. **`src/db/repos/*.js`**
   - Smoke test sur DB in-memory (`new Database(':memory:')`) : insert + get + delete pour chaque repo
   - Vérifier les contraintes SQL (unique, foreign keys)

6. **`src/http/middleware.js`**
   - `requireAuth` bypass si `AUTH_ENABLED=false`
   - `requireAuth` rejette sans cookie ni Bearer
   - `requireAdmin` rejette role !== admin
   - `requireClientOrAdmin` autorise client sur son propre token
   - `requireClientOrAdmin` rejette client sur token d'autrui

7. **`src/routes/upload.js`** (multipart maison + path traversal)
   - `validateMagicBytes` accepte PNG / JPG / GIF / WebP valides
   - Rejette un `.png` qui contient un payload SVG
   - `parseMultipart` gère 1, 2, N parts
   - Rejette `stateKey = '../../../etc/passwd'`
   - Rejette filename avec `..` ou `/`
   - Rate limit appliqué (mock du compteur)
   - Limite tier appliquée (free max 2 states)

### P1 — routes & frontend critique

- Routes API : `/auth/login`, `/auth/callback`, `/api/voice/join`, `/api/sessions`, `/api/invitations`
- Hooks React : `usePollLevels`, `useWebSocket`, `useNotifications`
- Composants critiques : `Header`, `VoiceSidebar`, `UserSettingsModal`, `AdminTab`

### P2 — nice-to-have

- Composants UI purement présentationnels (`Toast`, `Modal`, `NotificationBell`)
- Onglets rares (`DbViewTab`, `ExperimentTab`)
- Pipeline audio (snapshot tests sur `computeFreqBands`, `computeFormants` — entrée fixe → sortie reproductible)

## Mocking — stratégie

| Dépendance externe | Mock |
|--------------------|------|
| **Discord API** (OAuth `/oauth2/token`, `/users/@me`) | `nock@14` ou `msw` côté test |
| **Discord.js Client** | Pas de mock — extraire la logique testable des handlers d'event |
| **better-sqlite3** | `new Database(':memory:')` + script de schéma — pas de mock, vraie DB éphémère |
| **filesystem** | `memfs@4.57` pour `src/routes/upload.js` (évite les écritures disque) |
| **`fft-js`** | Wrapper testable autour de `computeFreqBands` qui accepte une lib injectée |
| **`@discordjs/voice` receiver** | Stream factice (`Readable.from([buffer])`) qui simule des chunks Opus |
| **Network (fetch)** | `nock` ou `msw` |
| **WebSocket** | `ws` côté test : créer un serveur sur port éphémère |

## Setup proposé

### Structure

```
hereborus-bot/
├─ tests/
│  ├─ unit/
│  │  ├─ services/
│  │  │  ├─ tokenService.test.js
│  │  │  ├─ authService.test.js
│  │  │  ├─ rateLimiter.test.js
│  │  │  └─ tierService.test.js
│  │  ├─ db/
│  │  │  └─ repos.test.js
│  │  ├─ http/
│  │  │  ├─ router.test.js
│  │  │  ├─ middleware.test.js
│  │  │  ├─ helpers.test.js
│  │  │  └─ cors.test.js
│  │  └─ routes/
│  │     └─ upload.test.js
│  ├─ integration/
│  │  ├─ auth-flow.test.js          ← OAuth complet avec nock
│  │  ├─ upload-flow.test.js         ← upload réel sur memfs
│  │  ├─ device-auth.test.js
│  │  └─ session-collab.test.js
│  ├─ e2e/
│  │  ├─ login.spec.js               ← Playwright
│  │  ├─ upload-frame.spec.js
│  │  └─ viewer.spec.js
│  ├─ fixtures/
│  │  ├─ images/                     ← PNG/JPG/SVG/fake.png pour magic bytes
│  │  └─ pcm-samples/                ← buffers PCM 48kHz pour FFT
│  └─ helpers/
│     ├─ fakeDb.js                   ← :memory: + schéma
│     ├─ fakeServer.js               ← bootstrap HTTP éphémère
│     └─ mockDiscord.js              ← nock setup
├─ vitest.config.js
└─ playwright.config.js
```

### `package.json` — scripts à ajouter

```json
{
  "scripts": {
    "test":              "vitest run",
    "test:watch":        "vitest",
    "test:unit":         "vitest run tests/unit",
    "test:integration":  "vitest run tests/integration",
    "test:e2e":          "playwright test",
    "test:coverage":     "vitest run --coverage",
    "test:ui":           "vitest --ui",
    "lint":              "eslint .",
    "smoke":             "bash scripts/smoke-test.sh"
  },
  "devDependencies": {
    "vitest":                     "^4.1.5",
    "@vitest/coverage-v8":        "^4.1.5",
    "@vitest/ui":                 "^4.1.5",
    "@testing-library/react":     "^16.3.2",
    "@testing-library/jest-dom":  "^6.6.3",
    "jsdom":                      "^29.1.1",
    "supertest":                  "^7.2.2",
    "playwright":                 "^1.59.1",
    "@playwright/test":           "^1.59.1",
    "nock":                       "^14.0.15",
    "memfs":                      "^4.57.2"
  }
}
```

### `vitest.config.js`

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.js', 'index.js'],
      exclude: ['**/*.test.js', 'tests/**', 'node_modules/**', 'client/**', 'dist/**'],
      thresholds: {
        // Cibles globales — peuvent être affinées par fichier dans une étape ultérieure
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
    // Sépare unit / integration via projects pour exécutions ciblées
    projects: [
      {
        test: { name: 'unit', include: ['tests/unit/**/*.test.js'] },
      },
      {
        test: { name: 'integration', include: ['tests/integration/**/*.test.js'] },
      },
    ],
  },
});
```

Une seconde config Vitest spécifique au frontend (`client/vitest.config.js`) :
```js
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
  },
});
```

### CI alternative (pas de GitHub Actions, par règle projet)

Script `scripts/ci-local.sh` :
```bash
#!/usr/bin/env bash
set -euo pipefail

echo "→ lint"
npm run lint

echo "→ unit"
npm run test:unit

echo "→ integration"
npm run test:integration

echo "→ coverage check"
npm run test:coverage

echo "→ build:ui"
npm run build:ui

echo "→ smoke"
npm run smoke

echo "✓ CI local OK"
```

À hooker dans `scripts/deploy/build-deploy.sh` avant le push GHCR.

## Exemple de test complet — `tokenService`

`tests/unit/services/tokenService.test.js` :

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Le module utilise process.env.USER_HASH_SECRET en lecture lazy
// → on peut le fixer avant l'import
process.env.USER_HASH_SECRET = 'test-secret-do-not-use-in-prod-32bytes!!';

// On mocke le repo users pour isoler le service de SQLite
vi.mock('../../../src/db/repos/users.js', () => ({
  users: {
    get: { get: vi.fn(() => null) },
  },
}));

const { tokenFor, uidFor, isKnownToken } = await import('../../../src/services/tokenService.js');

describe('tokenService', () => {
  describe('tokenFor', () => {
    it('produit un token hex de 16 caractères', () => {
      const token = tokenFor('123456789012345678');
      expect(token).toMatch(/^[a-f0-9]{16}$/);
    });

    it('est déterministe pour un même userId', () => {
      const a = tokenFor('123456789012345678');
      const b = tokenFor('123456789012345678');
      expect(a).toBe(b);
    });

    it('retourne des tokens distincts pour des userIds distincts', () => {
      const a = tokenFor('111111111111111111');
      const b = tokenFor('222222222222222222');
      expect(a).not.toBe(b);
    });

    it('utilise un cache (deuxième appel = 0 ms)', () => {
      tokenFor('cache-warm-up'); // chauffe le cache
      const t0 = process.hrtime.bigint();
      tokenFor('cache-warm-up');
      const dt = Number(process.hrtime.bigint() - t0);
      expect(dt).toBeLessThan(50_000); // < 50 µs
    });
  });

  describe('uidFor', () => {
    it('round-trip : token → userId', () => {
      const uid = '987654321098765432';
      const token = tokenFor(uid);
      expect(uidFor(token)).toBe(uid);
    });

    it('retourne null pour un token inconnu', () => {
      expect(uidFor('deadbeef00000000')).toBeNull();
    });
  });

  describe('isKnownToken', () => {
    it('reconnaît un token déjà émis', () => {
      const token = tokenFor('111000111000111000');
      expect(isKnownToken(token)).toBe(true);
    });

    it('retourne false pour un token jamais vu (et absent en DB)', () => {
      expect(isKnownToken('00000000deadbeef')).toBe(false);
    });
  });
});
```

Snippet équivalent pour `authService.sign/verify` (montre le pattern timing-safe) :

```js
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';

process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const { sessions, parseCookies, getSession, createSession } =
  await import('../../../src/services/authService.js');

describe('authService — signature de cookies', () => {
  it('round-trip : crée puis récupère une session', () => {
    const id = createSession({ id: '1234', username: 'tojii', avatar: null }, []);
    const cookieHeader = `pngtuber_session=${signFromInternal(id)}`; // helper test
    const fakeReq = { headers: { cookie: cookieHeader } };
    const s = getSession(fakeReq);
    expect(s?.username).toBe('tojii');
  });

  it('rejette une signature falsifiée', () => {
    const fakeReq = { headers: { cookie: 'pngtuber_session=bad.signature' } };
    expect(getSession(fakeReq)).toBeNull();
  });

  it('rejette une session expirée', () => {
    const id = createSession({ id: '5678', username: 'expiredUser' }, []);
    sessions.get(id).expiresAt = Date.now() - 1000;
    const fakeReq = { headers: { cookie: `pngtuber_session=${signFromInternal(id)}` } };
    expect(getSession(fakeReq)).toBeNull();
    expect(sessions.has(id)).toBe(false); // doit être supprimée
  });
});
```

Test d'intégration upload (avec `memfs` + `supertest`-compatible sur serveur natif) :

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer } from '../helpers/fakeServer.js';
import fs from 'node:fs';
import path from 'node:path';

let server, baseUrl;

beforeAll(async () => {
  ({ server, baseUrl } = await startTestServer({ authDisabled: true }));
});

afterAll(() => server.close());

describe('POST /upload', () => {
  it('rejette un stateKey avec path traversal', async () => {
    const form = new FormData();
    form.append('token', 'abc123def4567890');
    form.append('stateKey', '../../../etc/passwd');
    form.append('image', new Blob([fs.readFileSync('tests/fixtures/images/sample.png')]), 'x.png');

    const res = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/stateKey invalide/);
  });

  it('rejette un fichier dont les magic bytes ne matchent pas l\'extension', async () => {
    const form = new FormData();
    form.append('token', 'abc123def4567890');
    form.append('stateKey', 'open');
    // SVG malveillant renommé .png
    form.append('image', new Blob(['<svg onload="alert(1)"/>']), 'evil.png');

    const res = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form });
    expect(res.status).toBe(400);
  });

  it('accepte un PNG valide et le re-encode en WebP', async () => {
    const form = new FormData();
    form.append('token', 'abc123def4567890');
    form.append('stateKey', 'open');
    form.append('image', new Blob([fs.readFileSync('tests/fixtures/images/sample.png')]), 'frame.png');

    const res = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.file).toMatch(/\.webp$/);
  });
});
```

## Smoke tests — `scripts/smoke-test.sh`

Script bash autonome qui démarre le bot, fait quelques requêtes HTTP, vérifie les codes et tue le process. À utiliser comme **filet de sécurité minimal** en l'absence de CI :

```bash
#!/usr/bin/env bash
# scripts/smoke-test.sh — smoke test minimal en remplacement de CI
set -euo pipefail

PORT="${LEVELS_PORT:-3399}"
BASE="http://localhost:${PORT}"
LOG=$(mktemp)

cleanup() {
  if [[ -n "${BOT_PID:-}" ]]; then
    kill "$BOT_PID" 2>/dev/null || true
    wait "$BOT_PID" 2>/dev/null || true
  fi
  rm -f "$LOG"
}
trap cleanup EXIT

echo "→ démarrage bot sur :$PORT"
LEVELS_PORT="$PORT" PNGTUBER_NO_BROWSER=1 node index.js > "$LOG" 2>&1 &
BOT_PID=$!

# Attente readiness — poll /status max 15s
for i in $(seq 1 30); do
  if curl -fsS "$BASE/status" >/dev/null 2>&1; then
    echo "  ✓ bot ready après ${i}×500ms"
    break
  fi
  sleep 0.5
  if [[ $i -eq 30 ]]; then
    echo "  ✗ timeout — log :"
    cat "$LOG"
    exit 1
  fi
done

# Assertions HTTP minimales
ok=0
fail=0
check() {
  local desc="$1" expect="$2" actual="$3"
  if [[ "$expect" == "$actual" ]]; then
    echo "  ✓ $desc ($actual)"
    ok=$((ok+1))
  else
    echo "  ✗ $desc (attendu $expect, reçu $actual)"
    fail=$((fail+1))
  fi
}

check "GET /status"        200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/status)"
check "GET /levels"        200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/levels)"
check "GET /bot-info"      200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/bot-info)"
check "GET /known-users"   200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/known-users)"
check "GET /404"           404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/this-route-does-not-exist)"
check "OPTIONS preflight"  204 "$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS $BASE/levels -H 'Origin: http://localhost:5173')"

# Vérifier qu'il n'y a pas eu d'erreurs fatales dans les logs
if grep -qiE 'unhandledRejection|uncaughtException|FATAL' "$LOG"; then
  echo "  ✗ erreurs fatales dans les logs :"
  grep -iE 'unhandledRejection|uncaughtException|FATAL' "$LOG"
  fail=$((fail+1))
fi

echo "→ résultat : $ok OK, $fail KO"
exit $((fail > 0 ? 1 : 0))
```

Intégrer ce script dans `scripts/deploy/build-deploy.sh` avant le push GHCR.

## Plan d'action priorisé

| Priorité | Action | Effort | Impact |
|----------|--------|--------|--------|
| **P0** | Setup Vitest + scripts npm + structure `tests/` + 1 test exemple (`tokenService`) | 2 h | Débloquer tout le reste |
| **P0** | Tests unit P0 (services : `tokenService`, `authService`, `rateLimiter`, `tierService`) | 6 h | Couvre la sécu critique |
| **P0** | `scripts/smoke-test.sh` + intégration `build-deploy.sh` | 1 h | Filet anti-régression immédiat |
| **P1** | Tests unit `src/db/repos/*` + `src/http/middleware.js` + `src/http/router.js` | 4 h | Couvre les contrats DB + middleware |
| **P1** | Tests intégration upload (`memfs` + multipart + magic bytes + path traversal) | 4 h | Couvre la sécu upload, sujet sensible |
| **P1** | Tests intégration auth flow (OAuth complet avec `nock`) | 3 h | Couvre OAuth de bout en bout |
| **P2** | Tests Vitest + Testing Library côté `client/` (composants critiques + hooks) | 6 h | DX frontend |
| **P2** | Snapshots tests sur `computeFreqBands` / `computeFormants` (entrées PCM fixes) | 3 h | Détecte régressions DSP |
| **P2** | Playwright E2E : login + upload frame + viewer | 4 h | Couvre les parcours complets |
| **P3** | Tests routes restantes (sessions, invitations, notifications, subscriptions) | 4 h | Coverage 70 % |
| **P3** | Mutation testing avec Stryker (vérifier la qualité des tests) | 2 h | Score qualité tests |

**Total P0 : 9 h** → premier filet sécu, scripts en place, premiers tests unitaires sur la crypto.
**Total P0+P1 : 20 h** → couverture sécu/auth/upload solide, intégration avec déploiement.
**Total P0+P1+P2 : 33 h** → ~70 % coverage backend + tests frontend critiques + smoke E2E.
**Total complet : 39 h** wall-clock pour atteindre l'objectif global et stabiliser.

> Note méthodo : ces estimations sont en heures *parallélisables* à plusieurs agents/sessions. En pratique solo séquentiel sur Opus 4.7, compter ~1.5x.
