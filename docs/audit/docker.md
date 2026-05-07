# Audit docker

> Date : 2026-05-07
> Branche : `feat/full-migration`
> Périmètre : `Dockerfile` (multi-stage), `docker-compose.yml`, `.dockerignore`, readiness production.

## Synthèse

Le `Dockerfile` est un multi-stage propre (frontend build → backend native modules → runtime alpine) qui produit une image relativement compacte. Plusieurs durcissements production manquent : pas d'utilisateur non-root, pas de HEALTHCHECK, pas de pinning d'image base par digest, pas de `tini`/init pour la gestion des signaux, pas de limites de ressources, pas de séparation des layers de cache (le `COPY package.json` est bon, mais `COPY src/` et `COPY index.js` invalident le cache à chaque modif backend). Le `docker-compose.yml` est minimaliste (volume data + restart policy), correct pour mono-machine mais sans isolation réseau, sans secrets, sans logging driver et sans limites mémoire/CPU.

**Score global : 6/10** — image fonctionnelle et raisonnablement sécure, mais 5–7 ajustements production mandatory restent.

## Findings

### Critique

Aucun.

### Majeur

- **Container tourne en root** — `Dockerfile:21-49` — Pas de `USER` directive, donc `node` tourne en root dans le container. Si une vuln (path traversal, RCE via image bomb sharp) permet une exécution de commande, l'attaquant a root sur tout le rootfs du container, peut écrire dans `/etc`, lire les secrets de `/proc/self/environ`. **Reco** : `RUN addgroup -g 1001 app && adduser -u 1001 -G app -s /sbin/nologin -D app` puis `USER app` avant `CMD`.
- **Pas de HEALTHCHECK** — `Dockerfile` — Docker n'a aucun moyen de savoir si le bot est vivant. `restart: unless-stopped` redémarre seulement si le process exit. Si Node hang (event loop bloqué, deadlock SQLite WAL), le container reste dans l'état `running` indéfiniment. **Reco** :
  ```dockerfile
  HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
      CMD node -e "fetch('http://localhost:'+process.env.LEVELS_PORT+'/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
  ```
- **Pas de pin par digest** — `Dockerfile:2,12,21` — `node:22-alpine` est un tag mutable. Reco : `node:22-alpine@sha256:<digest>` figé après chaque mise à jour validée.
- **Build context inclut tout** — `.dockerignore` exclut `node_modules`, `data`, `images`, `meta`, `.env`, `*.exe`, `*.ps1`, `*.bat` — ✓ correct, mais pas `.git`, `client/node_modules`, `client/dist` (dist régénéré), `*.db`, `*.db-shm`, `*.db-wal`. **Reco** : ajouter `**/node_modules`, `*.db*`, `.git`, `dist` (root, généré dans le build), `coverage`, `.vscode`, `.claude`, `docs`.
- **Volumes data en bind mount** — `docker-compose.yml:13` — `./data:/app/data` est OK pour mono-host, mais en production cloud il faut un named volume + backup automatique. SQLite avec WAL ne supporte pas le déplacement à chaud du fichier `.db-wal` — un backup naïf via `cp` peut corrompre.
- **`.env` chargé directement** — `docker-compose.yml:6` — `env_file: .env` met tous les secrets dans l'env du process, lisibles via `docker exec ... env` ou `/proc/<pid>/environ`. **Reco** : Docker secrets ou Pangolin secret injection en runtime.

### Mineur

