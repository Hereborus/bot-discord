# Audit kubernetes

> Date : 2026-05-07
> Branche : `feat/full-migration`
> Périmètre : plan de déploiement K8s, manifests recommandés, considérations stateful, scaling.

## Synthèse

Le projet n'est **pas K8s-ready out-of-the-box**. Trois blocages structurels : (1) **SQLite single-writer** rend le scaling horizontal impossible sans changement de DB ; (2) **sessions et rate-limit en mémoire** rendent multi-replica incohérent ; (3) **uploads images sur disque local** nécessitent un volume persistant `RWO` et empêchent les replicas concurrents. Le bot Discord lui-même ne supporte qu'**une seule instance active** (un seul WebSocket Gateway autorisé par token), ce qui plafonne de fait à `replicas: 1`. Pour une mise en prod K8s **mono-replica**, l'effort est **2-3 h** (manifests + probe endpoints à coder). Pour un vrai scale-out (≥ 2 replicas), il faut migrer SQLite → Postgres, sessions → Redis, et splitter le bot worker du HTTP serveur — ≈ 2 jours de refactoring.

**Score global : 3/10 en l'état**, **8/10 si on accepte mono-replica + StatefulSet**.

## État actuel — pourquoi pas K8s-ready

| Blocage | Localisation | Impact K8s |
|---|---|---|
| **SQLite single-writer** | `src/db/database.js:22` (`new Database(DB_PATH)` + WAL) | Pas de scaling horizontal. PVC RWO obligatoire. |
| **Sessions in-memory** | `src/services/authService.js:20` (`Map`) | Cookies invalidés à chaque rolling restart |
| **Rate limiter in-memory** | `src/services/rateLimiter.js:13` (`Map`) | Bypass possible en multi-replica (chaque pod a son compteur) |
| **Device auth requests in-memory** | `src/routes/device.js:37` (`Map`) | Idem |
| **Discord bot single-instance** | `src/bot/discord.js` (un seul `client.login`) | Ne peut pas scaler le bot Gateway |
| **Uploads sur disque local** | `data/images/<token>/<state>/` | RWX impossible sur tous les CSI ; bind à un nœud |
| **Pas de readiness/liveness endpoints** | aucune route `/healthz`/`/readyz` dédiée | À ajouter (`/status` existe mais retourne 200 même si DB cassée) |
| **Pas de metrics endpoint** | aucun `/metrics` Prometheus | À ajouter pour HPA ou monitoring |
| **Logs non structurés** | `console.*` partout | Loki/Datadog ingestion sous-optimale |
| **Auto-genère `.env` au boot** | `index.js:283-291` | Filesystem read-only impossible ; secrets doivent venir d'un Secret K8s |

## Considérations clés

### 1. SQLite est stateful

- Fichier `pngtuber.db` dans `DATA_ROOT=/app/data`.
- WAL activé : 3 fichiers (`db`, `db-wal`, `db-shm`) qui doivent rester ensemble sur le même volume.
- **Conséquence** : `Deployment` interdit, **`StatefulSet`** obligatoire avec `volumeClaimTemplates` `RWO`.

### 2. Uploads images aussi

- `data/images/<token>/<state>/*.webp` — accumulation potentiellement importante (10 Mo/image × N users × 10 frames × 5 états = plusieurs GB).
- Même PVC que la DB → simple, ou PVC séparé pour permettre scaling indépendant.

### 3. WebSocket sticky session

- WebSocket vers `/ws` pour push temps réel des niveaux audio.
- En mono-replica : non-problème.
- En multi-replica futur : `Service` type `ClusterIP` + Ingress avec `nginx.ingress.kubernetes.io/affinity: cookie`, ou Pangolin sticky.

### 4. OAuth callback URL stable

- `DISCORD_REDIRECT_URI` doit être l'URL publique stable (Ingress + cert-manager + DNS Cloudflare).
- Pas de support « callback dynamique par pod ».

### 5. Discord token = 1 instance Gateway maximum

- Discord refuse 2 connexions simultanées sur la même `IDENTIFY` payload.
- Donc même si on scale le HTTP layer, le bot Discord doit rester en 1 réplica.
- **Pattern** : split en 2 services — `bot-worker` (replicas: 1) et `api-server` (replicas: N) communiquant via Redis pub/sub. Pas en scope pour la première itération.

## Manifests recommandés

### `Namespace`

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: hereborus
```

### `Secret` (à créer hors-repo)

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: hereborus-secrets
  namespace: hereborus
type: Opaque
stringData:
  DISCORD_TOKEN: "REPLACE_ME"
  DISCORD_CLIENT_ID: "REPLACE_ME"
  DISCORD_CLIENT_SECRET: "REPLACE_ME"
  USER_HASH_SECRET: "REPLACE_ME_64_HEX_CHARS"
  SESSION_SECRET: "REPLACE_ME_64_HEX_CHARS"
  ADMIN_DISCORD_ID: "REPLACE_ME"
```

