#!/usr/bin/env bash
# Start the backend (Fastify) in development mode: http://127.0.0.1:3000
# If local PostgreSQL is not running, starts it via docker compose.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

check_node
ensure_dependencies "$ROOT_DIR/backend"
check_backend_env
ensure_postgres

log "Запускаю backend..."
cd "$ROOT_DIR/backend"
exec npm run dev
