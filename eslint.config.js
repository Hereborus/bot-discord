// ESLint v10 flat config
// Couvre : backend ES Modules + frontend React 18 + tests Vitest
// Reglage minimaliste — focus sur les erreurs reelles, pas le style cosmetique
// (deja gere par Prettier).

import js from '@eslint/js';
import globals from 'globals';

export default [
  // Ignores globaux
  {
    ignores: [
      'node_modules/**',
      'client/node_modules/**',
      'dist/**',
      'data/**',
      'images/**',
      'meta/**',
      'docs/**',
      '**/*.md',
      'pngtuber.db*',
    ],
  },

  // Backend Node.js
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^(_|err|e)$',
      }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-prototype-builtins': 'off', // SQLite rows are plain objects
      'no-async-promise-executor': 'warn',
      'no-control-regex': 'off',
    },
  },

  // Frontend React (JSX)
  {
    files: ['client/**/*.jsx', 'client/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2024,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^[_A-Z]', // composants React PascalCase souvent definis-mais-conditionnels
        caughtErrorsIgnorePattern: '^(_|err|e)$',
      }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },

  // Tests Vitest — globals additionnels
  {
    files: ['tests/**/*.js', '**/*.test.js', '**/*.spec.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
  },

  // viewer.js / scripts utilisent du DOM
  {
    files: ['viewer.js'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
];
