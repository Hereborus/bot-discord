# `package.json`

> **Une ligne** : Manifeste npm du backend — Node.js 18+ ESM, 10 dépendances runtime (Discord, audio, sharp, sqlite, ws), 8 scripts (dev, build:ui, docker:*).
> 📂 `package.json`

## Résumé

30 lignes. Backend Node.js en ESM (`"type": "module"`). Pas de devDependencies — toutes les deps sont runtime. Pas de testRunner ni linter configuré.

```json
{
    "name": "pngtuber-bot-discord",
    "version": "1.0.0",
    "main": "index.js",
    "type": "module"
}
```

## Scripts npm

| Script | Commande | Rôle |
|--------|----------|------|
| `start` | `node index.js` | Run prod |
| `dev:api` | `node index.js` | Run dev (alias de start) |
| `dev:ui` | `cd client && npm run dev` | Dev frontend Vite (port 5173) |
| `build:ui` | `cd client && npm run build` | Build React → `dist/` |
| `docker:build` | `docker compose build` | Build image |
| `docker:up` | `docker compose up -d` | Lance le bot |
| `docker:down` | `docker compose down` | Stoppe le bot |
| `docker:logs` | `docker compose logs -f` | Follow logs |

**Audit** :
- 🟡 `start` et `dev:api` sont identiques — pas de séparation NODE_ENV, pas de hot-reload (pas de nodemon ni node --watch).
- 🟠 **Aucun script `test`, `lint`, `typecheck`** — qualité non-vérifiée automatiquement (CLAUDE.md le confirme : "Validation is manual (`node --check`)").

## Dépendances runtime

| Package | Version | Usage |
|---------|---------|-------|
| `@discordjs/opus` | `^0.10.0` | Codec audio Opus (compilation C++ requise) |
| `@discordjs/voice` | `^0.19.0` | Voice gateway / receiver Discord |
| `@snazzah/davey` | `^0.1.10` | Voice DAVE encryption (Discord 2024+) |
| `discord.js` | `^14.25.1` | SDK Discord principal |
| `dotenv` | `^17.3.1` | Chargement `.env` |
| `fft-js` | `^0.0.12` | FFT 1024-point pour bandes fréquentielles |
| `prism-media` | `^1.3.5` | Décodage Opus → PCM |
| `better-sqlite3` | `^11.0.0` | DB SQLite synchrone (compilation C++ requise) |
| `sharp` | `^0.33.0` | Sanitisation/conversion images WebP (libvips) |
| `sodium-native` | `^4.3.3` | NaCl crypto (xchacha20-poly1305) (compilation C++) |
| `ws` | `^8.0.0` | WebSocket server |

**Modules natifs C++** : `@discordjs/opus`, `better-sqlite3`, `sharp`, `sodium-native` → expliquent le stage `backend-build` du Dockerfile (apk add `python3 make g++ gcc libc-dev vips-dev`).

**Audit deps** :
- 🟢 Pas d'Express ni de framework lourd — server HTTP natif.
- 🟢 Sharp utilisé comme couche de sanitisation des uploads (CLAUDE.md L136).
- 🟡 `fft-js@^0.0.12` : version 0.x, peu maintenue (dernier release ~2017). Pas de remplacement évident en JS pur, mais à surveiller si CVE.
- 🟡 `dotenv@^17` : version récente — OK.
- 🟡 Aucune dep dev → pas d'eslint, prettier, jest, vitest, husky.
- 🟠 **Pas de `engines.node`** : aucune contrainte de version Node ≥18 explicite (juste mention dans CLAUDE.md).

## Champs manquants (vs best practices npm)

| Champ | Présent ? | Recommandation |
|-------|-----------|----------------|
| `name` | ✅ | OK |
| `version` | ✅ `1.0.0` | OK |
| `description` | ✅ | OK |
| `main` | ✅ `index.js` | OK |
| `type` | ✅ `module` | OK |
| `scripts` | ✅ | OK mais incomplet (pas de `test`, `lint`) |
| `dependencies` | ✅ | OK |
| `engines.node` | ❌ | Ajouter `"engines": { "node": ">=18.0.0" }` |
| `repository` | ❌ | Ajouter le lien GitHub pour `npm publish` futur |
| `license` | ❌ | Ajouter une licence (MIT, AGPL, etc.) |
| `author` | ❌ | Ajouter Tojii / hereborus |
| `keywords` | ❌ | Optionnel |
| `private` | ❌ | Si pas publié sur npm, ajouter `"private": true` |
| `devDependencies` | ❌ | Ajouter eslint, prettier, vitest |

## Dépendances
- **Manifeste pour** : tout le backend Node.
- **Utilisé par** : `npm install`, `Dockerfile` (stage backend-build), `scripts/deploy/build-deploy.sh`.
- **Pas de relation** avec `client/package.json` (manifeste séparé pour le frontend React).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **Aucun script `test`, `lint`, `typecheck`** — pas de garde-fou CI | Ajouter `vitest`, `eslint`, `npm-run-all` ; définir `lint`, `test`, `typecheck:check` |
| 🟠 | **Pas d'`engines.node`** — un dev avec Node 16 ne sera pas averti | Ajouter `"engines": { "node": ">=18.0.0", "npm": ">=9.0.0" }` |
| 🟡 | **Pas de `private: true`** — risque de publication accidentelle sur npm | Ajouter `"private": true` |
| 🟡 | **Pas de license / repository** | Ajouter ces champs |
| 🟡 | `start` = `dev:api` (sans NODE_ENV différent) | Différencier : `start` → prod, `dev:api` → `node --watch index.js` |
| 🟡 | Pas de devDependencies | Ajouter au minimum `eslint` + `prettier` |
| 🟢 | Versions des deps relativement à jour (Discord.js 14.25 récent) | — |

## Notes alternatives

**Refacto recommandée du `package.json`** :
```json
{
    "name": "pngtuber-bot-discord",
    "version": "1.0.0",
    "private": true,
    "description": "Bot Discord PNGTuber avec UI locale et viewer OBS",
    "main": "index.js",
    "type": "module",
    "engines": {
        "node": ">=18.0.0",
        "npm": ">=9.0.0"
    },
    "license": "AGPL-3.0",
    "repository": {
        "type": "git",
        "url": "https://github.com/hereborus/bot-discord.git"
    },
    "scripts": {
        "start": "node index.js",
        "dev:api": "node --watch index.js",
        "dev:ui": "cd client && npm run dev",
        "build:ui": "cd client && npm run build",
        "lint": "eslint src/ index.js",
        "test": "vitest run",
        "typecheck": "node --check index.js && find src -name '*.js' -exec node --check {} +",
        "docker:build": "docker compose build",
        "docker:up": "docker compose up -d",
        "docker:down": "docker compose down",
        "docker:logs": "docker compose logs -f"
    },
    "dependencies": { ... },
    "devDependencies": {
        "eslint": "^9",
        "prettier": "^3",
        "vitest": "^2"
    }
}
```
