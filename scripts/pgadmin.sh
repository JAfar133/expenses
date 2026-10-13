#!/usr/bin/env bash
# pgAdmin on demand: it is not started with the app (it takes ~240 MB of memory and is rarely needed).
#
#   ./scripts/pgadmin.sh on       start pgAdmin (it opens at PGADMIN_ADDRESS in about half a minute)
#   ./scripts/pgadmin.sh off      stop it
#   ./scripts/pgadmin.sh status   is it running
#
# Run in the project folder on the server. While it is off, the pgAdmin address shows a 502 error from Caddy:
# the app itself is not affected. Its data (the `pgadmin-data` volume) is kept when it is stopped.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

cd "$ROOT_DIR"
require_command docker "Установите Docker."

case "${1:-}" in
  on)
    log "Запускаю pgAdmin"
    docker compose up -d --wait pgadmin || fail "не удалось запустить pgAdmin. Смотрите: docker compose logs pgadmin"
    log "pgAdmin запущен. Когда закончите, выключите его: ./scripts/pgadmin.sh off"
    ;;
  off)
    log "Останавливаю pgAdmin"
    docker compose stop pgadmin
    log "pgAdmin остановлен (данные сохранены)"
    ;;
  status)
    if [ -n "$(docker compose ps --status running --services | grep -x pgadmin || true)" ]; then
      log "pgAdmin запущен"
    else
      log "pgAdmin остановлен"
    fi
    ;;
  *)
    fail "использование: ./scripts/pgadmin.sh on | off | status"
    ;;
esac
