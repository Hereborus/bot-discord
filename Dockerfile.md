# `Dockerfile`

> **Une ligne** : Image Docker multi-stage (3 stages) qui buildle le frontend React, compile les modules natifs C++ du backend, puis assemble une image finale Alpine légère.
> 📂 `Dockerfile`

## Résumé

49 lignes, 3 stages :
1. **`frontend-build`** : compile l'app React via Vite → `/app/dist`.
2. **`backend-build`** : installe les dépendances Node.js avec compilation native (sodium-native, @discordjs/opus, sharp, better-sqlite3).
3. **Image finale** : runtime minimal Alpine + libstdc++ + vips + node_modules pré-compilés + code source backend + frontend buildé.

Base : `node:22-alpine` (toutes les stages).

## Stages détaillés

### Stage 1 : `frontend-build` (L1-9)
**Brève** : Build de l'app React/Vite.
**Comportement** :
- `WORKDIR /app/client`
- Copie `client/package.json` + lock → `npm install`
- Copie reste de `client/`
- `npm run build` → écrit dans `/app/dist` (Vite `outDir: '../dist'`)
**Audit** :
- 🟢 Cache de couche optimisé (deps avant code source).
- 🟡 `npm install` au lieu de `npm ci` → pas de garantie de reproductibilité parfaite.

### Stage 2 : `backend-build` (L11-18)
**Brève** : Compile les modules natifs Node.
**Comportement** :
- `apk add python3 make g++ gcc libc-dev vips-dev` (toolchain C++ + libvips pour sharp).
- `WORKDIR /app`
- Copie `package.json` + lock-file
- `npm install --omit=dev` → compile @discordjs/opus, sodium-native, better-sqlite3, sharp.
**Audit** :
- 🟡 `npm install` au lieu de `npm ci`.
- 🟡 La toolchain C++ est lourde (>200MB) — bien isolée dans cette stage qui ne se retrouve pas dans l'image finale.

### Stage 3 : Image finale (L20-49)
**Brève** : Runtime minimal.
**Comportement** :
- Base `node:22-alpine` (~50MB).
- `apk add libstdc++ vips` : runtime libs pour les modules natifs (~30MB).
- `WORKDIR /app`
- `COPY --from=backend-build /app/node_modules ./node_modules`
- `COPY --from=frontend-build /app/dist ./dist`
- Code source backend : `package.json`, `index.js`, `src/`
- Pages OBS standalone : `styles.css viewer.html viewer.js`
- `mkdir -p /app/data/images /app/data/meta`
- `ENV DATA_ROOT=/app/data`, `PNGTUBER_NO_BROWSER=1`, `NODE_ENV=production`
- `EXPOSE 3000`
- `CMD ["node", "index.js"]`

## Sécurité

| Critère | État | Note |
|---------|------|------|
| **Multi-stage** | ✅ OUI | 3 stages — toolchain C++ exclue du runtime |
| **Base minimale** | ✅ Alpine | ~50MB de base |
| **User non-root** | ❌ NON | Le `CMD` tourne en `root` — risque élevé en cas d'évasion |
| **HEALTHCHECK** | ❌ NON | Aucun healthcheck déclaré — Docker ne peut pas savoir si le bot est sain |
| **Pinning version Node** | 🟡 Partiel | `node:22-alpine` (pas `node:22.X.Y-alpineZ.W`) → builds non reproductibles dans le temps |
| **Pas de secrets baked-in** | ✅ | Les `.env` sont externes (volume mount) |
| **Pas de COPY .** | ✅ | Copies sélectives — bon usage |
| **`.dockerignore`** | 🟡 OK mais incomplet | Inclut `node_modules`, `data`, `.env` mais PAS `index.html` legacy |
| **`npm ci`** | ❌ NON | Utilise `npm install` — non déterministe |
| **CVE scanning** | N/A | Pas dans le Dockerfile (à faire via Trivy en CI) |

## Variables d'env baked-in

| Variable | Valeur | Rôle |
|----------|--------|------|
| `DATA_ROOT` | `/app/data` | Volume mount cible |
| `PNGTUBER_NO_BROWSER` | `1` | Empêche `openDefaultBrowser()` au boot |
| `NODE_ENV` | `production` | Active les optims V8 |

## Dépendances
- **Système** : `python3 make g++ gcc libc-dev vips-dev` (build) + `libstdc++ vips` (runtime).
- **NPM root** : `package.json` (backend) + `client/package.json` (frontend).
- **Utilisé par** : `docker-compose.yml` (`build: .`) + `scripts/deploy/build-deploy.sh`.

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **Tourne en root** par défaut | Ajouter `RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app` puis `USER app` avant le CMD |
| 🟠 | **Pas de HEALTHCHECK** | Ajouter `HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3000/status \|\| exit 1` |
| 🟡 | `npm install` vs `npm ci` (deux occurrences) | Remplacer par `npm ci --omit=dev` (et `npm ci` côté frontend) pour reproductibilité |
| 🟡 | Pas de pin spécifique de la version Node | `FROM node:22.13.1-alpine3.21` (verrouille la SHA aussi pour la prod) |
| 🟡 | `index.html` (legacy 268KB) n'est pas copié → comportement OK ✓ — mais pas explicitement exclu dans `.dockerignore` | Préciser pour la lisibilité |
| 🟡 | Pas de tini/dumb-init → `CMD ["node", "index.js"]` reçoit SIGTERM en PID 1 mais Node ne forward pas toujours bien aux subprocess (spawn'd children) | Ajouter `RUN apk add --no-cache tini` puis `ENTRYPOINT ["/sbin/tini", "--"]` |
| 🟢 | Multi-stage propre, pas de duplication, ordre des layers optimal | — |

## Notes alternatives

**Dockerfile ultra-amélioré (target)** :
```dockerfile
# Pin SHA pour reproductibilité absolue
FROM node:22.13.1-alpine3.21 AS frontend-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22.13.1-alpine3.21 AS backend-build
RUN apk add --no-cache python3 make g++ gcc libc-dev vips-dev
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:22.13.1-alpine3.21
RUN apk add --no-cache libstdc++ vips tini
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=backend-build --chown=app:app /app/node_modules ./node_modules
COPY --from=frontend-build --chown=app:app /app/dist ./dist
COPY --chown=app:app package.json index.js ./
COPY --chown=app:app src/ ./src/
COPY --chown=app:app styles.css viewer.html viewer.js ./
RUN mkdir -p /app/data/images /app/data/meta && chown -R app:app /app/data
USER app
ENV DATA_ROOT=/app/data PNGTUBER_NO_BROWSER=1 NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/status || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "index.js"]
```

Cette version : non-root, healthcheck, signal handling, npm ci, version pinned. Aucune perte de fonctionnalité.
