# Общие функции для скриптов запуска. Подключается через `source`.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '\033[1;34m[expenses-tracker]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[expenses-tracker] Ошибка:\033[0m %s\n' "$*" >&2; exit 1; }

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "не найдена команда '$1'. $2"
}

# Node 22.13+ (встроенный node:sqlite работает без флагов)
check_node() {
  require_command node "Установите Node.js 22.13 или новее."
  node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1);
  ' || fail "нужен Node.js 22.13+, сейчас $(node -v)."
}

# Ставит зависимости, если node_modules ещё нет
ensure_dependencies() {
  local dir="$1"
  if [ ! -d "$dir/node_modules" ]; then
    log "Устанавливаю зависимости: ${dir#"$ROOT_DIR"/}"
    (cd "$dir" && npm install) || fail "npm install завершился с ошибкой в ${dir#"$ROOT_DIR"/}"
  fi
}

# Проверяет .env, rclone и доступность файла в OneDrive
check_backend_env() {
  local backend="$ROOT_DIR/backend"

  if [ ! -f "$backend/.env" ]; then
    cp "$backend/.env.example" "$backend/.env"
    log "Создан backend/.env из .env.example, проверьте ONEDRIVE_FILE_PATH."
  fi

  require_command rclone "Установите rclone и настройте remote (см. backend/README.md)."

  # Читаем значения из .env, не выполняя его как shell-код
  local remote path
  remote="$(sed -n 's/^ONEDRIVE_REMOTE=//p' "$backend/.env" | tail -n1)"
  path="$(sed -n 's/^ONEDRIVE_FILE_PATH=//p' "$backend/.env" | tail -n1)"
  remote="${remote:-onedrive}"
  [ -n "$path" ] || fail "в backend/.env не задан ONEDRIVE_FILE_PATH."

  log "Проверяю доступ к OneDrive: ${remote}:${path}"
  rclone lsf "${remote}:${path}" >/dev/null 2>&1 \
    || fail "rclone не видит файл '${remote}:${path}'. Проверьте 'rclone config' и путь."
}

# Локальный PostgreSQL. Если DATABASE_URL указывает на порт нашего docker compose (по умолчанию 5433),
# поднимаем контейнер. Если указана другая база, только проверяем, что она отвечает:
# чужой Postgres на этом компьютере мы не трогаем и контейнером не подменяем.
ensure_postgres() {
  local url port compose_port
  url="$(sed -n 's/^DATABASE_URL=//p' "$ROOT_DIR/backend/.env" | tail -n1)"
  [ -n "$url" ] || fail "в backend/.env не задан DATABASE_URL."

  case "$url" in
    *@127.0.0.1:*|*@localhost:*) ;;
    *) return 0 ;;   # внешний сервер
  esac

  port="$(printf '%s' "$url" | sed -E 's|.*@[^:/]+:([0-9]+)/.*|\1|')"
  compose_port="$(sed -n 's/^POSTGRES_PORT=//p' "$ROOT_DIR/.env" 2>/dev/null | tail -n1)"
  compose_port="${compose_port:-5433}"

  if [ "$port" != "$compose_port" ]; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1 \
      || fail "база на 127.0.0.1:$port не отвечает. Запустите её или исправьте DATABASE_URL в backend/.env."
    return 0
  fi

  require_command docker "Нужен Docker для локального PostgreSQL (или укажите свою базу в DATABASE_URL)."
  docker info >/dev/null 2>&1 || fail "Docker не запущен. Запустите Docker Desktop и повторите."

  [ -f "$ROOT_DIR/.env" ] || cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
  log "Запускаю PostgreSQL (docker compose, порт $compose_port)..."
  docker compose -f "$ROOT_DIR/docker-compose.yml" up -d --wait postgres \
    || fail "не удалось запустить PostgreSQL. Смотрите: docker compose logs postgres"
}
