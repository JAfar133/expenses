#!/usr/bin/env bash
# Запуск backend (Fastify) в режиме разработки: http://127.0.0.1:3000
# Если локальный PostgreSQL не запущен, поднимет его через docker compose.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

check_node
ensure_dependencies "$ROOT_DIR/backend"
check_backend_env
ensure_postgres

log "Запускаю backend..."
cd "$ROOT_DIR/backend"
exec npm run dev
