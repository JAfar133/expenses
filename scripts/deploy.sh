#!/usr/bin/env bash
# Update the app on the server after a code change.
#
#   ./scripts/deploy.sh            git pull, settings check, rebuild and start, health check
#   ./scripts/deploy.sh --no-pull  same without git pull (code already updated manually)
#
# Run in the project folder on the server. Which compose files to use is taken from COMPOSE_FILE in .env.
# Data in volumes (database, Excel copies, pgAdmin) is untouched; database migrations are applied on backend start.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

cd "$ROOT_DIR"

PULL=1
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    -h|--help) sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "неизвестный параметр: $arg (допустимо: --no-pull)" ;;
  esac
done

require_command git "Установите git."
require_command docker "Установите Docker."
[ -f .env ] || fail "не найден .env в $ROOT_DIR: создайте его из .env.example (docs/DEPLOY.md, раздел 5)."

update_code() {
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    fail "в папке проекта есть локальные изменения файлов, git pull их затронет. Посмотрите: git status"
  fi
  log "Обновляю код (git pull)"
  git pull --ff-only || fail "git pull не выполнен. Проверьте доступ к GitHub и состояние ветки."
}

# The rclone secret is mounted into the backend as a file and must exist even if Excel is not used
ensure_rclone_secret() {
  [ -e secrets/rclone.conf ] && return 0
  log "Создаю пустой secrets/rclone.conf (работа с Excel не настроена)"
  mkdir -p secrets && chmod 700 secrets
  : > secrets/rclone.conf && chmod 644 secrets/rclone.conf
}

check_configs() {
  log "Проверяю настройки compose и Caddyfile"
  docker compose config --quiet || fail "docker compose config сообщил об ошибке: проверьте .env."
  docker compose run --rm --no-deps web caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 \
    || fail "Caddyfile не проходит проверку: docker compose run --rm --no-deps web caddy validate --config /etc/caddy/Caddyfile"
}

rebuild() {
  log "Пересобираю и запускаю контейнеры"
  docker compose up -d --build --remove-orphans || fail "docker compose up завершился с ошибкой."
}

# Wait for the backend to answer on /api/health (migrations run on start and take a few seconds)
wait_for_backend() {
  log "Жду ответа backend"
  local attempt
  for attempt in $(seq 1 30); do
    if docker compose exec -T backend node -e \
      "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" \
      >/dev/null 2>&1; then
      log "Backend отвечает"
      return
    fi
    sleep 2
  done
  docker compose logs --tail 30 backend
  fail "backend не ответил за 60 секунд. Логи выше; подробнее: docker compose logs backend"
}

[ "$PULL" -eq 1 ] && update_code
ensure_rclone_secret
check_configs
rebuild
wait_for_backend

docker compose ps
log "Готово. Версия: $(git log -1 --format='%h %s')"
