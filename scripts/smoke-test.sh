#!/usr/bin/env bash
# scripts/smoke-test.sh
# =====================
# Smoke test minimaliste : demarre le bot, attend qu'il soit pret, ping
# les endpoints critiques, kill le process. But : detecter les regressions
# bloquantes (crash au boot, route 500, deps cassees) sans necessiter une
# CI complete.
#
# Usage :
#   bash scripts/smoke-test.sh
#   PORT=4000 bash scripts/smoke-test.sh   # port custom
#
# Pre-requis :
#   - npm install OK (modules natifs C++ compiles)
#   - .env minimal (au moins DISCORD_TOKEN absent OK, juste le serveur HTTP teste)
#   - curl + jq disponibles

set -euo pipefail

PORT="${PORT:-3334}"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$(mktemp)"
PID=""

cleanup() {
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        kill -TERM "$PID" 2>/dev/null || true
        sleep 1
        kill -KILL "$PID" 2>/dev/null || true
    fi
    rm -f "$LOG_FILE"
}
trap cleanup EXIT INT TERM

echo "=== smoke-test ==="
echo "  port : $PORT"
echo "  log  : $LOG_FILE"

# ── Demarrage du bot ──────────────────────────────────────────────
cd "$SCRIPT_DIR"
LEVELS_PORT="$PORT" \
    DISCORD_TOKEN="${DISCORD_TOKEN:-}" \
    PNGTUBER_NO_BROWSER=1 \
    DATA_ROOT="$(mktemp -d)" \
    ALLOW_NO_AUTH=true \
    NODE_ENV=test \
    node index.js > "$LOG_FILE" 2>&1 &
PID=$!
echo "  pid  : $PID"

# ── Attendre que le serveur HTTP reponde ──────────────────────────
echo "  ↳ wait for HTTP up (timeout 30s)..."
for i in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$PORT/status" > /dev/null 2>&1; then
        echo "    OK ($i s)"
        break
    fi
    if [ "$i" = 30 ]; then
        echo "  ✗ HTTP server n'a jamais demarre"
        echo "--- last log ---"
        tail -30 "$LOG_FILE"
        exit 1
    fi
    sleep 1
done

FAIL=0

probe() {
    local name="$1"
    local path="$2"
    local expect_status="${3:-200}"
    local actual
    actual=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT$path")
    if [ "$actual" = "$expect_status" ]; then
        echo "  ✓ $name → $actual"
    else
        echo "  ✗ $name → $actual (attendu $expect_status)"
        FAIL=1
    fi
}

# ── Endpoints publics (200 attendu) ───────────────────────────────
echo "── public endpoints ──"
probe "GET /status"        "/status"        200
probe "GET /levels"        "/levels"        200
probe "GET /bot-info"      "/bot-info"      200
probe "GET /known-users"   "/known-users"   200

# ── Endpoints admin sans auth (devrait etre 401/403 avec ALLOW_NO_AUTH) ──
# En mode ALLOW_NO_AUTH, le middleware requireAuth ouvre tout — donc 200 OK.
# C'est attendu pour ce smoke test (mode dev).
echo "── admin endpoints (dev mode ALLOW_NO_AUTH) ──"
probe "GET /api/permissions" "/api/permissions" 200

# ── Verification logs sans erreur fatale ──────────────────────────
echo "── logs sanity ──"
if grep -qE "^✗|FATAL|UnhandledPromiseRejection|TypeError:" "$LOG_FILE"; then
    echo "  ✗ erreurs detectees dans les logs :"
    grep -E "^✗|FATAL|UnhandledPromiseRejection|TypeError:" "$LOG_FILE" | head -5
    FAIL=1
else
    echo "  ✓ aucune erreur fatale dans les logs"
fi

if [ $FAIL -eq 0 ]; then
    echo
    echo "=== ✓ smoke-test OK ==="
    exit 0
else
    echo
    echo "=== ✗ smoke-test FAILED ==="
    echo "--- last 30 lines of log ---"
    tail -30 "$LOG_FILE"
    exit 1
fi