Génération des secrets : `openssl rand -hex 32` pour `USER_HASH_SECRET` et `SESSION_SECRET`. **Important** : si le pod redémarre et que ces deux secrets sont dans le Secret K8s, les sessions et tokens sont préservés à travers les restarts (contrairement à l'auto-gen actuelle dans `.env`).

### `ConfigMap`

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: hereborus-config
  namespace: hereborus
data:
  LEVELS_PORT: "3000"
  DATA_ROOT: "/app/data"
  PNGTUBER_NO_BROWSER: "1"
  NODE_ENV: "production"
  TRUST_PROXY: "true"
  BASE_URL: "https://hereborus.tojiisamaa.com"
  DISCORD_REDIRECT_URI: "https://hereborus.tojiisamaa.com/auth/callback"
  CORS_ORIGINS: "https://hereborus.tojiisamaa.com"
```

### `StatefulSet` (mono-replica, SQLite)

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: hereborus-bot
  namespace: hereborus
spec:
  serviceName: hereborus-bot
  replicas: 1
  selector:
    matchLabels: { app: hereborus-bot }
  template:
    metadata:
      labels: { app: hereborus-bot }
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        runAsGroup: 1001
        fsGroup: 1001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: bot
          image: ghcr.io/<owner>/hereborus-bot@sha256:<digest>
          imagePullPolicy: IfNotPresent
          ports:
            - { name: http, containerPort: 3000 }
          env:
            - name: NODE_OPTIONS
              value: "--max-old-space-size=384"
          envFrom:
            - configMapRef: { name: hereborus-config }
            - secretRef: { name: hereborus-secrets }
          volumeMounts:
            - { name: data, mountPath: /app/data }
          resources:
            requests: { cpu: 200m, memory: 256Mi }
            limits:   { cpu: 1000m, memory: 512Mi }
          livenessProbe:
            httpGet: { path: /healthz, port: http }
            initialDelaySeconds: 30
            periodSeconds: 30
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet: { path: /readyz, port: http }
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3
          startupProbe:
            httpGet: { path: /healthz, port: http }
            failureThreshold: 30
            periodSeconds: 5
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: [ALL] }
      volumes: []
  volumeClaimTemplates:
    - metadata: { name: data }
      spec:
        accessModes: [ReadWriteOnce]
        resources: { requests: { storage: 10Gi } }
        storageClassName: local-path  # adapter au cluster (longhorn, openebs, etc.)
```

### `Service`

```yaml
apiVersion: v1
kind: Service
metadata:
  name: hereborus-bot
  namespace: hereborus
spec:
  type: ClusterIP
  selector: { app: hereborus-bot }
  ports:
    - { name: http, port: 80, targetPort: 3000 }
```

### `Ingress` (cert-manager + sticky cookie)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: hereborus-bot
  namespace: hereborus
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/affinity: cookie
    nginx.ingress.kubernetes.io/session-cookie-name: hereborus-route
    nginx.ingress.kubernetes.io/session-cookie-max-age: "172800"
    nginx.ingress.kubernetes.io/proxy-body-size: 50m
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
spec:
  ingressClassName: nginx
  tls:
    - hosts: [hereborus.tojiisamaa.com]
      secretName: hereborus-tls
  rules:
    - host: hereborus.tojiisamaa.com
      http:
        paths:
          - { path: /, pathType: Prefix, backend: { service: { name: hereborus-bot, port: { number: 80 } } } }
```

### `HorizontalPodAutoscaler` (à NE PAS appliquer en l'état)

```yaml
# DANGER: ne marchera pas avec SQLite en l'état.
# Garder à replicas: 1 jusqu'à migration Postgres + Redis.
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: hereborus-bot
  namespace: hereborus
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: StatefulSet, name: hereborus-bot }
  minReplicas: 1
  maxReplicas: 1   # forcé tant que SQLite single-writer
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: 70 } }
```

### `NetworkPolicy` (defense-in-depth)

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: hereborus-bot
  namespace: hereborus
spec:
  podSelector: { matchLabels: { app: hereborus-bot } }
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - namespaceSelector: { matchLabels: { name: ingress-nginx } }
      ports: [{ port: 3000 }]
  egress:
    - to: []  # Discord API (gateway.discord.gg, discord.com)
      ports:
        - { port: 443, protocol: TCP }
        - { port: 53,  protocol: UDP }
```

## Migrations recommandées pour scaling > 1 replica

Si un jour on veut scaler horizontalement :

| Composant actuel | Migration |
|---|---|
| SQLite (`src/db/database.js`) | **Postgres** via Drizzle/Kysely. Repos déjà bien isolés (`src/db/repos/*.js`) → migration simplifiée. |
| Sessions Map (`authService.js`) | **Redis** ou table Postgres `sessions(id, payload, expires_at)`. Préférer table — plus simple. |
| Rate limiter Map | **Redis** avec script Lua atomique, ou utiliser `rate-limiter-flexible`. |
| Device auth Map | **Redis** TTL 5 min. |
| Discord bot | **Split** en deployment séparé `replicas: 1` ; communication via Redis pub/sub pour broadcast levels aux pods API. |
| Uploads disque | **S3-compatible** (MinIO, Cloudflare R2). Réécrire `serveFile` → presigned URLs ou proxy. |
| WebSocket broadcast | **Redis pub/sub** ou socket.io adapter. |

