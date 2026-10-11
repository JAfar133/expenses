#!/usr/bin/env bash
# Checks that a PostgreSQL backup can be restored: restores it into a temporary database and compares the data.
#
#   ./scripts/verify-backup.sh [backup-file]     (default: the newest ~/backups/expenses-*.sql.gz)
#
# The working database and the running app are not touched: a separate database is created and dropped afterwards.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

cd "$ROOT_DIR"
require_command docker "Установите Docker."

env_value() {
  local value
  value="$(sed -n "s/^$1=//p" .env 2>/dev/null | tail -n1)"
  printf '%s' "${value:-${2:-}}"
}

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
DB_USER="$(env_value POSTGRES_USER expenses)"
DB_NAME="$(env_value POSTGRES_DB expenses)"
file="${1:-$(ls -1t "$BACKUP_DIR"/expenses-*.sql.gz 2>/dev/null | head -n1 || true)}"
[ -n "$file" ] && [ -f "$file" ] || fail "не найден файл копии (укажите путь параметром)"

psql_in() { docker compose exec -T postgres psql -U "$DB_USER" -v ON_ERROR_STOP=1 -qtA "$@"; }

temp_db="verify_restore_$(date +%s)"
trap 'psql_in -d postgres -c "DROP DATABASE IF EXISTS $temp_db" >/dev/null 2>&1 || true' EXIT

log "Проверяю копию: $file"
gzip -t "$file" || fail "архив повреждён"
psql_in -d postgres -c "CREATE DATABASE $temp_db" >/dev/null

# One transaction and stop on the first error: no half-restored database
gunzip -c "$file" | psql_in --single-transaction -d "$temp_db" >/dev/null \
  || fail "восстановление завершилось с ошибкой"

restored="$(psql_in -d "$temp_db" -c 'SELECT count(*) FROM expenses')"
current="$(psql_in -d "$DB_NAME" -c 'SELECT count(*) FROM expenses')"
users="$(psql_in -d "$temp_db" -c 'SELECT count(*) FROM users')"
migrations="$(psql_in -d "$temp_db" -c 'SELECT count(*) FROM schema_migrations' 2>/dev/null || echo '?')"

log "В копии: записей $restored, пользователей $users, миграций $migrations. В рабочей базе сейчас записей: $current"
[ "$restored" -gt 0 ] || fail "в восстановленной базе нет записей"
[ "$restored" -le "$current" ] || fail "в копии записей больше, чем в рабочей базе: что-то не так"
log "Копия восстанавливается без ошибок"
