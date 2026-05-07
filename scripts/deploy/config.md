# `config.sh`

> **Une ligne** : Configuration centralisée du déploiement — paths, services Docker, GHCR, VPS — sourcée par `build-deploy.sh`.
> 📂 `scripts/deploy/config.sh`

## Résumé

35 lignes. Bash variables `KEY=VALUE` uniquement (pas de logique). Convention Tojii pour la séparation config/logic.

## Variables exportées

### Identité du projet
| Variable | Valeur | Note |
|----------|--------|------|
| `PROJECT_NAME` | `"PNGTuber Bot Discord"` | Affiché dans les logs |

### Chemins
| Variable | Valeur | Note |
|----------|--------|------|
| `PROJECT_ROOT` | `$SCRIPT_DIR/../..` (racine du projet) | Calculé dynamiquement |
| `DOCKER_DIR` | `$PROJECT_ROOT` | Identique (compose à la racine) |
| `DOCKER_DESKTOP` | `/c/Program Files/Docker/Docker/Docker Desktop.exe` | Hardcoded Windows |

### Service Docker local
| Variable | Valeur | Note |
|----------|--------|------|
| `SERVICES` | `("pngtuber-bot\|bot-discord-pngtuber-bot:latest")` | Format tableau bash, séparateur `\|` |
| `CONTAINER_NAME` | `pngtuber-bot` | Match `docker-compose.yml` |

### GHCR (GitHub Container Registry)
| Variable | Valeur | Note |
|----------|--------|------|
| `GHCR_USER` | `hereborus` | Owner GitHub |
| `GHCR_REPO` | `ghcr.io/hereborus/bot-discord` | Repo |
| `GHCR_IMAGE` | `${GHCR_REPO}:latest` | Tag par défaut |

### VPS de déploiement (TODO — non activé)
| Variable | Valeur | Note |
|----------|--------|------|
| `DEPLOY_HOST` | `root@154.16.229.45` | ⚠️ IP non documentée dans la flotte Tojii |
| `VPS_CONTAINER_NAME` | `pngtuber-bot` | — |
| `VPS_PORT` | `3350` | Port différent du local (3000) |
| `VPS_DATA_DIR` | `/root/bot-data` | Volume mount serveur |
| `VPS_ENV_FILE` | `/root/bot-discord.env` | Path env serveur |

## Dépendances
- **Référencé par** : `build-deploy.sh` via `source "$SCRIPT_DIR/config.sh"` (ligne 27).
- **Variables externes attendues** : `$SCRIPT_DIR` (défini par le script appelant).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🟠 | **`DEPLOY_HOST=root@154.16.229.45`** ne correspond à aucun serveur listé dans MEMORY.md (Tojii a `154.16.229.10` pour le VPS Pangolin et `187.124.50.229` pour Hostinger). Soit IP obsolète, soit erreur de frappe (`.45` vs `.10`) | Confirmer ou corriger l'IP |
| 🟠 | **`DOCKER_DESKTOP` hardcoded** sur Windows → script ne fonctionne pas hors Windows | Détection dynamique : `if [[ "$OSTYPE" == "msys"* \|\| "$OSTYPE" == "cygwin"* ]]; then DOCKER_DESKTOP=...; fi` |
| 🟠 | **Pas de `GHCR_TOKEN` ni vérification login** | Documenter la nécessité de `docker login ghcr.io` au préalable |
| 🟡 | `VPS_PORT=3350` (deploy) ≠ port local 3000 par défaut → incohérence à expliquer | Ajouter un commentaire ou unifier |
| 🟡 | Le `SERVICES` tableau a UN seul élément — sur-engineering pour un projet mono-service | OK car laisse la porte ouverte à un microservices futur |
| 🟡 | Pas de pin de tag GHCR (`:latest` uniquement) — pas de versioning | Ajouter `GHCR_TAG="${GHCR_TAG:-latest}"` pour permettre `GHCR_TAG=v1.2.3 bash build-deploy.sh` |
| 🟡 | Pas de variable pour activer/désactiver le deploy SSH (le bloc TODO dans build-deploy.sh) | Ajouter `ENABLE_SSH_DEPLOY=false` |
| 🟢 | Séparation propre config/logic — pattern réutilisable |

## Notes alternatives

**Refacto recommandée** :
```bash
#!/bin/bash
# Project
PROJECT_NAME="PNGTuber Bot Discord"

# Paths
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DOCKER_DIR="$PROJECT_ROOT"

# Docker Desktop (auto-detect OS)
case "$OSTYPE" in
  msys*|cygwin*) DOCKER_DESKTOP="/c/Program Files/Docker/Docker/Docker Desktop.exe" ;;
  darwin*)       DOCKER_DESKTOP="/Applications/Docker.app/Contents/MacOS/Docker" ;;
  *)             DOCKER_DESKTOP="" ;; # Linux : systemd ou rien
esac

# Local service
SERVICES=("pngtuber-bot|bot-discord-pngtuber-bot:latest")
CONTAINER_NAME="pngtuber-bot"

# GHCR
GHCR_USER="hereborus"
GHCR_REPO="ghcr.io/hereborus/bot-discord"
GHCR_TAG="${GHCR_TAG:-latest}"
GHCR_IMAGE="${GHCR_REPO}:${GHCR_TAG}"

# Deploy SSH (optional)
ENABLE_SSH_DEPLOY="${ENABLE_SSH_DEPLOY:-false}"
DEPLOY_HOST="${DEPLOY_HOST:-root@154.16.229.10}"  # VPS Tojii Pangolin
VPS_CONTAINER_NAME="pngtuber-bot"
VPS_PORT="3350"
VPS_DATA_DIR="/root/bot-data"
VPS_ENV_FILE="/root/bot-discord.env"
```
