# `docker-compose.yml`

> **Une ligne** : Compose mono-service qui builde et lance le PNGTuber Bot avec mount du dossier `./data` et exposition du port `LEVELS_PORT` (défaut 3000).
> 📂 `docker-compose.yml`

## Résumé

13 lignes — minimaliste. Un seul service `pngtuber-bot` :
- `build: .` (utilise le `Dockerfile` à la racine).
- `container_name: pngtuber-bot` (forcé pour `docker logs pngtuber-bot`).
- `restart: unless-stopped` (relance auto sauf arrêt manuel).
- `env_file: .env` (charge toutes les variables).
- Variables sur-écrites : `DATA_ROOT=/app/data`, `PNGTUBER_NO_BROWSER=1`.
- Port : `${LEVELS_PORT:-3000}:${LEVELS_PORT:-3000}`.
- Volume : `./data:/app/data`.

## Configuration

| Champ | Valeur | Note |
|-------|--------|------|
| `services.pngtuber-bot.build` | `.` | Dockerfile à la racine du projet |
| `container_name` | `pngtuber-bot` | Nom fixe — empêche le scaling et les multi-instances |
| `restart` | `unless-stopped` | Bon choix pour un bot |
| `env_file` | `.env` | Doit exister à la racine |
| `ports` | `${LEVELS_PORT:-3000}:${LEVELS_PORT:-3000}` | Port mappé identique côté host et container |
| `volumes` | `./data:/app/data` | Persistance SQLite + images + meta + viewer-sessions |

## Dépendances
- **Importe** : `Dockerfile`, `.env`, dossier `./data/`.
- **Utilisé par** : `docker compose up -d` (manuel), `scripts/deploy/build-deploy.sh` (automatisé).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **Pas de healthcheck** au niveau compose (et pas dans le Dockerfile non plus) — le `restart: unless-stopped` ne peut pas redémarrer un container qui réponde en zombie | Ajouter `healthcheck:` dans le compose OU au Dockerfile |
| 🟠 | **Pas de logging driver** explicite — utilise le driver par défaut (souvent `json-file` sans rotation) → risque de saturation disque | Ajouter `logging: { driver: json-file, options: { max-size: 10m, max-file: 3 } }` |
| 🟡 | **Pas de réseau isolé** déclaré — utilise le réseau bridge par défaut | OK pour single-container ; si futur ajout de DB ou Redis externe, créer un réseau nommé |
| 🟡 | **Pas de limites de ressources** (`mem_limit`, `cpus`) — un bug pourrait OOM le host | Ajouter `mem_limit: 1g`, `cpus: '1.0'` |
| 🟡 | `container_name: pngtuber-bot` empêche le scaling (`docker compose up --scale=2` échoue) | Pour un bot Discord, c'est OK (singleton voulu) — laisser tel quel |
| 🟡 | Pas de `read_only: true` ni `tmpfs` | Optionnel — passer le rootfs en read-only avec `data` mountable en RW |
| 🟢 | `restart: unless-stopped` correct pour un bot |
| 🟢 | Volume mount minimal et précis |

## Configuration recommandée enrichie

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
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:${LEVELS_PORT:-3000}/status"]
      interval: 30s
      timeout: 5s
      start_period: 15s
      retries: 3
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    mem_limit: 1g
    cpus: "1.0"
```

## Notes alternatives

- Pour la prod multi-tenant (déploiement chez un client), envisager une variante `docker-compose.prod.yml` avec image GHCR (`image: ghcr.io/hereborus/bot-discord:latest`) au lieu de `build: .`. Voir `scripts/deploy/build-deploy.sh` qui pousse déjà sur GHCR.
- Aucun secret n'est dans ce fichier — tout passe par `.env`. ✅
