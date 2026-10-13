# Shared functions for the start scripts. Included via `source`.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '\033[1;34m[expenses-tracker]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[expenses-tracker] Ошибка:\033[0m %s\n' "$*" >&2; exit 1; }

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "не найдена команда '$1'. $2"
}

# Node 22.13+ (built-in node:sqlite works without flags)
check_node() {
  require_command node "Установите Node.js 22.13 или новее."
  node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1);
  ' || fail "нужен Node.js 22.13+, сейчас $(node -v)."
}

# Installs dependencies if node_modules does not exist yet
ensure_dependencies() {
  local dir="$1"
  if [ ! -d "$dir/node_modules" ]; then
    log "Устанавливаю зависимости: ${dir#"$ROOT_DIR"/}"
    (cd "$dir" && npm install) || fail "npm install завершился с ошибкой в ${dir#"$ROOT_DIR"/}"
  fi
}

# Login passwords for the app in development. If they are not set or empty in backend/.env,
# random ones are generated and written there (this file is not tracked by Git).
ensure_auth_passwords() {
  local env_file="$ROOT_DIR/backend/.env" name current password created=0

  for name in AUTH_PASSWORD_MISHA AUTH_PASSWORD_NASTYA; do
    current="$(sed -n "s/^${name}=//p" "$env_file" | tail -n1)"
    [ -n "$current" ] && continue

    password="$(openssl rand -base64 24 | tr -d '=+/\n' | cut -c1-20)"
    if grep -q "^${name}=" "$env_file"; then
      sed -i.bak "s|^${name}=.*|${name}=${password}|" "$env_file" && rm -f "$env_file.bak"
    else
      printf '%s=%s\n' "$name" "$password" >> "$env_file"
    fi
    log "Пароль для входа (${name#AUTH_PASSWORD_}): ${password}"
    created=1
  done

  if [ "$created" = 1 ]; then
    log "Пароли сохранены в backend/.env. Логины: misha и nastya. Сменить пароль: измените значение в этом файле и перезапустите backend."
  fi
}

# Checks .env and, if an Excel file is set, rclone and the availability of the file in OneDrive.
# Excel is optional: without ONEDRIVE_FILE_PATH the app stores expenses in the database only.
check_backend_env() {
  local backend="$ROOT_DIR/backend"

  if [ ! -f "$backend/.env" ]; then
    cp "$backend/.env.example" "$backend/.env"
    log "Создан backend/.env из .env.example, проверьте ONEDRIVE_FILE_PATH (или оставьте пустым, если Excel не нужен)."
  fi
  ensure_auth_passwords

  # Read values from .env without executing it as shell code
  local remote path
  remote="$(sed -n 's/^ONEDRIVE_REMOTE=//p' "$backend/.env" | tail -n1)"
  path="$(sed -n 's/^ONEDRIVE_FILE_PATH=//p' "$backend/.env" | tail -n1)"
  remote="${remote:-onedrive}"

  if [ -z "$path" ]; then
    log "ONEDRIVE_FILE_PATH не задан: работа с Excel отключена, расходы хранятся только в базе."
    return 0
  fi

  require_command rclone "Установите rclone и настройте remote (см. backend/README.md) или уберите ONEDRIVE_FILE_PATH."

  log "Проверяю доступ к OneDrive: ${remote}:${path}"
  if ! rclone lsf "${remote}:${path}" >/dev/null 2>&1; then
    log "Предупреждение: rclone не видит файл '${remote}:${path}'. Приложение запустится, расходы будут ждать в очереди, пока файл не станет доступен (проверьте 'rclone config' и путь)."
  fi
}

# Local PostgreSQL. All the app needs is a database that answers at DATABASE_URL, in Docker or not.
# If it already answers on the port, nothing is started and Docker is not touched. Only when nothing
# answers on our docker compose port (5433 by default) is the container started; another database is never replaced.
ensure_postgres() {
  local url port compose_port
  url="$(sed -n 's/^DATABASE_URL=//p' "$ROOT_DIR/backend/.env" | tail -n1)"
  [ -n "$url" ] || fail "в backend/.env не задан DATABASE_URL."

  case "$url" in
    *@127.0.0.1:*|*@localhost:*) ;;
    *) return 0 ;;   # внешний сервер
  esac

  port="$(printf '%s' "$url" | sed -E 's|.*@[^:/]+:([0-9]+)/.*|\1|')"
  if nc -z 127.0.0.1 "$port" >/dev/null 2>&1; then
    return 0
  fi

  compose_port="$(sed -n 's/^POSTGRES_PORT=//p' "$ROOT_DIR/.env" 2>/dev/null | tail -n1)"
  compose_port="${compose_port:-5433}"
  [ "$port" = "$compose_port" ] \
    || fail "база на 127.0.0.1:$port не отвечает. Запустите её или исправьте DATABASE_URL в backend/.env."

  require_command docker "База на 127.0.0.1:$port не отвечает. Запустите свою или установите Docker для локального PostgreSQL."
  docker info >/dev/null 2>&1 || fail "база на 127.0.0.1:$port не отвечает, а Docker не запущен. Запустите базу или Docker Desktop и повторите."

  [ -f "$ROOT_DIR/.env" ] || cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
  log "Запускаю PostgreSQL (docker compose, порт $compose_port)..."
  docker compose -f "$ROOT_DIR/docker-compose.yml" up -d --wait postgres \
    || fail "не удалось запустить PostgreSQL. Смотрите: docker compose logs postgres"
}
