#!/bin/bash
# =============================================================
# Build & Deploy — PNGTuber Bot Discord
# =============================================================
# 1. Vérifie Docker
# 2. Build docker compose (si sources modifiées)
# 3. Lit PENDING_CHANGES.md → commit message
# 4. Git commit + push
# 5. Push image sur GHCR (archivage + portabilité)
# 6. Deploy local (docker compose down/up)
# 7. Health check + résumé
#
# Usage:
#   bash scripts/deploy/build-deploy.sh              # Flow complet
#   bash scripts/deploy/build-deploy.sh --skip-build # Skip le build
#   bash scripts/deploy/build-deploy.sh --force-build # Force rebuild
#   bash scripts/deploy/build-deploy.sh --skip-git   # Skip commit/push git
#   bash scripts/deploy/build-deploy.sh --skip-ghcr  # Skip push GHCR
# =============================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHANGES_FILE="$SCRIPT_DIR/PENDING_CHANGES.md"

[ ! -f "$SCRIPT_DIR/config.sh" ] && { echo "[ERREUR] config.sh introuvable"; exit 1; }
source "$SCRIPT_DIR/config.sh"

# --- Options CLI ---
SKIP_BUILD=false; FORCE_BUILD=false; SKIP_GIT=false; SKIP_GHCR=false
for arg in "$@"; do
  case $arg in
    --skip-build)  SKIP_BUILD=true ;;
    --force-build) FORCE_BUILD=true ;;
    --skip-git)    SKIP_GIT=true ;;
    --skip-ghcr)   SKIP_GHCR=true ;;
  esac
done

# --- Couleurs ---
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERREUR]${NC} $1"; }
log_step()    { echo -e "\n${CYAN}========== $1 ==========${NC}"; }

# --- Vérifier si images sont à jour ---
images_are_fresh() {
  for svc in "${SERVICES[@]}"; do
    IFS='|' read -r _name local_img <<< "$svc"
    [ -z "$(docker images -q "$local_img" 2>/dev/null)" ] && return 1
  done
  local first_img=$(echo "${SERVICES[0]}" | cut -d'|' -f2)
  local img_created=$(docker inspect -f '{{.Created}}' "$first_img" 2>/dev/null)
  local img_epoch=$(date -d "$img_created" +%s 2>/dev/null || echo 0)
  local latest_src=$(find "$PROJECT_ROOT" \
    -path "*/node_modules" -prune -o -path "*/.git" -prune -o -path "*/data" -prune -o \
    \( -name "*.js" -o -name "*.html" -o -name "*.css" -o -name "*.json" \
       -o -name "Dockerfile" -o -name "*.yml" \) -print 2>/dev/null \
    | xargs stat -c %Y 2>/dev/null | sort -rn | head -1 || echo 999999999999)
  [ "$img_epoch" -gt "$latest_src" ] 2>/dev/null
}

# =============================================================
# ÉTAPE 1 : Vérifier Docker
# =============================================================
log_step "1/6 - Vérification Docker"

if docker info >/dev/null 2>&1; then
  log_success "Docker est démarré"
else
  log_warn "Docker n'est pas démarré"
  if [ -n "$DOCKER_DESKTOP" ] && [ -f "$DOCKER_DESKTOP" ]; then
    log_info "Lancement de Docker Desktop..."
    "$DOCKER_DESKTOP" & disown 2>/dev/null
    for i in $(seq 1 24); do
      docker info >/dev/null 2>&1 && { log_success "Docker prêt !"; break; }
      [ "$i" -eq 24 ] && { log_error "Docker pas démarré après 120s."; exit 1; }
      echo -n "."; sleep 5
    done
  else
    log_error "Lancez Docker manuellement puis relancez."; exit 1
  fi
fi

# =============================================================
# ÉTAPE 2 : Docker Compose Build
# =============================================================
log_step "2/6 - Docker Compose Build"

if [ "$SKIP_BUILD" = true ]; then
  log_info "Build skippé (--skip-build)"
elif [ "$FORCE_BUILD" = false ] && images_are_fresh; then
  log_success "Images déjà à jour — utilisez --force-build pour forcer"
else
  cd "$DOCKER_DIR"
  log_info "Build en cours..."
  docker compose build && log_success "Build réussi" || { log_error "Build échoué !"; exit 1; }
fi

# =============================================================
# ÉTAPE 3 & 4 : Git commit + push
# =============================================================
log_step "3/6 - Commit & Push Git"
cd "$PROJECT_ROOT"

if [ "$SKIP_GIT" = true ]; then
  log_info "Git skippé (--skip-git)"
