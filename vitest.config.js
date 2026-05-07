import { defineConfig } from 'vitest/config';

// Vitest config — tests backend en environnement Node, frontend en jsdom
// (separation par projects). Coverage v8.
//
// Lancement :
//   npm test              -> tous les tests, mode CI
//   npm run test:watch    -> mode watch
//   npm run test:coverage -> rapport de coverage
export default defineConfig({
  test: {
    // Pattern par defaut : tests/ + co-localises *.test.js
    include: ['tests/**/*.test.js', 'src/**/*.test.js', 'client/src/**/*.test.{js,jsx}'],
    exclude: [
      'node_modules/**',
      'client/node_modules/**',
      'dist/**',
      'data/**',
      'docs/**',
    ],
    // Environnement par defaut Node (backend). Les tests frontend
    // peuvent declarer @vitest-environment jsdom en top-of-file.
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: [
        'src/**/*.js',
        'client/src/**/*.{js,jsx}',
      ],
      exclude: [
        'src/**/*.test.js',
        'src/db/migrations/**',
      ],
      thresholds: {
        // Seuils initiaux bas — augmenter au fil de l'ecriture des tests.
        // Cible 70% backend, 90% crypto/auth (cf docs/audit/tests.md).
        lines: 0,
        statements: 0,
        branches: 0,
        functions: 0,
      },
    },
  },
});
