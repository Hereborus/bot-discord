#!/bin/bash
# =============================================================
# Configuration du projet — PNGTuber Bot Discord
# =============================================================

# --- Nom du projet ---
PROJECT_NAME="PNGTuber Bot Discord"

# --- Chemins ---
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DOCKER_DIR="$PROJECT_ROOT"

# Docker Desktop (Windows)
DOCKER_DESKTOP="/c/Program Files/Docker/Docker/Docker Desktop.exe"

# --- Service Docker local ---
# Format : "nom|image_locale:tag"
SERVICES=(
  "pngtuber-bot|bot-discord-pngtuber-bot:latest"
)
CONTAINER_NAME="pngtuber-bot"

# --- GHCR ---
GHCR_USER="hereborus"
GHCR_REPO="ghcr.io/hereborus/bot-discord"
GHCR_IMAGE="${GHCR_REPO}:latest"

# --- Serveur VPS (SSH) ---
DEPLOY_HOST="root@154.16.229.45"

# Paramètres docker run sur le VPS
VPS_CONTAINER_NAME="pngtuber-bot"
VPS_PORT="3350"
VPS_DATA_DIR="/root/bot-data"
VPS_ENV_FILE="/root/bot-discord.env"
