#!/usr/bin/env bash
# Запуск backend и frontend одной командой. Остановка: Ctrl+C.
# Для проверки с телефона: ./scripts/start-all.sh --host
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

check_node
ensure_dependencies "$ROOT_DIR/backend"
ensure_dependencies "$ROOT_DIR/frontend"
check_backend_env
ensure_postgres

BACKEND_PORT="$(sed -n 's/^PORT=//p' "$ROOT_DIR/backend/.env" | tail -n1)"
BACKEND_PORT="${BACKEND_PORT:-3000}"

# Не запускаем второй экземпляр, если порты заняты
for port in "$BACKEND_PORT" 5173; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "порт $port уже занят. Остановите запущенное приложение."
  fi
done

PIDS=()

# Завершает процесс вместе со всеми потомками (npm → node → tsx/vite)
kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  trap - INT TERM EXIT
  log "Останавливаю..."
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill_tree "$pid"
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Вывод процесса идёт с префиксом, чтобы различать логи backend и frontend
run() {
  local name="$1" dir="$2"; shift 2
  cd "$dir"
  "$@" > >(sed -u "s/^/[$name] /") 2>&1 &
  PIDS+=("$!")
  cd "$ROOT_DIR"
}

run backend  "$ROOT_DIR/backend"  npm run dev
run frontend "$ROOT_DIR/frontend" npm run dev -- "$@"

log "Backend:  http://127.0.0.1:$BACKEND_PORT"
log "Frontend: http://127.0.0.1:5173   (откройте это в браузере)"
log "Остановка: Ctrl+C"

# bash 3.2 на macOS не умеет `wait -n`: проверяем процессы раз в секунду.
# Если упал один из них, останавливаем всё.
while true; do
  for pid in "${PIDS[@]}"; do
    kill -0 "$pid" 2>/dev/null || { log "Один из процессов завершился."; exit 1; }
  done
  sleep 1
done