**Effort estimé** : 2 jours wall-clock parallélisé en 4 agents (DB migration / sessions / file storage / bot split).

## Helm chart — squelette `values.yaml`

```yaml
image:
  repository: ghcr.io/<owner>/hereborus-bot
  tag: ""  # défaut = .Chart.AppVersion
  pullPolicy: IfNotPresent

replicaCount: 1   # forcé tant que SQLite

config:
  baseUrl: "https://hereborus.tojiisamaa.com"
  trustProxy: true
  corsOrigins: ""

secrets:
  discordToken: ""
  discordClientId: ""
  discordClientSecret: ""
  userHashSecret: ""    # generate: openssl rand -hex 32
  sessionSecret: ""     # generate: openssl rand -hex 32
  adminDiscordId: ""

persistence:
  enabled: true
  storageClass: ""
  size: 10Gi
  accessMode: ReadWriteOnce

ingress:
  enabled: true
  className: nginx
  host: hereborus.tojiisamaa.com
  tls: true
  certIssuer: letsencrypt-prod
  stickySessions: true

resources:
  requests: { cpu: 200m, memory: 256Mi }
  limits:   { cpu: 1000m, memory: 512Mi }

securityContext:
  runAsNonRoot: true
  runAsUser: 1001
  readOnlyRootFilesystem: true

probes:
  liveness:  { path: /healthz, periodSeconds: 30 }
  readiness: { path: /readyz, periodSeconds: 10 }
  startup:   { path: /healthz, failureThreshold: 30 }

networkPolicy:
  enabled: true
```

## Healthchecks à ajouter dans le code

Endpoints à coder dans `index.js` ou `src/routes/health.js` :

```js
// /healthz — liveness : process is responsive
route('GET', '/healthz', async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
});

// /readyz — readiness : DB + Discord ready
route('GET', '/readyz', async (req, res) => {
    try {
        // SQLite write-able
        db.prepare('SELECT 1').get();
        // Discord bot connected (or auth disabled)
        const ready = !AUTH_ENABLED || botConnected;
        if (!ready) throw new Error('bot not ready');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ready' }));
    } catch (err) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'not ready', error: err.message }));
    }
});
```

## Monitoring

### Metrics endpoint Prometheus

À ajouter via `prom-client` :

```js
import { register, collectDefaultMetrics, Counter, Gauge, Histogram } from 'prom-client';
collectDefaultMetrics();
const httpRequests = new Counter({ name: 'http_requests_total', help: '...', labelNames: ['method', 'route', 'status'] });
const wsConnections = new Gauge({ name: 'ws_connections', help: '...' });
const uploadDuration = new Histogram({ name: 'upload_duration_seconds', help: '...' });
const sqliteSize     = new Gauge({ name: 'sqlite_db_bytes', help: '...' });

route('GET', '/metrics', async (req, res) => {
    res.writeHead(200, { 'Content-Type': register.contentType });
    res.end(await register.metrics());
});
```

### Logs structurés

Migrer de `console.*` vers `pino` :

```js
import pino from 'pino';
const log = pino({ level: process.env.LOG_LEVEL || 'info' });
log.info({ route: '/upload', token, size: outputBuffer.length }, 'frame uploaded');
```

Compatible avec ingestion Loki / Seq (déjà déployé).

## Plan d'action priorisé

| Priorité | Action | Effort | Impact |
|----------|--------|--------|--------|
| P0 | Endpoints `/healthz` + `/readyz` dans le code | 30 min | probes K8s |
| P0 | Forcer `replicas: 1` + StatefulSet pour SQLite | 0 (design) | éviter corruption |
| P0 | Secrets en `Secret` K8s, pas dans `.env` | 1 h (refactor `index.js:283-293` pour ne pas écrire `.env` si déjà set) | sécu prod |
| P1 | Helm chart minimal (templates StatefulSet + Service + Ingress + Secret + ConfigMap) | 3 h | déploiement reproductible |
| P1 | Endpoint `/metrics` Prometheus + dashboard Grafana | 2 h | observabilité |
| P1 | Logger pino structuré | 1 h | logs exploitables |
| P2 | NetworkPolicy egress restreint à Discord | 30 min | hardening |
| P3 | Migration SQLite → Postgres (préparer mais ne pas exécuter) | 2 j | scale horizontal |
| P3 | Split bot-worker / api-server + Redis pub/sub | 1 j | HA |

**État readiness K8s** : **non** en l'état. **quasi** après P0 + P1 (≈ 7 h wall-clock parallélisable en 3 agents pour ≈ 2 h 30 réelles). Pour scale > 1 replica : **non** sans migration Postgres + Redis (2 jours).