- **Cache layer COPY trop large** — `Dockerfile:33-35` — `COPY index.js ./` puis `COPY src/ ./src/` → un changement dans index.js invalide les layers suivants. C'est l'ordre actuel, ce qui est OK (index.js change plus souvent que src/), mais on pourrait optimiser : grouper `COPY index.js src/ ./` en une étape unique.
- **`apk add` sans `--virtual`** — `Dockerfile:14` — `python3 make g++ gcc libc-dev vips-dev` alourdit le stage backend-build. Or ce stage ne sort que `node_modules` — pas grave en pratique, mais on pourrait `apk del .build-deps` avant le `COPY --from`. Étant donné que ce stage est jeté (multi-stage), gain négligeable.
- **`NODE_ENV=production` en runtime mais pas en build** — `Dockerfile:18` — `npm install --omit=dev` est posé, mais `NODE_ENV` n'est exporté que dans le runtime stage (`Dockerfile:45`). OK car `npm install --omit=dev` ne dépend pas de `NODE_ENV`.
- **Pas de tini/dumb-init** — Node n'est pas un PID 1 idéal (handlers SIGTERM partiels). **Reco** : `RUN apk add --no-cache tini` puis `ENTRYPOINT ["/sbin/tini", "--"]`. Critique si on déploie en K8s (SIGTERM → grace period 30s par défaut).
- **`PNGTUBER_NO_BROWSER=1` en dur** — OK, c'est le bon défaut prod. ✓.
- **Pas de signature d'image** — Reco : `cosign sign` sur GHCR pour la chaîne d'approvisionnement.
- **Image `node:22-alpine`** — Alpine = libc musl, peut poser problème avec certains modules natifs (sharp utilise libvips natif → installé via `apk`, OK ; better-sqlite3 → compilé via gyp, OK ; @discordjs/opus → prebuild ABI, peut nécessiter rebuild sur musl). À surveiller.

## Détail Dockerfile (par stage)

### Stage 1 — `frontend-build`

```dockerfile
FROM node:22-alpine AS frontend-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm install
COPY client/ ./
RUN npm run build
```

- ✓ `package.json` copié avant les sources → cache npm install.
- ⚠ `npm install` (pas `npm ci`) → peut update les versions implicitement si pas de lockfile parfait. **Reco** : `npm ci` (build reproductible).
- ⚠ Aucune purge des devDeps après build (jeté de toute façon, pas grave).
- Output : `/app/dist` (Vite outDir = `'../dist'` relatif à `client/`).

### Stage 2 — `backend-build`

```dockerfile
FROM node:22-alpine AS backend-build
RUN apk add --no-cache python3 make g++ gcc libc-dev vips-dev
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
```

