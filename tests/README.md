# `tests/`

> Tests automatises (Vitest). Voir [docs/audit/tests.md](../docs/audit/tests.md) pour le plan complet.

## Lancement

```bash
npm test                 # Run tous les tests, mode CI
npm run test:watch       # Mode watch
npm run test:coverage    # Avec rapport coverage v8
```

## Structure

```
tests/
├── unit/         # Tests unitaires de modules src/services/, src/db/repos/
├── integration/  # Tests d'integration (HTTP routes via supertest)
└── e2e/          # Tests E2E Playwright (futur)
```

## Etat actuel

| Module | Couverture |
|--------|------------|
| `src/services/tokenService.js` | ✅ tests/unit/tokenService.test.js |
| Reste | ⏳ a ecrire |

## Conventions

- Un fichier `.test.js` par module teste, dans le sous-dossier correspondant
- Les tests d'`.jsx` peuvent declarer `// @vitest-environment jsdom` en top-of-file
- Mocks via `vi.mock('module-name', ...)` (Vitest API)
- DB de test : in-memory (`new Database(':memory:')`) ou tmpdir avec cleanup

## Tests prioritaires a ecrire (P0)

Issues de [docs/audit/tests.md](../docs/audit/tests.md) :

1. `src/services/authService.js` — sign/verify cookies, sessions GC
2. `src/services/rateLimiter.js` — buckets, refill, expiration
3. `src/services/tierService.js` — getUserTier logic, requirePremium
4. `src/db/repos/*` — queries SQLite (avec :memory:)
5. `src/http/middleware.js` — requireAuth, requireAdmin, requireClientOrAdmin
6. `src/routes/upload.js` — path traversal, MIME, tier enforcement
7. `src/routes/sessions.js` — invitation accept/decline ownership

Estimation effort : ~9h wall-clock parallele pour P0 complet.