else
  if [ -z "$(git status --porcelain)" ]; then
    log_warn "Aucun changement à commiter"
  else
    if [ ! -f "$CHANGES_FILE" ] || [ ! -s "$CHANGES_FILE" ]; then
      log_error "PENDING_CHANGES.md manquant ou vide."; exit 1
    fi
    COMMIT_TITLE=$(grep -m1 '.' "$CHANGES_FILE" | sed 's/^## //')
    [ -z "$COMMIT_TITLE" ] && { log_error "Message de commit vide."; exit 1; }
    log_info "Commit : $COMMIT_TITLE"
    # Add explicite des fichiers source seulement (jamais .env, data/, build outputs).
    # Les fichiers ignores (.env, data/, dist/, node_modules/) sont deja filtres
    # par .gitignore mais on reste defensif : `git add -u` ne touche que les
    # fichiers DEJA tracked, et l'add explicite des nouveautes evite tout
    # ajout accidentel d'un fichier sensible cree localement.
    git add -u
    git add -- '*.js' '*.jsx' '*.json' '*.md' '*.html' '*.css' '*.sh' \
               'Dockerfile' 'docker-compose.yml' '.gitignore' '.env.example' \
               'src/**' 'client/**' 'scripts/**' 'docs/**' 2>/dev/null || true
    git commit -m "$COMMIT_TITLE"
    echo "" > "$CHANGES_FILE"
    log_success "Commit créé"
  fi
  CURRENT_BRANCH=$(git branch --show-current)
  git push origin "$CURRENT_BRANCH" && log_success "Push → origin/$CURRENT_BRANCH"
fi

# =============================================================
# ÉTAPE 5 : Push GHCR (archivage + portabilité future)
# =============================================================
log_step "4/6 - Push GHCR"

if [ "$SKIP_GHCR" = true ]; then
  log_info "GHCR skippé (--skip-ghcr)"
else
  LOCAL_IMG=$(echo "${SERVICES[0]}" | cut -d'|' -f2)
  if ! docker images -q "$LOCAL_IMG" 2>/dev/null | grep -q .; then
    log_error "Image locale introuvable : $LOCAL_IMG"; exit 1
  fi
  log_info "Tag → $GHCR_IMAGE"
  docker tag "$LOCAL_IMG" "$GHCR_IMAGE"
  log_info "Push → GHCR..."
  docker push "$GHCR_IMAGE" | tail -3 && log_success "Image archivée sur GHCR ($GHCR_IMAGE)"
fi

# =============================================================
# ÉTAPE 6 : Deploy local
# =============================================================
log_step "5/6 - Deploy local"

cd "$DOCKER_DIR"
log_info "Redémarrage du container local..."
docker compose down
docker compose up -d
log_success "Container redémarré en local"

# =============================================================
# ÉTAPE 7 : Health check + résumé
# =============================================================
log_step "6/6 - Health check & Résumé"

log_info "Attente démarrage (5s)..."
sleep 5

STATUS=$(docker inspect --format='{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "stopped")
[ "$STATUS" = "running" ] && log_success "$CONTAINER_NAME : running" || log_warn "$CONTAINER_NAME : $STATUS"

ERRORS=$(docker logs "$CONTAINER_NAME" --since 10s 2>&1 | grep -ci "error\|erreur" 2>/dev/null | head -1 || echo 0)
ERRORS=${ERRORS:-0}
[ "${ERRORS}" -gt 5 ] 2>/dev/null && log_warn "$ERRORS erreurs détectées" || log_success "Pas d'erreurs critiques"

echo ""
log_success "Build         : OK"
[ "$SKIP_GIT"  = false ] && log_success "Git push      : OK"
[ "$SKIP_GHCR" = false ] && log_success "GHCR          : $GHCR_IMAGE"
log_success "Local         : http://localhost:$(grep LEVELS_PORT "$PROJECT_ROOT/.env" 2>/dev/null | cut -d= -f2 || echo 3350)"
echo ""
log_info "Pour déployer sur un serveur plus tard :"
log_info "  docker pull $GHCR_IMAGE"
echo ""

# =============================================================
# TODO : Deploy serveur (à activer quand prêt)
# =============================================================
# Décommenter et configurer DEPLOY_HOST dans config.sh
#
# ssh "$DEPLOY_HOST" "
#   docker pull $GHCR_IMAGE
#   docker stop $VPS_CONTAINER_NAME 2>/dev/null || true
#   docker rm   $VPS_CONTAINER_NAME 2>/dev/null || true
#   docker run -d --name $VPS_CONTAINER_NAME --restart unless-stopped \
#     --env-file $VPS_ENV_FILE -e DATA_ROOT=/app/data -e PNGTUBER_NO_BROWSER=1 \
#     -p ${VPS_PORT}:${VPS_PORT} -v ${VPS_DATA_DIR}:/app/data $GHCR_IMAGE
# "
