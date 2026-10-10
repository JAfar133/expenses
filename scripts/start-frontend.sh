#!/usr/bin/env bash
# Запуск frontend (Vite): http://127.0.0.1:5173
# Для проверки с телефона: ./scripts/start-frontend.sh --host
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

check_node
ensure_dependencies "$ROOT_DIR/frontend"

log "Запускаю frontend..."
cd "$ROOT_DIR/frontend"
exec npm run dev -- "$@"