- ✓ Build deps natives présentes (better-sqlite3, sharp, @discordjs/opus, sodium-native).
- ⚠ `npm install` au lieu de `npm ci` (même remarque).
- ⚠ `--omit=dev` est OK car pas de devDeps déclarées (`package.json` n'a que `dependencies`).

### Stage 3 — runtime

```dockerfile
FROM node:22-alpine
RUN apk add --no-cache libstdc++ vips
WORKDIR /app
COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=frontend-build /app/dist ./dist
COPY package.json index.js ./
COPY src/ ./src/
COPY styles.css viewer.html viewer.js ./
RUN mkdir -p /app/data/images /app/data/meta
ENV DATA_ROOT=/app/data PNGTUBER_NO_BROWSER=1 NODE_ENV=production
EXPOSE 3000
CMD ["node", "index.js"]
```

- ⚠ `USER` directive manquante.
- ⚠ `HEALTHCHECK` manquant.
- ⚠ `ENTRYPOINT tini` manquant.
- ✓ Modules natifs runtime requis (`libstdc++` pour opus/sodium-native, `vips` pour sharp) — bien identifiés.
- ✓ `/app/data` créé pour bind mount.

## Détail docker-compose.yml

```yaml
services:
  pngtuber-bot:
    build: .
    container_name: pngtuber-bot
    restart: unless-stopped
    env_file: .env
    environment:
      - DATA_ROOT=/app/data
      - PNGTUBER_NO_BROWSER=1
    ports:
      - "${LEVELS_PORT:-3000}:${LEVELS_PORT:-3000}"
    volumes:
      - ./data:/app/data
```

| Aspect | État | Reco |
|---|---|---|
| `restart: unless-stopped` | ✓ | OK pour single-host |
| Volumes data | ⚠ bind mount | Named volume + backup auto |
| Resource limits | ❌ | `mem_limit: 512m`, `cpus: 1.0` |
| Networks isolation | ❌ network par défaut | network dédié si proxy externe |
| Logging driver | ❌ default json-file | `driver: json-file, options: { max-size: 10m, max-file: 3 }` |
| Secrets | ❌ env_file | Docker secrets / Pangolin runtime |
| Read-only rootfs | ❌ | `read_only: true` + tmpfs `/tmp` |
| Capabilities | ❌ default | `cap_drop: [ALL]`, `cap_add: [NET_BIND_SERVICE]` si port < 1024 |

### Version production-ready proposée

```yaml
services:
  pngtuber-bot:
    image: ghcr.io/<owner>/hereborus-bot@sha256:<digest>
    container_name: pngtuber-bot
    restart: unless-stopped
    env_file: .env
    environment:
      DATA_ROOT: /app/data
      PNGTUBER_NO_BROWSER: "1"
      NODE_ENV: production
      TRUST_PROXY: "true"
    ports:
      - "${LEVELS_PORT:-3000}:3000"
    volumes:
      - pngtuber_data:/app/data
    mem_limit: 512m
    cpus: 1.0
    read_only: true
    tmpfs:
      - /tmp
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: "3"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3000/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s

volumes:
  pngtuber_data:
    driver: local
```

## Production readiness

### Image size

Estimation rapide (sans build) :

| Layer | Estimation |
|---|---|
| Base `node:22-alpine` | ~50 Mo |
| `libstdc++ + vips` | ~15 Mo |
| `node_modules` runtime | ~250 Mo (sharp + opus + voice + native) |
| `dist/` (frontend buildé) | ~2–5 Mo |
| `index.js + src/` | ~300 Ko |
| **Total** | **~320 Mo** |

OK pour pull initial sur VPS, mais on peut viser 200 Mo en virant les .map files de sharp et en `npm prune --production` post-install.

### Logs strategy

- Logs actuels : `console.log/error/warn` → stdout → Docker `json-file` → rotation manuelle.
- **Reco** : pino + transport vers Seq (déjà déployé sur l'infra, voir mémoire utilisateur). Format JSON structuré.

### Backup strategy SQLite + images

- **SQLite** : `pngtuber.db` + `pngtuber.db-wal` + `pngtuber.db-shm` doivent être backupés ensemble. **Méthode safe** : `sqlite3 pngtuber.db ".backup /backup/pngtuber.db"` (via cron dans le container, ou hook de backup sur le host).
- **Images** : `data/images/<token>/<state>/*.webp` — bind mount, snapshotable via `tar` ou via `restic` du host.
- **Reco** : intégrer dans `backup-everything.sh` (script disaster recovery déjà dans la mémoire utilisateur).

### Reverse proxy intégration (Pangolin / Traefik)

Checklist pour intégration derrière le proxy Pangolin de l'utilisateur :

- [ ] `TRUST_PROXY=true` dans `.env`.
- [ ] `BASE_URL=https://hereborus.tojiisamaa.com` (ou domaine choisi).
- [ ] `DISCORD_REDIRECT_URI=https://hereborus.tojiisamaa.com/auth/callback`.
- [ ] Pangolin route TLS → container port 3000.
- [ ] WebSocket support activé sur Pangolin (Traefik gère par défaut, à valider).
- [ ] Header `X-Forwarded-For` propagé par le proxy.
- [ ] Sticky session activé (sinon cookie session perdu si plusieurs replicas — mais on est en mono-replica par design SQLite).
- [ ] CORS_ORIGINS au besoin si OBS pointe vers une autre origine que le BASE_URL.

## Plan d'action priorisé

| Priorité | Action | Effort | Impact |
|----------|--------|--------|--------|
| P0 | Ajouter `USER app` non-root + `HEALTHCHECK` | 30 min | sécu container + auto-restart |
| P0 | `npm install` → `npm ci` dans les 2 stages build | 5 min | reproductibilité |
| P0 | `.dockerignore` : ajouter `**/node_modules`, `.git`, `dist`, `*.db*`, `.claude`, `docs` | 5 min | build context plus petit |
| P1 | Pin image base par digest | 5 min | supply chain |
| P1 | Ajouter `tini` ENTRYPOINT | 10 min | gestion SIGTERM |
| P1 | Resource limits + logging rotation dans compose | 10 min | stabilité prod |
| P1 | Read-only rootfs + cap_drop ALL | 15 min | hardening |
| P2 | Backup SQLite via cron interne ou script host | 1 h | DR |
| P2 | Logger pino → Seq | 1 h | observabilité |
| P3 | `cosign sign` sur GHCR | 30 min | supply chain |
| P3 | Replacer bind mount par named volume + backup auto | 30 min | portabilité |

**État readiness production (Docker)** : **quasi**. Avec les P0 + P1 (≈ 1 h de travail), l'image est prête pour exposition publique derrière Pangolin.
